/**
 * Pushes workspace files to GitHub repository via the GitHub Contents API.
 * Uses Replit GitHub connector (OAuth) — no personal token needed.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import * as fs from "fs";
import * as path from "path";

const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd";
const REPO = "sitesort";

const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".cache",
  ".local", "snippets", ".pnpm-store", "coverage",
  ".turbo", ".next", "*.lock",
]);

function shouldIgnore(name: string): boolean {
  if (IGNORE.has(name)) return true;
  if (name.endsWith(".lock")) return true;
  if (name.startsWith(".pnpm")) return true;
  return false;
}

function isBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pdf", ".zip", ".tar", ".gz",
  ]);
  return binaryExts.has(ext);
}

function collectFiles(dir: string, base: string, files: Array<{path: string, content: string}>) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, rel, files);
    } else if (entry.isFile()) {
      if (isBinary(full)) {
        const content = fs.readFileSync(full);
        files.push({ path: rel, content: content.toString("base64") });
      } else {
        try {
          const content = fs.readFileSync(full, "utf8");
          files.push({ path: rel, content: Buffer.from(content).toString("base64") });
        } catch {
          // skip unreadable files
        }
      }
    }
  }
}

async function apiCall(endpoint: string, method: string, body?: object) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await connectors.proxy("github", endpoint, opts);
  return resp.json();
}

async function main() {
  console.log("Collecting files...");
  const files: Array<{path: string, content: string}> = [];
  collectFiles("/home/runner/workspace", "", files);
  console.log(`Found ${files.length} files to push`);

  // Get default branch SHA
  const repoInfo = await apiCall(`/repos/${OWNER}/${REPO}`, "GET") as any;
  
  let baseTreeSha: string | undefined;
  let baseSha: string | undefined;
  try {
    const branch = await apiCall(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "GET") as any;
    if (branch.object?.sha) {
      baseSha = branch.object.sha;
      const commit = await apiCall(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`, "GET") as any;
      baseTreeSha = commit.tree?.sha;
    }
  } catch {
    // empty repo, no base
  }

  // Create blobs for all files in parallel batches
  console.log("Creating blobs...");
  const treeItems: Array<{path: string, mode: string, type: string, sha: string}> = [];
  const BATCH = 15;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    console.log(`  ${i}/${files.length}`);
    const results = await Promise.allSettled(
      batch.map(async (f) => {
        const blob = await apiCall(`/repos/${OWNER}/${REPO}/git/blobs`, "POST", {
          content: f.content,
          encoding: "base64",
        }) as any;
        return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") treeItems.push(r.value);
      else console.warn("  Skipped a file:", r.reason?.message ?? r.reason);
    }
  }

  // Create tree
  console.log("Creating tree...");
  const treeBody: any = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;
  const tree = await apiCall(`/repos/${OWNER}/${REPO}/git/trees`, "POST", treeBody) as any;

  // Create commit
  console.log("Creating commit...");
  const commitBody: any = {
    message: "Initial commit: SiteSort construction management platform",
    tree: tree.sha,
  };
  if (baseSha) commitBody.parents = [baseSha];
  const commit = await apiCall(`/repos/${OWNER}/${REPO}/git/commits`, "POST", commitBody) as any;

  // Update/create ref
  console.log("Updating ref...");
  if (baseSha) {
    await apiCall(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", {
      sha: commit.sha,
      force: true,
    });
  } else {
    await apiCall(`/repos/${OWNER}/${REPO}/git/refs`, "POST", {
      ref: "refs/heads/main",
      sha: commit.sha,
    });
  }

  console.log(`\nDone! Repository: https://github.com/${OWNER}/${REPO}`);
}

main().catch(console.error);
