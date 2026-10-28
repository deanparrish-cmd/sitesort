/**
 * Copy production uploads (.private/uploads/) straight into the Cloudflare R2
 * backup bucket. Read-only on storage; writes only to R2. Never deletes and
 * never overwrites: a key already in the bucket is skipped, so a re-run after
 * a partial failure resumes. Content-MD5 is sent with every PUT, so R2 refuses
 * a body that does not match what we read.
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 * Endpoint is the EU jurisdiction (.eu.) and is written here on purpose.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/upload-to-r2.ts [--limit N]
 */
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";

const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
type Meta = { size?: string | number; md5Hash?: string };
type GFile = { name: string; metadata: Meta; download(): Promise<[Buffer]> };
type GBucket = { getFiles(o: { prefix: string }): Promise<[GFile[]]> };
const { Storage } = require("@google-cloud/storage") as { Storage: new (o: unknown) => { bucket(n: string): GBucket } };

const E = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", token_url: `${E}/token`, type: "external_account",
    credential_source: { url: `${E}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  } as never,
  projectId: "",
});

const need = (n: string) => { const v = process.env[n]; if (!v) { console.error(`Missing ${n}`); process.exit(2); } return v; };
const account = need("R2_ACCOUNT_ID"), keyId = need("R2_ACCESS_KEY_ID"), secret = need("R2_SECRET_ACCESS_KEY"), r2Bucket = need("R2_BUCKET");
const host = `${account}.eu.r2.cloudflarestorage.com`;

const sha = (d: Buffer | string) => createHash("sha256").update(d).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function r2(method: "HEAD" | "PUT", key: string, body?: Buffer, md5?: string) {
  const path = `/${r2Bucket}/${key.split("/").map(enc).join("/")}`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = now.slice(0, 8);
  const payloadHash = sha(body ?? "");
  const h: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  if (md5) h["content-md5"] = md5;
  const names = Object.keys(h).sort();
  const canonicalReq = `${method}\n${path}\n\n${names.map(n => `${n}:${h[n]}\n`).join("")}\n${names.join(";")}\n${payloadHash}`;
  const scope = `${date}/auto/s3/aws4_request`;
  const sts = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha(canonicalReq)}`;
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", sigKey).update(sts).digest("hex");
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: { ...Object.fromEntries(Object.entries(h).filter(([k]) => k !== "host")),
      authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    body: body as unknown as BodyInit | undefined,
  });
  return res;
}

const args = process.argv.slice(2);
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

const raw = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+/, "");
const [bucketName, ...rest] = raw.split("/");
const prefix = `${rest.join("/").replace(/\/$/, "")}/uploads/`.replace(/^\//, "");
const [all] = await storage.bucket(bucketName).getFiles({ prefix });
const files = all.filter(f => !f.name.endsWith("/")).slice(0, limit);

let up = 0, skipped = 0, failed = 0, bytes = 0;
for (const [i, f] of files.entries()) {
  const name = f.name.slice(prefix.length);
  const key = `uploads/${name}`;
  try {
    const head = await r2("HEAD", key);
    if (head.status === 200) { skipped++; console.log(`skip (already in bucket): ${key}`); continue; }
    if (head.status !== 404) throw new Error(`HEAD ${head.status}`);
    const [data] = await f.download();
    const md5 = createHash("md5").update(data).digest("base64");
    if (f.metadata.md5Hash && md5 !== f.metadata.md5Hash) throw new Error("checksum mismatch against source storage");
    const put = await r2("PUT", key, data, md5);
    if (put.status !== 200) throw new Error(`PUT ${put.status} ${(await put.text()).slice(0, 200)}`);
    up++; bytes += data.length;
    console.log(`uploaded ${key} ${data.length} bytes md5 ${md5}`);
  } catch (e) { failed++; console.error(`FAILED ${key}: ${(e as Error).message}`); }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${files.length}`);
}
console.log(`${files.length} listed: ${up} uploaded (${(bytes / 1e6).toFixed(1)} MB), ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
