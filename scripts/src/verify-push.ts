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
// Team Portal (Feature #61) — 2026-07-03 push.
const checks: [string, string][] = [
  ["artifacts/api-server/src/routes/portal.ts", '"/portal/login"'],
  ["artifacts/api-server/src/routes/team-activity.ts", "sendProjectInviteEmail"],
  ["artifacts/api-server/src/middlewares/portal.ts", "requirePortalMember"],
  ["artifacts/api-server/src/middlewares/auth.ts", "generatePortalToken"],
  ["artifacts/api-server/src/lib/activity.ts", "PORTAL_SECTIONS"],
  ["artifacts/api-server/src/lib/invite-email.ts", "sendProjectInviteEmail"],
  ["artifacts/api-server/src/routes/auth.ts", '"use_portal"'],
  ["artifacts/api-server/src/routes/index.ts", "teamActivityRouter"],
  ["artifacts/api-server/src/lib/ensure-schema.ts", "project_invites"],
  ["lib/db/src/schema/project_invites.ts", "projectInvitesTable"],
  ["lib/db/src/schema/activity_log.ts", "activityLogTable"],
  ["lib/db/src/schema/users.ts", "portal_only"],
  ["artifacts/sitesort/src/pages/portal/section.tsx", "PortalSectionPage"],
  ["artifacts/sitesort/src/pages/portal/login.tsx", "sitesort_portal_token"],
  ["artifacts/sitesort/src/pages/projects/team-activity.tsx", "ProjectTeamActivity"],
  ["artifacts/sitesort/src/App.tsx", "/portal/:section"],
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
