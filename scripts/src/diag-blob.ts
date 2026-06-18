import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import * as fs from "fs";
const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
async function blobTest(file: string) {
  const buf = fs.readFileSync(file);
  const content = buf.toString("base64");
  const resp = await connectors.proxy("github", `/repos/${OWNER}/${REPO}/git/blobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, encoding: "base64" }) } as ProxyOptions);
  const status = (resp as any).status;
  const text = await (resp as any).text();
  console.log(`${file}  size=${(buf.length/1024).toFixed(0)}KB base64=${(content.length/1024).toFixed(0)}KB  -> HTTP ${status}`);
  console.log("  body:", text.slice(0, 200).replace(/\n/g, " "));
}
await blobTest("/home/runner/workspace/artifacts/sitesort/public/images/auth-bg.png");          // 1.6MB
await blobTest("/home/runner/workspace/artifacts/sitesort/src/pages/site-board.tsx");           // small text (should work)
