/**
 * Restore a deleted upload from the bucket's soft-delete copy (kept about 7
 * days; tested 2026-10-09). Lists the soft-deleted copies of the file, restores
 * the newest one, and checks it reads back with the same size and checksum.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/restore-upload.ts <filename> [--dry-run]
 *   <filename> is the last part of the link, e.g. 5e5d1f77-....pdf
 *
 * Production's files live in .private/uploads/, workspace files in
 * .private/workspace-uploads/ (lib/gcs.ts); both are searched.
 */
import { createRequire } from "node:module";

// The storage client is installed in the API server package, not here.
const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
type Meta = { generation?: string | number; softDeleteTime?: string; size?: string | number; md5Hash?: string };
type GFile = { name: string; metadata: Meta; exists(): Promise<[boolean]>; getMetadata(): Promise<[Meta]>; restore(o: { generation: number }): Promise<unknown> };
type GBucket = { file(n: string): GFile; getFiles(o: { softDeleted: boolean; prefix: string }): Promise<[GFile[]]> };
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

const [filename, flag] = process.argv.slice(2);
if (!filename || filename.includes("/")) {
  console.error("Usage: restore-upload.ts <filename> [--dry-run]");
  process.exit(2);
}
const raw = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+/, "");
const [bucketName, ...rest] = raw.split("/");
const prefix = rest.join("/").replace(/\/$/, "");
const bucket = storage.bucket(bucketName);

for (const folder of ["uploads", "workspace-uploads"]) {
  const name = prefix ? `${prefix}/${folder}/${filename}` : `${folder}/${filename}`;
  const [live] = await bucket.file(name).exists();
  const [copies] = await bucket.getFiles({ softDeleted: true, prefix: name });
  const exact = copies.filter(c => c.name === name);
  if (live) console.log(`${name}: already live`);
  if (exact.length === 0) continue;
  for (const c of exact) console.log(`${name}: soft-deleted copy gen ${c.metadata.generation}, deleted ${c.metadata.softDeleteTime}, size ${c.metadata.size}`);
  if (live || flag === "--dry-run") continue;
  const newest = exact.sort((a, b) => Number(b.metadata.generation) - Number(a.metadata.generation))[0];
  await bucket.file(name).restore({ generation: Number(newest.metadata.generation) });
  const [m] = await bucket.file(name).getMetadata();
  const ok = m.size === newest.metadata.size && m.md5Hash === newest.metadata.md5Hash;
  console.log(ok ? `Restored ${name} (size and checksum match).` : `Restored ${name}, but size/checksum DIFFER: check it.`);
  process.exit(ok ? 0 : 1);
}
console.log("Nothing restored.");
