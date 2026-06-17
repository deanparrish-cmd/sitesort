import pw from "playwright-core";
const { chromium } = pw;
const APP = "http://localhost:18299", API = "http://localhost:8080";
const EXEC = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const token = (await (await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "paul@acme.com", password: "password123" }) })).json()).token;
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
for (const vp of [{ n: "mobile", w: 390 }, { n: "tablet", w: 820 }, { n: "desktop", w: 1280 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: 1500 } });
  await ctx.addInitScript((t) => localStorage.setItem("sitesort_token", t), token);
  await ctx.route("**/api/**", async (r) => { try { await r.fulfill({ response: await r.fetch({ url: r.request().url().replace(APP, API) }) }); } catch { await r.abort(); } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.getByText("Site Calendar").scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  // count notification dots (bg-destructive corner badges) and event-bearing day buttons
  const notifDots = await page.locator("div.grid-cols-7.gap-y-1 span.bg-destructive").count();
  const eventDays = await page.locator("div.grid-cols-7.gap-y-1 > button:has(span.h-1\\.5)").count();
  // notification dots should appear on exactly the days that have event type-dots
  // crop the calendar for a visual
  const cal = page.locator("div.grid-cols-7.gap-y-1");
  await cal.screenshot({ path: `/tmp/browser-check/cal_dots_${vp.n}.png` }).catch(() => {});
  console.log(`[${vp.n}] notification dots: ${notifDots} | event days: ${eventDays} | match: ${notifDots === eventDays} | errors: ${errs.length || "none"}`);
  await ctx.close();
}
await browser.close();
