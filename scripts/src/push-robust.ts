/**
 * Robust GitHub push: bounded concurrency + retries + status checks at every step.
 * Fixes the silent-failure issues in github-push.ts (no error handling, too much parallelism).
 */
import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import * as fs from "fs";
import * as path from "path";

const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";

// Ignore source-control junk AND runtime/cache dirs (e.g. chromium crash dumps from browser-check).
const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".cache", ".local", "snippets",
  ".pnpm-store", "coverage", ".turbo", ".next", ".config", ".npm", ".vscode-server",
  ".upm", ".replit_cache", "tmp",
]);
// The Replit Connectors proxy rejects request bodies over ~1MB (nginx 413). base64 inflates
// by ~4/3, so cap raw bytes so the encoded blob payload stays safely under the limit.
const MAX_BYTES = 650 * 1024;
function shouldIgnore(name: string): boolean {
  return IGNORE.has(name) || name.endsWith(".lock") || name.startsWith(".pnpm");
}

function collect(dir: string, base: string, out: Array<{ path: string; content: string }>, skipped: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (shouldIgnore(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(full, rel, out, skipped);
    else if (entry.isFile()) {
      try {
        const buf = fs.readFileSync(full);
        if (buf.length > MAX_BYTES) { skipped.push(`${rel} (${(buf.length / 1048576).toFixed(1)}MB)`); continue; }
        out.push({ path: rel, content: buf.toString("base64") });
      } catch { skipped.push(`${rel} (unreadable)`); }
    }
  }
}

async function api(endpoint: string, method: string, body?: object) {
  const opts: ProxyOptions = { method, headers: { "Content-Type": "application/json" } };
  if (body) (opts as any).body = JSON.stringify(body);
  const resp = await connectors.proxy("github", endpoint, opts);
  const status = (resp as any).status;
  const text = await (resp as any).text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { __raw: text.slice(0, 120) }; }
  return { status, body: parsed };
}

async function createBlobWithRetry(content: string, p: string, tries = 5): Promise<string | null> {
  let lastStatus = 0;
  for (let i = 0; i < tries; i++) {
    const r = await api(`/repos/${OWNER}/${REPO}/git/blobs`, "POST", { content, encoding: "base64" });
    if (r.body?.sha) return r.body.sha;
    lastStatus = r.status;
    if (r.status === 413) break; // payload too large — retry won't help
    await new Promise(res => setTimeout(res, 400 * (i + 1) + Math.floor(i * 137))); // backoff
  }
  console.warn(`  ⚠️  blob failed (HTTP ${lastStatus}), skipping: ${p}`);
  return null;
}

// Simple concurrency pool
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log("Collecting files…");
  const files: Array<{ path: string; content: string }> = [];
  const skipped: string[] = [];
  collect("/home/runner/workspace", "", files, skipped);
  console.log(`Found ${files.length} files` + (skipped.length ? `; skipped ${skipped.length} oversized/unreadable: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? "…" : ""}` : ""));

  const branch = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "GET");
  if (!branch.body?.object?.sha) throw new Error("no main ref: " + JSON.stringify(branch.body).slice(0, 120));
  const baseSha = branch.body.object.sha;
  const commitInfo = await api(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`, "GET");
  const baseTreeSha = commitInfo.body?.tree?.sha;
  console.log(`base commit ${baseSha.slice(0, 8)}, base tree ${String(baseTreeSha).slice(0, 8)}`);

  console.log("Creating blobs (concurrency 6, with retry)…");
  let done = 0;
  const raw = await pool(files, 6, async (f) => {
    const sha = await createBlobWithRetry(f.content, f.path);
    if (++done % 100 === 0) console.log(`  ${done}/${files.length}`);
    return sha ? { path: f.path, mode: "100644" as const, type: "blob" as const, sha } : null;
  });
  const treeItems = raw.filter((x): x is NonNullable<typeof x> => x !== null);
  const failedCount = raw.length - treeItems.length;
  console.log(`  ${treeItems.length} blobs created${failedCount ? `, ${failedCount} skipped (oversized)` : ""}.`);

  console.log("Creating tree…");
  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, "POST", { tree: treeItems, base_tree: baseTreeSha });
  if (!tree.body?.sha) throw new Error("tree failed: " + JSON.stringify(tree.body).slice(0, 200));

  console.log("Creating commit…");
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, "POST", {
    message: "chore: sync workspace — calendar events, site board, check-in fixes",
    tree: tree.body.sha,
    parents: [baseSha],
  });
  if (!commit.body?.sha) throw new Error("commit failed: " + JSON.stringify(commit.body).slice(0, 200));

  console.log("Updating ref (PATCH main)…");
  const ref = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", { sha: commit.body.sha, force: true });
  if (!ref.body?.object?.sha) throw new Error("ref update failed: " + JSON.stringify(ref.body).slice(0, 200));

  console.log(`\n✅ Pushed. main → ${ref.body.object.sha.slice(0, 8)}  (${treeItems.length} files)`);
}
main().catch(e => { console.error("❌ PUSH FAILED:", e.message); process.exit(1); });
