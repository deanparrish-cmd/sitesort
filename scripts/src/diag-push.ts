import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
async function api(endpoint: string, method: string, body?: object) {
  const opts: ProxyOptions = { method, headers: { "Content-Type": "application/json" } };
  if (body) (opts as any).body = JSON.stringify(body);
  const resp = await connectors.proxy("github", endpoint, opts);
  const status = (resp as any).status;
  const text = await (resp as any).text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
  return { status, body: parsed };
}

console.log("1) create blob");
const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, "POST", { content: Buffer.from("# SiteSort\n").toString("base64"), encoding: "base64" });
console.log("   ", blob.status, JSON.stringify(blob.body).slice(0, 160));
if (!blob.body.sha) { console.log("BLOB FAILED — stopping"); process.exit(1); }

console.log("2) create tree");
const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, "POST", { tree: [{ path: "README.md", mode: "100644", type: "blob", sha: blob.body.sha }] });
console.log("   ", tree.status, JSON.stringify(tree.body).slice(0, 160));
if (!tree.body.sha) { console.log("TREE FAILED — stopping"); process.exit(1); }

console.log("3) create commit");
const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, "POST", { message: "init", tree: tree.body.sha });
console.log("   ", commit.status, JSON.stringify(commit.body).slice(0, 160));
if (!commit.body.sha) { console.log("COMMIT FAILED — stopping"); process.exit(1); }

console.log("4) create ref refs/heads/main");
const ref = await api(`/repos/${OWNER}/${REPO}/git/refs`, "POST", { ref: "refs/heads/main", sha: commit.body.sha });
console.log("   ", ref.status, JSON.stringify(ref.body).slice(0, 200));
console.log(ref.body.ref ? "✅ REF CREATED — repo now has main" : "❌ REF CREATION FAILED");
