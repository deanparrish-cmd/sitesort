import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
async function api(endpoint: string) {
  const resp = await connectors.proxy("github", endpoint, { method: "GET", headers: { "Content-Type": "application/json" } } as ProxyOptions);
  const text = await (resp as any).text();
  return { status: (resp as any).status, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
(async () => {
  const checks = [
    ["artifacts/sitesort/src/App.tsx", "lazy(() => import("],
    ["artifacts/sitesort/vite.config.ts", "react-vendor"],
    ["artifacts/sitesort/src/pages/landing.tsx", "construction-hero.webp"],
    ["artifacts/sitesort/src/pages/auth/login.tsx", "auth-bg.webp"],
  ];
  for (const [p, needle] of checks) {
    const r = await api(`/repos/${OWNER}/${REPO}/contents/${p}?ref=main`);
    const ok = r.status === 200 && Buffer.from(r.body.content, "base64").toString("utf8").includes(needle);
    console.log(`${ok ? "✅" : "❌"} ${p}  «${needle}»  (HTTP ${r.status})`);
  }
  for (const p of ["artifacts/sitesort/public/images/construction-hero.webp","artifacts/sitesort/public/images/auth-bg.webp","artifacts/sitesort/public/images/logo.webp","attached_assets/built_for_beam_nobg.webp"]) {
    const r = await api(`/repos/${OWNER}/${REPO}/contents/${p}?ref=main`);
    console.log(`${r.status === 200 ? "✅" : "❌"} exists: ${p} (HTTP ${r.status})`);
  }
})();
