import pw from "playwright-core";
const { chromium } = pw;

const APP_URL = "http://localhost:8080";
const EXEC = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const INVITE_TOKEN = process.env.INVITE_TOKEN;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => pageErrors.push(e.stack || e.message));
page.on("response", async (res) => {
  if (res.url().includes("/portal/invite/") || res.url().includes("/portal/me") || res.url().includes("/portal/unseen")) {
    let body = ""; try { body = await res.text(); } catch {}
    console.log(`NETWORK ${res.request().method()} ${res.url()} -> ${res.status()}\n  ${body.slice(0, 400)}`);
  }
});

await page.goto(`${APP_URL}/portal/accept/${INVITE_TOKEN}`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);

console.log("=== Page after loading accept form ===");
console.log((await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 300));

await page.locator('input[placeholder*="Choose a password"]').fill("testpass1234");
await page.locator('input[placeholder="Confirm password"]').fill("testpass1234");
console.log("Submitting set-password form...");
await page.getByRole("button", { name: /Set password/i }).click();

// Give the SPA navigation into /portal/overview time to complete (or crash).
await page.waitForTimeout(4000);

console.log("=== URL after submit ===", page.url());
const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
console.log("=== BODY TEXT (first 400 chars) ===");
console.log(bodyText.slice(0, 400));
console.log("=== ERROR BOUNDARY VISIBLE? ===", bodyText.includes("hit an unexpected problem"));

await page.screenshot({ path: "/tmp/claude-1000/-home-runner-workspace/33b03f88-4416-4bde-b76d-029c8c66b222/scratchpad/accept-crash.png", fullPage: true });

console.log("=== CONSOLE MESSAGES (all types incl. errors) ===");
console.log(consoleErrors.length ? consoleErrors.join("\n---\n") : "none");
console.log("=== PAGE ERRORS (uncaught exceptions) ===");
console.log(pageErrors.length ? pageErrors.join("\n---\n") : "none");

await browser.close();
