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

  // A single create-tree call with ~2000+ entries reliably 502s (GitHub's tree
  // endpoint chokes on the payload, retries don't help). Build the tree
  // incrementally instead: each batch's base_tree is the previous batch's
  // resulting sha, so the final tree still contains every entry.
  console.log("Creating tree (chunked)…");
  const CHUNK = 300;
  let currentBaseTree = baseTreeSha;
  let treeSha: string | undefined;
  for (let start = 0; start < treeItems.length; start += CHUNK) {
    const batch = treeItems.slice(start, start + CHUNK);
    let result = { status: 0, body: undefined as any };
    for (let i = 0; i < 5; i++) {
      result = await api(`/repos/${OWNER}/${REPO}/git/trees`, "POST", { tree: batch, base_tree: currentBaseTree });
      if (result.body?.sha) break;
      console.warn(`  ⚠️  tree batch ${start}-${start + batch.length} attempt ${i + 1} failed (HTTP ${result.status}): ${JSON.stringify(result.body).slice(0, 150)}`);
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
    if (!result.body?.sha) throw new Error(`tree batch ${start}-${start + batch.length} failed after retries: HTTP ${result.status} ` + JSON.stringify(result.body).slice(0, 200));
    treeSha = result.body.sha as string;
    currentBaseTree = treeSha;
    console.log(`  tree batch ${start + batch.length}/${treeItems.length} -> ${treeSha.slice(0, 8)}`);
  }
  if (!treeSha) throw new Error("no tree items to commit");

  console.log("Creating commit…");
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, "POST", {
    message: "chore: sync workspace — calendar events, site board, check-in fixes",
    tree: treeSha,
    parents: [baseSha],
  });
  if (!commit.body?.sha) throw new Error("commit failed: " + JSON.stringify(commit.body).slice(0, 200));

  console.log("Updating ref (PATCH main)…");
  const ref = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", { sha: commit.body.sha, force: true });
  if (!ref.body?.object?.sha) throw new Error("ref update failed: " + JSON.stringify(ref.body).slice(0, 200));

  console.log(`\n✅ Pushed. main → ${ref.body.object.sha.slice(0, 8)}  (${treeItems.length} files)`);
}
main().catch(e => { console.error("❌ PUSH FAILED:", e.message); process.exit(1); });
