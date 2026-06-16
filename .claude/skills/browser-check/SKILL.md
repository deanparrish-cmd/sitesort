---
name: browser-check
description: Launch and drive the SiteSort web app in a headless browser to verify a page renders and works — screenshots it, checks console/runtime errors, and can fill/click to test forms. Use to confirm a frontend change works in the real app.
---

# browser-check — drive SiteSort in a real browser

Verifies the SiteSort frontend the way a user meets it: loads a page in
headless Chromium, screenshots it, and reports HTTP status, page title,
form-control counts, and any console/runtime errors.

## TL;DR

```bash
node .claude/skills/browser-check/check.mjs /login
```

Then **Read the screenshot** it prints (`/tmp/browser-check/<path>.png`) — a
blank frame means the page failed to render. A clean run prints `Console
errors: none` / `Page errors: none` and exits 0.

First run auto-installs `playwright-core` into the skill dir (one-time, needs
network). Pass any route: `/login`, `/projects`, `/settings`, etc.

## Why this exact setup (don't rediscover)

1. **Attach, don't launch.** The app is already served by the Replit
   workflow — Vite frontend on **:18299**, Express API on **:8080**. Just
   point the browser at `http://localhost:18299`.
   - Running `pnpm --filter @workspace/sitesort run dev` yourself fails: the
     Vite config requires `PORT` **and** `BASE_PATH` env vars.
   - The Vite dev server does **not** proxy `/api` → :8080 (returns 404).
     Real `/api` routing is done by Replit's router, not in local dev, so a
     full **login round-trip can't be tested locally** — only client-side
     behaviour (render, form validation). Hit `:8080` directly for raw API.

2. **Use Replit's Nix-wired Chromium.** `npx playwright install chromium`
   downloads a headless-shell that crashes with `libglib-2.0.so.0: cannot
   open shared object file` (missing system libs, no apt/root to fix it).
   Replit provides a working browser via the env var
   `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (a Nix `playwright-browsers`
   chrome with all deps wired). The script uses it automatically. Launch
   with `--no-sandbox`.

3. **`playwright-core`, pinned to 1.55.0** to match the Nix browser revision
   (chromium-1187 / playwright 1.55). It's CommonJS — import the default and
   destructure (`import pw from 'playwright-core'; const { chromium } = pw`).

## Driving deeper (interactions)

The base script only navigates + screenshots. To test a form, copy it and
add `fill`/`click`. Example that confirmed the login zod validation:

```js
await page.fill('input[type="email"]', 'paul@acme.com');
await page.click('button[type="submit"]');     // valid email, empty password
await page.waitForTimeout(700);
// react-hook-form + zodResolver should render "Password is required"
```

Note: `<input type="email">` triggers the browser's **native** HTML5
validation first (an "@ is missing" tooltip) before zod runs — to exercise
zod's email rule specifically, you must bypass native validation (e.g. set
the form to `noValidate`, or test a field with no native constraint like the
password).

## Demo credentials

`paul@acme.com` / `password123` (company: Acme Construction).

## Files

- `check.mjs` — the driver (self-heals `playwright-core`, uses the Nix
  Chromium, screenshots to `/tmp/browser-check/`).
