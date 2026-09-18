/**
 * Targeted GitHub push: uploads ONLY files whose content differs from GitHub main.
 * push-robust.ts re-uploads the whole workspace (1000+ blobs), which trips the shared
 * GitHub rate limit. This diffs `git ls-tree -r <ref>` (default HEAD) against main's
 * recursive tree by blob SHA and creates blobs only for the delta.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/push-delta.ts [ref]
 * Additive like push-robust (base_tree): local deletions are NOT propagated.
 */
import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import { execFileSync } from "child_process";

const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
const WORKDIR = "/home/runner/workspace";
const MAX_BYTES = 650 * 1024; // proxy ~1MB body limit after base64
const REF = process.argv[2] ?? "HEAD";

const git = (args: string[]) => execFileSync("git", args, { cwd: WORKDIR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

async function api(endpoint: string, method: string, body?: object) {
  const opts: ProxyOptions = { method, headers: { "Content-Type": "application/json" } };
  if (body) (opts as any).body = JSON.stringify(body);
  const resp = await connectors.proxy("github", endpoint, opts);
  const status = (resp as any).status;
  const text = await (resp as any).text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { __raw: text.slice(0, 120) }; }
  return { status, body: parsed };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(label: string, fn: () => Promise<{ status: number; body: any }>, ok: (b: any) => T | undefined, tries = 6): Promise<T> {
  let last = { status: 0, body: undefined as any };
  for (let i = 0; i < tries; i++) {
    last = await fn();
    const v = ok(last.body);
    if (v !== undefined) return v;
    if (last.status === 413) throw new Error(`${label}: HTTP 413 (too large)`);
    await sleep(Math.min(20000, 1000 * 2 ** i));
  }
  throw new Error(`${label} failed after ${tries} tries: HTTP ${last.status} ${JSON.stringify(last.body).slice(0, 160)}`);
}

async function main() {
  const localSha = git(["rev-parse", REF]).trim();
  console.log(`Pushing ${REF} (${localSha.slice(0, 8)}) as a delta…`);

  const main = await withRetry("get main ref", () => api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "GET"), b => b?.object?.sha);
  const baseCommit = await withRetry("get base commit", () => api(`/repos/${OWNER}/${REPO}/git/commits/${main}`, "GET"), b => b?.tree?.sha);
  const remote = await withRetry("get remote tree", () => api(`/repos/${OWNER}/${REPO}/git/trees/${baseCommit}?recursive=1`, "GET"), b => b?.tree);
  const remoteBody = await api(`/repos/${OWNER}/${REPO}/git/trees/${baseCommit}?recursive=1`, "GET");
  if (remoteBody.body?.truncated) throw new Error("remote tree truncated; can't diff safely, use push-robust.ts");
  const remoteSha = new Map<string, string>((remote as any[]).filter(t => t.type === "blob").map(t => [t.path, t.sha]));
  console.log(`base commit ${String(main).slice(0, 8)}; remote has ${remoteSha.size} files`);

  // Local committed files: "<mode> blob <sha>\t<path>"
  const changed: { path: string; sha: string }[] = [];
  for (const line of git(["ls-tree", "-r", REF]).split("\n").filter(Boolean)) {
    const m = line.match(/^(\d+) blob ([0-9a-f]+)\t(.+)$/);
    if (!m || m[1] === "120000") continue;
    if (remoteSha.get(m[3]) !== m[2]) changed.push({ path: m[3], sha: m[2] });
  }
  console.log(`${changed.length} file(s) differ from GitHub main`);
  if (changed.length === 0) { console.log("Nothing to push."); return; }
  if (changed.length > 300) throw new Error(`${changed.length} changed files is too many for a targeted push; use push-robust.ts`);

  const items: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  const skipped: string[] = [];
  for (const f of changed) {
    const size = Number(git(["cat-file", "-s", f.sha]).trim());
    if (size > MAX_BYTES) { skipped.push(`${f.path} (${(size / 1048576).toFixed(1)}MB)`); continue; }
    const content = execFileSync("git", ["cat-file", "blob", f.sha], { cwd: WORKDIR, maxBuffer: 64 * 1024 * 1024 }).toString("base64");
    const sha = await withRetry(`blob ${f.path}`, () => api(`/repos/${OWNER}/${REPO}/git/blobs`, "POST", { content, encoding: "base64" }), b => b?.sha);
    items.push({ path: f.path, mode: "100644", type: "blob", sha });
    console.log(`  blob ${items.length}/${changed.length - skipped.length}: ${f.path}`);
  }
  if (skipped.length) console.warn(`Skipped ${skipped.length} oversized: ${skipped.join(", ")}`);

  const tree = await withRetry("create tree", () => api(`/repos/${OWNER}/${REPO}/git/trees`, "POST", { tree: items, base_tree: baseCommit }), b => b?.sha);
  const subject = git(["log", "-1", "--format=%s", REF]).trim();
  const commit = await withRetry("create commit", () => api(`/repos/${OWNER}/${REPO}/git/commits`, "POST", { message: `sync: ${subject}`, tree, parents: [main] }), b => b?.sha);
  const ref = await withRetry("update ref", () => api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", { sha: commit, force: true }), b => b?.object?.sha);
  console.log(`\n✅ Pushed. main → ${String(ref).slice(0, 8)} (${items.length} files)`);
}
main().catch(e => { console.error("❌ PUSH FAILED:", e.message); process.exit(1); });
