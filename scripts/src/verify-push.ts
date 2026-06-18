import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";

async function getFile(p: string): Promise<string> {
  const resp = await connectors.proxy("github", `/repos/${OWNER}/${REPO}/contents/${p}?ref=main`, { method: "GET", headers: { "Content-Type": "application/json" } } as ProxyOptions);
  const j: any = await resp.json();
  if (!j.content) throw new Error("no content: " + (j.message ?? JSON.stringify(j).slice(0,80)));
  return Buffer.from(j.content, "base64").toString("utf8");
}

// [path, signature string that MUST be present for my change to have landed]
const checks: [string, string][] = [
  ["artifacts/api-server/src/routes/qr.ts", "const upcomingEvents = await db"],
  ["artifacts/api-server/src/routes/qr.ts", "const isInHouseMember = projectUsers.some"],
  ["artifacts/api-server/src/routes/calendar-events.ts", "resolvedProjectId"],
  ["artifacts/api-server/src/routes/index.ts", "calendarEventsRouter"],
  ["lib/db/src/schema/calendar_events.ts", "calendarEventsTable"],
  ["lib/db/src/schema/index.ts", "./calendar_events"],
  ["artifacts/sitesort/src/pages/site-board.tsx", "Subcontractors must have a valid insurance certificate"],
  ["artifacts/sitesort/src/pages/site-board.tsx", "object-contain max-h-72"],
  ["artifacts/sitesort/src/pages/dashboard/index.tsx", "Show on site board for"],
  ["artifacts/sitesort/src/pages/checkins/index.tsx", "object-contain group-hover:scale-105"],
  ["artifacts/sitesort/src/pages/projects/detail.tsx", 'alt={ci.workerName} className="w-full h-full object-contain"'],
  ["artifacts/sitesort/src/pages/invoices/index.tsx", 'get("invoice")'],
];

let ok = 0, bad: string[] = [];
const seen = new Map<string, string>();
for (const [p, sig] of checks) {
  try {
    if (!seen.has(p)) seen.set(p, await getFile(p));
    const content = seen.get(p)!;
    if (content.includes(sig)) { console.log(`✅ ${p}  «${sig.slice(0,40)}…»`); ok++; }
    else { console.log(`❌ ${p}  MISSING «${sig.slice(0,40)}…»`); bad.push(p); }
  } catch (e: any) { console.log(`⚠️  ${p}  fetch error: ${e.message}`); bad.push(p); }
}
console.log(`\n${ok}/${checks.length} signatures present on GitHub main.`);
if (bad.length) { console.log("NEEDS RE-PUSH:", [...new Set(bad)].join(", ")); process.exit(1); }
console.log("All changed files verified on GitHub.");
