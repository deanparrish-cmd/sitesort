/**
 * Targeted GitHub push: uploads ONLY files whose content differs from GitHub main.
 * push-robust.ts re-uploads the whole workspace (1000+ blobs), which trips the shared
 * GitHub rate limit. This diffs `git ls-tree -r <ref>` (default HEAD) against main's
 * recursive tree by blob SHA and creates blobs only for the delta.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/push-delta.ts [ref] [--prune]
 * Additive like push-robust (base_tree): local deletions are NOT propagated unless
 * --prune is given. Every run reports what GitHub holds that the workspace doesn't
 * (minus scripts/push-accepted-differences.txt) and what was too large to upload, so
 * the off-platform copy is never quietly different from the workspace.
 */
import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
const WORKDIR = "/home/runner/workspace";
const MAX_BYTES = 650 * 1024; // proxy ~1MB body limit after base64
const ARGS = process.argv.slice(2);
const PRUNE = ARGS.includes("--prune");
const REF = ARGS.find(a => !a.startsWith("--")) ?? "HEAD";
const ACCEPTED_FILE = `${WORKDIR}/scripts/push-accepted-differences.txt`;

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

// One line per path or folder prefix (ending in "/"); "#" starts a comment.
function acceptedDifferences(): string[] {
  if (!existsSync(ACCEPTED_FILE)) return [];
  return readFileSync(ACCEPTED_FILE, "utf8").split("\n").map(l => l.replace(/#.*/, "").trim()).filter(Boolean);
}

function report(remoteOnly: string[], accepted: string[], skipped: string[]) {
  const isAccepted = (p: string) => accepted.some(a => (a.endsWith("/") ? p.startsWith(a) : p === a));
  const unexpected = remoteOnly.filter(p => !isAccepted(p));
  console.log("\n── Backup report (GitHub main vs this workspace) ──");
  if (unexpected.length === 0) console.log("GitHub has no files the workspace doesn't" + (remoteOnly.length ? ` (${remoteOnly.length} accepted difference(s)).` : "."));
  else {
    console.log(`⚠️  GitHub has ${unexpected.length} file(s) the workspace doesn't. A restore from GitHub would bring them back.`);
    const byDir = new Map<string, number>();
    for (const p of unexpected) { const d = p.split("/").slice(0, 2).join("/"); byDir.set(d, (byDir.get(d) ?? 0) + 1); }
    for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${d}`);
    for (const p of unexpected.slice(0, 15)) console.log(`   - ${p}`);
    if (unexpected.length > 15) console.log(`   ... and ${unexpected.length - 15} more`);
    console.log("   Remove them with --prune, or list them in scripts/push-accepted-differences.txt.");
  }
  if (skipped.length) console.log(`⚠️  Too large to upload, so missing or out of date on GitHub: ${skipped.join(", ")}`);
  console.log("GitHub only backs up code committed to git. Uploaded files (object storage), the database, and anything git ignores are NOT on GitHub.");
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
  const localPaths = new Set<string>();
  for (const line of git(["ls-tree", "-r", REF]).split("\n").filter(Boolean)) {
    const m = line.match(/^(\d+) blob ([0-9a-f]+)\t(.+)$/);
    if (!m) continue;
    localPaths.add(m[3]);
    if (m[1] === "120000") continue;
    if (remoteSha.get(m[3]) !== m[2]) changed.push({ path: m[3], sha: m[2] });
  }
  const accepted = acceptedDifferences();
  const isAccepted = (p: string) => accepted.some(a => (a.endsWith("/") ? p.startsWith(a) : p === a));
  const remoteOnly = [...remoteSha.keys()].filter(p => !localPaths.has(p)).sort();
  const toPrune = PRUNE ? remoteOnly.filter(p => !isAccepted(p)) : [];
  console.log(`${changed.length} file(s) differ from GitHub main`);
  if (changed.length === 0 && toPrune.length === 0) { console.log("Nothing to push."); report(remoteOnly, accepted, []); return; }
  if (changed.length > 300) throw new Error(`${changed.length} changed files is too many for a targeted push; use push-robust.ts`);

  const items: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
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
  const uploaded = items.length;
  if (toPrune.length) {
    console.log(`Removing ${toPrune.length} file(s) from GitHub that the workspace doesn't have:`);
    for (const p of toPrune) console.log(`  - ${p}`);
    for (const path of toPrune) items.push({ path, mode: "100644", type: "blob", sha: null });
  }

  const tree = await withRetry("create tree", () => api(`/repos/${OWNER}/${REPO}/git/trees`, "POST", { tree: items, base_tree: baseCommit }), b => b?.sha);
  const subject = git(["log", "-1", "--format=%s", REF]).trim();
  // A prune names every removed path in the commit, so GitHub's history says what went.
  // GitHub cuts a message at 64 KB: real code first (dot-folders last), and anything over
  // the cap is counted by folder, so the cut can never hide a code path silently.
  const ordered = [...toPrune].sort((a, b) => Number(a.startsWith(".")) - Number(b.startsWith(".")) || a.localeCompare(b));
  const listed: string[] = [];
  let bytes = 0;
  for (const p of ordered) { if (bytes + p.length + 3 > 60_000) break; listed.push(p); bytes += p.length + 3; }
  const overflow = new Map<string, number>();
  for (const p of ordered.slice(listed.length)) { const d = p.split("/").slice(0, 2).join("/"); overflow.set(d, (overflow.get(d) ?? 0) + 1); }
  const overflowText = overflow.size ? `\nNot listed (message size cap), by folder:\n${[...overflow].map(([d, n]) => `- ${n} under ${d}/`).join("\n")}\n` : "";
  if (overflow.size) console.warn(`Commit message lists ${listed.length} of ${toPrune.length} removed paths; the rest are counted by folder.`);
  const message = toPrune.length
    ? `sync: ${subject}\n\nRemoved from GitHub (not in the workspace), ${toPrune.length} file(s):\n${listed.map(p => `- ${p}`).join("\n")}\n${overflowText}`
    : `sync: ${subject}`;
  const commit = await withRetry("create commit", () => api(`/repos/${OWNER}/${REPO}/git/commits`, "POST", { message, tree, parents: [main] }), b => b?.sha);
  const ref = await withRetry("update ref", () => api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", { sha: commit, force: true }), b => b?.object?.sha);
  console.log(`\n✅ Pushed. main → ${String(ref).slice(0, 8)} (${uploaded} uploaded, ${toPrune.length} removed)`);
  report(remoteOnly.filter(p => !toPrune.includes(p)), accepted, skipped);
}
main().catch(e => { console.error("❌ PUSH FAILED:", e.message); process.exit(1); });
