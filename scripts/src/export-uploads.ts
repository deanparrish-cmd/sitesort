/**
 * Copy every PRODUCTION upload (.private/uploads/) to a local folder, for an
 * off-Replit backup. Read-only on storage: it lists and downloads, nothing
 * else. Each file's MD5 is checked against storage, and a manifest
 * (name, bytes, md5) is written beside the files.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/export-uploads.ts <out-dir> [--limit N]
 *   <out-dir> must be outside the workspace (use /tmp/...), so a backup of
 *   people's files can never be committed or pushed to GitHub.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The storage client is installed in the API server package, not here.
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

const args = process.argv.slice(2);
const outArg = args.find(a => !a.startsWith("--"));
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
if (!outArg) {
  console.error("Usage: export-uploads.ts <out-dir outside the workspace> [--limit N]");
  process.exit(2);
}
const out = resolve(outArg);
if (out.startsWith("/home/runner/workspace")) {
  console.error(`Refusing: ${out} is inside the workspace. Use /tmp/... so it can't be committed or pushed.`);
  process.exit(2);
}

const raw = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+/, "");
const [bucketName, ...rest] = raw.split("/");
const prefix = `${rest.join("/").replace(/\/$/, "")}/uploads/`.replace(/^\//, "");
const bucket = storage.bucket(bucketName);

const [all] = await bucket.getFiles({ prefix });
const files = all.filter(f => !f.name.endsWith("/")).slice(0, limit);
mkdirSync(out, { recursive: true });
const manifest: string[] = ["name\tbytes\tmd5"];
let bytes = 0;
let bad = 0;
for (const [i, f] of files.entries()) {
  const name = f.name.slice(prefix.length);
  const [data] = await f.download();
  const md5 = createHash("md5").update(data).digest("base64");
  const ok = !f.metadata.md5Hash || md5 === f.metadata.md5Hash;
  if (!ok) { bad++; console.error(`CHECKSUM MISMATCH: ${name}`); }
  writeFileSync(`${out}/${name}`, data);
  manifest.push(`${name}\t${data.length}\t${md5}`);
  bytes += data.length;
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${files.length}`);
}
writeFileSync(`${out}/MANIFEST.tsv`, manifest.join("\n") + "\n");
console.log(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB written to ${out}; ${bad} checksum mismatches.`);
process.exit(bad ? 1 : 0);
