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
// Real invite emails (Resend) + existing-account portal join — 2026-07-15.
const checks: [string, string][] = [
  ["artifacts/api-server/src/lib/email.ts", "sendPortalInviteEmail"],
  ["artifacts/api-server/src/lib/invite-email.ts", "delivered: boolean"],
  ["artifacts/api-server/src/routes/people.ts", "portal-invites/:inviteId/resend"],
  ["artifacts/api-server/src/routes/people.ts", "RESEND_COOLDOWN_MS"],
  ["artifacts/api-server/src/routes/portal.ts", "grantOnly"],
  ["artifacts/api-server/src/routes/portal.ts", "existingAccount"],
  ["lib/db/src/schema/project_invites.ts", "emailStatus"],
  ["artifacts/sitesort/src/pages/projects/portal-people.tsx", "InviteEmailStatus"],
  ["artifacts/sitesort/src/pages/portal/accept.tsx", "Join project portal"],
  ["lib/api-spec/openapi.yaml", "resendPortalInvite"],
  ["CHANGELOG.md", "Real email delivery for Team Portal invites"],
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
