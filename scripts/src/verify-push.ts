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
// Per-person portal invites (portal-only for everyone) + review fixes — 2026-07-14.
const checks: [string, string][] = [
  ["lib/db/src/schema/people.ts", "peopleTable"],
  ["artifacts/api-server/src/routes/people.ts", "portal-invites"],
  ["artifacts/api-server/src/routes/people.ts", "in-house-people"],
  ["artifacts/api-server/src/lib/ensure-schema.ts", "people_company_inhouse_email_uq"],
  ["artifacts/api-server/src/routes/portal.ts", "portal-only"],
  ["artifacts/sitesort/src/pages/projects/portal-people.tsx", "PortalInvitePill"],
  ["artifacts/sitesort/src/pages/projects/detail.tsx", "PortalInvitePill"],
  ["artifacts/sitesort/src/components/layout/sidebar-layout.tsx", "overflow-x-clip"],
  ["artifacts/sitesort/src/pages/portal/layout.tsx", "overflow-x-clip"],
  ["artifacts/sitesort/src/pages/portal/layout.tsx", "flex flex-wrap gap-1"],
  ["artifacts/sitesort/src/pages/projects/team-activity.tsx", "Portal invites"],
  ["lib/api-spec/openapi.yaml", "createPortalInvite"],
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
