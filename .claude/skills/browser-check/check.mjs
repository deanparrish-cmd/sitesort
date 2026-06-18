#!/usr/bin/env node
/**
 * SiteSort browser check — drives the already-running app with headless Chromium.
 *
 * Usage:
 *   node check.mjs [path] [--shot <file>]
 *   node check.mjs /login
 *   node check.mjs /projects --shot projects.png
 *
 * It navigates to APP_URL + path, screenshots it, and reports HTTP status,
 * page title, form-control counts, and any console / runtime errors. Exits
 * non-zero if the navigation fails or any page error is seen.
 *
 * Why this shape (see SKILL.md): the app is already served by the Replit
 * workflow on :18299, so we attach rather than launch. The npm-downloaded
 * chromium is missing system libs, so we use Replit's Nix-wired binary via
 * REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL || "http://localhost:18299";
const EXEC = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const SHOT_DIR = "/tmp/browser-check";

// --- args ---
const args = process.argv.slice(2);
let path = "/login";
let shot = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--shot") shot = args[++i];
  else if (!args[i].startsWith("--")) path = args[i];
}
if (!path.startsWith("/")) path = "/" + path;
mkdirSync(SHOT_DIR, { recursive: true });
const shotPath = shot
  ? (isAbsolute(shot) ? shot : resolve(SHOT_DIR, shot))
  : resolve(SHOT_DIR, (path.replace(/[^a-z0-9]+/gi, "_") || "root") + ".png");

if (!EXEC) {
  console.error(
    "REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set — no wired Chromium found.\n" +
    "This skill relies on Replit's Nix-provided browser. If the var is missing, run\n" +
    "  ls -d /nix/store/*playwright-browsers*/chromium-*/chrome-linux/chrome\n" +
    "and export the path as REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE.",
  );
  process.exit(2);
}

// --- ensure playwright-core (self-heal) ---
async function loadChromium() {
  try {
    return (await import("playwright-core")).chromium;
  } catch {
    console.error("playwright-core not found in skill dir — installing (one-time)…");
    execSync("npm init -y >/dev/null 2>&1 || true", { cwd: SKILL_DIR });
    execSync("npm i playwright-core@1.55.0", { cwd: SKILL_DIR, stdio: "inherit" });
    return (await import("playwright-core")).chromium;
  }
}

const chromium = await loadChromium();
const target = APP_URL + path;
const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(e.message));

let status = null;
try {
  const resp = await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
  status = resp?.status() ?? null;
  await page.waitForTimeout(700);
} catch (e) {
  console.error("navigation failed:", e.message);
  await browser.close();
  process.exit(1);
}

const title = await page.title();
const inputs = await page.locator("input").count();
const buttons = await page.locator("button").count();
const bodyText = (await page.locator("body").innerText()).slice(0, 240).replace(/\s+/g, " ").trim();
await page.screenshot({ path: shotPath, fullPage: true });

console.log(`URL:        ${target}`);
console.log(`HTTP:       ${status}`);
console.log(`Title:      ${title}`);
console.log(`Controls:   ${inputs} input(s), ${buttons} button(s)`);
console.log(`Text:       ${bodyText}`);
console.log(`Screenshot: ${shotPath}`);
console.log(`Console errors: ${consoleErrors.length ? "\n  - " + consoleErrors.join("\n  - ") : "none"}`);
console.log(`Page errors:    ${pageErrors.length ? "\n  - " + pageErrors.join("\n  - ") : "none"}`);

await browser.close();
process.exit(pageErrors.length ? 1 : 0);
