import pw from "playwright-core";
const { chromium } = pw;

const EXEC = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const APP_URL = "http://localhost:8080";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", err => pageErrors.push(String(err)));

await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', "paul@acme.com");
await page.fill('input[type="password"]', "password123");
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);
console.log("After login, URL:", page.url());

await page.goto(`${APP_URL}/notifications`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

const target = page.getByText("New document from portal", { exact: false }).first();
const count = await target.count();
console.log("Found notification row:", count > 0);
if (count > 0) {
  await target.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/claude-1000/-home-runner-workspace/94b2d598-6269-4ff1-b693-87f86fa6a326/scratchpad/notif-dialog.png" });
  const openBtn = page.getByRole("button", { name: "Open", exact: true });
  const openCount = await openBtn.count();
  console.log("Found Open button in dialog:", openCount > 0);
  if (openCount > 0) {
    await openBtn.click();
    await page.waitForTimeout(1500);
  }
  console.log("After click, URL:", page.url());
  await page.screenshot({ path: "/tmp/claude-1000/-home-runner-workspace/94b2d598-6269-4ff1-b693-87f86fa6a326/scratchpad/notif-after-click.png" });
} else {
  await page.screenshot({ path: "/tmp/claude-1000/-home-runner-workspace/94b2d598-6269-4ff1-b693-87f86fa6a326/scratchpad/notif-list.png" });
}

console.log("Console errors:", consoleErrors.length ? consoleErrors : "none");
console.log("Page errors:", pageErrors.length ? pageErrors : "none");
await browser.close();
