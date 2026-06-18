import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
async function api(endpoint: string, method: string, body?: object) {
  const opts: ProxyOptions = { method, headers: { "Content-Type": "application/json" } };
  if (body) (opts as any).body = JSON.stringify(body);
  const resp = await connectors.proxy("github", endpoint, opts);
  const text = await (resp as any).text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
  return { status: (resp as any).status, body: parsed };
}
// Contents API initializes the git db on an empty repo (Git Data API cannot).
const content = Buffer.from("# SiteSort\n\nConstruction site information management platform.\n").toString("base64");
const r = await api(`/repos/${OWNER}/${REPO}/contents/README.md`, "PUT", {
  message: "chore: initialize repository",
  content,
  branch: "main",
});
console.log("bootstrap:", r.status, JSON.stringify(r.body).slice(0, 220));
console.log(r.body.commit?.sha ? "✅ initial commit created: " + r.body.commit.sha.slice(0,8) : "❌ bootstrap failed");
