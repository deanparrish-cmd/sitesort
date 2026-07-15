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
// Team Portal sharing (all/trade/individual) + Site Board pin/QR fix — 2026-07-15.
const checks: [string, string][] = [
  ["lib/db/src/schema/portal-shares.ts", "portalSharesTable"],
  ["lib/db/src/schema/index.ts", "portal-shares"],
  ["artifacts/api-server/src/lib/ensure-schema.ts", "CREATE TABLE IF NOT EXISTS portal_shares"],
  ["artifacts/api-server/src/routes/portal-shares.ts", "portal-audience"],
  ["artifacts/api-server/src/routes/portal-shares.ts", "acceptedMembers"],
  ["artifacts/api-server/src/routes/index.ts", "portalSharesRouter"],
  ["artifacts/api-server/src/routes/portal.ts", "async function visibleIds"],
  ["artifacts/api-server/src/routes/portal.ts", "/portal/shared"],
  ["artifacts/api-server/src/routes/team.ts", "Portal member row (person link)"],
  ["artifacts/api-server/src/lib/activity.ts", "Shared with me"],
  ["lib/api-spec/openapi.yaml", "getPortalShared"],
  ["artifacts/sitesort/src/components/share-modal.tsx", "PORTAL_ENTITY_TYPES"],
  ["artifacts/sitesort/src/components/share-modal.tsx", "submitPortalShare"],
  ["artifacts/sitesort/src/pages/portal/section.tsx", "function SharedView"],
  ["artifacts/sitesort/src/pages/portal/layout.tsx", "Shared with me"],
  ["artifacts/sitesort/src/pages/projects/detail.tsx", "Pinned documents"],
  ["artifacts/api-server/src/routes/subcontractors.ts", "Only an admin or project manager can delete a subcontractor"],
  ["artifacts/api-server/src/routes/people.ts", "orphanPortalUsers"],
  ["artifacts/sitesort/src/pages/subcontractors/index.tsx", "Delete subcontractor"],
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
