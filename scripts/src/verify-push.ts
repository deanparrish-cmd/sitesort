/**
 * Verify a push-robust.ts push actually landed on GitHub main.
 *
 * Compares git blob SHAs (the same content-addressed hash GitHub's Contents
 * API returns) for every file changed in a local commit against what's on
 * GitHub `main`, so this stays correct for whatever was just pushed instead
 * of a fixed, hand-maintained list of signature strings that silently goes
 * stale the moment a different commit is pushed.
 *
 * Usage: tsx ./src/verify-push.ts [ref]   (defaults to HEAD)
 */
import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import { execFileSync } from "child_process";

const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
const WORKDIR = "/home/runner/workspace";
// Must match push-robust.ts's MAX_BYTES — files above this are never pushed.
const MAX_BYTES = 650 * 1024;

async function api(endpoint: string) {
  const resp = await connectors.proxy("github", endpoint, { method: "GET", headers: { "Content-Type": "application/json" } } as ProxyOptions);
  const status = (resp as any).status;
  const text = await (resp as any).text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { __raw: text.slice(0, 120) }; }
  return { status, body: parsed };
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: WORKDIR, encoding: "utf8" }).trim();
}

async function main() {
  const ref = process.argv[2] ?? "HEAD";

  const changedRaw = git(["diff-tree", "--no-commit-id", "--name-status", "-r", ref]);
  const changed = changedRaw.split("\n").filter(Boolean).map(line => {
    const parts = line.split("\t");
    return { status: parts[0], path: parts[parts.length - 1] };
  }).filter(f => f.status !== "D"); // additive pushes never delete remote files

  if (changed.length === 0) {
    console.log(`No file changes in ${ref} (empty commit, or nothing to verify).`);
    return;
  }

  const mainRefResp = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const mainSha = mainRefResp.body?.object?.sha;
  console.log(`Verifying ${changed.length} file(s) changed in ${ref} against GitHub main (${String(mainSha).slice(0, 8)})\n`);

  let ok = 0;
  const mismatched: string[] = [];
  const skippedOversized: string[] = [];
  const missing: string[] = [];

  for (const { path } of changed) {
    const size = Number(git(["cat-file", "-s", `${ref}:${path}`]));
    if (size > MAX_BYTES) {
      console.log(`⏭️  ${path}  skipped (${(size / 1024).toFixed(0)}KB, over push-robust's 650KB limit by design)`);
      skippedOversized.push(path);
      continue;
    }
    const localSha = git(["rev-parse", `${ref}:${path}`]);
    const remote = await api(`/repos/${OWNER}/${REPO}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=main`);
    const remoteSha = remote.body?.sha;
    if (!remoteSha) {
      console.log(`❌ ${path}  MISSING on GitHub (HTTP ${remote.status}: ${JSON.stringify(remote.body).slice(0, 100)})`);
      missing.push(path);
    } else if (remoteSha === localSha) {
      console.log(`✅ ${path}`);
      ok++;
    } else {
      console.log(`❌ ${path}  MISMATCH (local ${localSha.slice(0, 8)} vs remote ${remoteSha.slice(0, 8)})`);
      mismatched.push(path);
    }
  }

  const checked = changed.length - skippedOversized.length;
  console.log(`\n${ok}/${checked} verified matching on GitHub main` + (skippedOversized.length ? ` (${skippedOversized.length} intentionally skipped, oversized)` : "") + ".");
  if (mismatched.length || missing.length) {
    console.log("NEEDS RE-PUSH:", [...mismatched, ...missing].join(", "));
    process.exit(1);
  }
  console.log("All changed files verified on GitHub.");
}
main().catch(e => { console.error("verify failed:", e.message); process.exit(1); });
