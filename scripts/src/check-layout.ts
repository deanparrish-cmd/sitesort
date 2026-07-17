/**
 * pnpm run check:layout — renders every route (+ every project-detail tab,
 * + every portal section) at each configured viewport and fails the run if
 * any page has horizontal overflow (document.scrollWidth > clientWidth) or
 * a pill/action-bar element overlapping another marked element.
 *
 * Requires the single-origin dev bundle running locally:
 *   pnpm --filter @workspace/api-server run build && (cd artifacts/api-server && PORT=8080 node dist/index.mjs)
 *
 * IMPORTANT: this script WRITES test fixture data (a demo person + portal
 * invite) through the API. It deliberately does NOT read the shared APP_URL
 * env var (which this workspace points at production) — it always targets
 * localhost unless you explicitly pass LAYOUT_CHECK_URL, so a routine dev-time
 * run can never create test data on the live site.
 *
 * Env:
 *   LAYOUT_CHECK_URL=http://localhost:8080   target (default: localhost:8080)
 *   LAYOUT_VIEWPORTS=360,390,768,1024        comma list of widths (default: 360,768)
 */
import pw from "playwright-core";
const { chromium } = pw;

const APP_URL = process.env.LAYOUT_CHECK_URL || "http://localhost:8080";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL)) {
  console.error(
    `Refusing to run: LAYOUT_CHECK_URL "${APP_URL}" is not localhost.\n` +
      "This script creates test fixture data through the API — it must never target a shared/production URL.",
  );
  process.exit(2);
}
const VIEWPORTS = (process.env.LAYOUT_VIEWPORTS || "360,768")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n));
const DEMO_EMAIL = "paul@acme.com";
const DEMO_PASSWORD = "password123";

type RouteSpec = { path: string; label: string; auth: "none" | "app" | "portal" };

type FailureReason = { kind: "overflow"; scrollWidth: number; clientWidth: number } | { kind: "overlap"; a: string; b: string };

type Result = { label: string; path: string; width: number; ok: boolean; reasons: FailureReason[] };

function requireExec(): string {
  const exec = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!exec) {
    console.error(
      "REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set — no wired Chromium found.\n" +
        "Run: ls -d /nix/store/*playwright-browsers*/chromium-*/chrome-linux/chrome\n" +
        "and export the path as REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE.",
    );
    process.exit(2);
  }
  return exec;
}

async function apiLogin(email: string, password: string): Promise<{ token: string; companyId: string }> {
  const res = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token?: string; user: { companyId: string; token?: string } };
  return { token: body.token ?? body.user?.token ?? "", companyId: body.user.companyId };
}

async function apiJson(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Sets up one project-detail target and one portal-session target to test against. */
async function setupFixtures(appToken: string) {
  const projects: Array<{ id: string; name: string }> = await apiJson("/api/projects", appToken);
  if (!projects.length) throw new Error("No projects found on the demo company — cannot test project-detail tabs.");
  const projectId = projects[0].id;

  // Portal fixture: create (or reuse, dedupes on email) an in-house person, invite
  // them to the project, accept the invite to mint a portal session token.
  const person = await apiJson(`/api/projects/${projectId}/in-house-people`, appToken, {
    method: "POST",
    body: JSON.stringify({ firstName: "Layout", lastName: "Checker", email: "layout-checker@sitesort.test" }),
  });
  const invite = await apiJson(`/api/projects/${projectId}/portal-invites`, appToken, {
    method: "POST",
    body: JSON.stringify({ personId: person.id }),
  });

  let portalToken: string | null = null;
  if (invite.inviteUrl) {
    const token = invite.inviteUrl.split("/portal/accept/")[1];
    const accepted = await apiJson(`/api/portal/invite/${token}/accept`, "", {
      method: "POST",
      body: JSON.stringify({ password: "LayoutCheck123!" }),
      headers: {},
    });
    portalToken = accepted.token ?? null;
  }
  // Already-a-member / grant-only path (person already had portal access): log in directly.
  if (!portalToken) {
    const res = await fetch(`${APP_URL}/api/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "layout-checker@sitesort.test", password: "LayoutCheck123!", projectId }),
    });
    if (res.ok) portalToken = (await res.json()).token;
  }

  return { projectId, portalToken };
}

function buildRoutes(projectId: string, hasPortal: boolean): RouteSpec[] {
  const routes: RouteSpec[] = [
    { path: "/", label: "landing", auth: "none" },
    { path: "/login", label: "login", auth: "none" },
    { path: "/register", label: "register", auth: "none" },
    { path: "/forgot-password", label: "forgot-password", auth: "none" },
    { path: "/portal/login", label: "portal-login", auth: "none" },

    { path: "/dashboard", label: "dashboard", auth: "app" },
    { path: "/projects", label: "projects-list", auth: "app" },
    { path: "/subcontractors", label: "contacts", auth: "app" },
    { path: "/compliance", label: "compliance", auth: "app" },
    { path: "/qr", label: "qr", auth: "app" },
    { path: "/team", label: "in-house-team", auth: "app" },
    { path: "/messages", label: "messages", auth: "app" },
    { path: "/notifications", label: "notifications", auth: "app" },
    { path: "/settings", label: "settings", auth: "app" },
    { path: "/invoices", label: "invoices", auth: "app" },
    { path: "/daily-reports", label: "daily-reports", auth: "app" },
    { path: "/issues", label: "issues", auth: "app" },
    { path: "/checkins", label: "checkins", auth: "app" },
    { path: "/admin", label: "admin", auth: "app" },
  ];

  const tabs = ["overview", "progress", "team", "issues", "qr", "documents", "permits", "closeout", "finances", "checkins", "reports", "teamportal"];
  for (const tab of tabs) {
    routes.push({ path: `/projects/${projectId}?tab=${tab}`, label: `project-detail:${tab}`, auth: "app" });
  }

  if (hasPortal) {
    const sections = ["overview", "shared", "settings", "progress", "team", "site-issues", "site-board", "hs", "drawings", "method-statements", "permits", "safety", "general"];
    for (const section of sections) {
      routes.push({ path: `/portal/${section}`, label: `portal:${section}`, auth: "portal" });
    }
  }

  return routes;
}

async function main() {
  const exec = requireExec();
  console.log(`Layout check against ${APP_URL} @ viewports [${VIEWPORTS.join(", ")}]`);

  const health = await fetch(`${APP_URL}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`App not reachable at ${APP_URL}/api/health. Build + start the api-server first:\n` +
      `  pnpm --filter @workspace/api-server run build && (cd artifacts/api-server && PORT=8080 node dist/index.mjs)`);
    process.exit(2);
  }

  const { token: appToken } = await apiLogin(DEMO_EMAIL, DEMO_PASSWORD);
  const { projectId, portalToken } = await setupFixtures(appToken);
  if (!portalToken) console.warn("Could not mint a portal session — portal routes will be skipped.");

  const routes = buildRoutes(projectId, !!portalToken);

  const browser = await chromium.launch({ executablePath: exec, args: ["--no-sandbox"] });
  const results: Result[] = [];

  for (const width of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height: 900 });

    // Seed both possible tokens before any navigation so every route (app or
    // portal) is already authenticated on first paint.
    await page.addInitScript(
      ({ appToken, portalToken }) => {
        localStorage.setItem("sitesort_token", appToken);
        if (portalToken) localStorage.setItem("sitesort_portal_token", portalToken);
      },
      { appToken, portalToken },
    );

    for (const route of routes) {
      if (route.auth === "portal" && !portalToken) continue;
      try {
        await page.goto(`${APP_URL}${route.path}`, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForTimeout(500);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        const overlaps: Array<{ a: string; b: string }> = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('[data-ll="pill"], [data-ll="actionbar"]'));
          const rects = els.map((el) => ({ el, rect: el.getBoundingClientRect() }));
          const out: Array<{ a: string; b: string }> = [];
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i], b = rects[j];
              if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
              if (a.rect.width === 0 || a.rect.height === 0 || b.rect.width === 0 || b.rect.height === 0) continue;
              const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
              const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
              if (overlapX > 2 && overlapY > 2) {
                out.push({ a: (a.el.textContent || "").trim().slice(0, 40), b: (b.el.textContent || "").trim().slice(0, 40) });
              }
            }
          }
          return out;
        });

        const reasons: FailureReason[] = [];
        if (scrollWidth > clientWidth + 1) reasons.push({ kind: "overflow", scrollWidth, clientWidth });
        for (const o of overlaps) reasons.push({ kind: "overlap", a: o.a, b: o.b });

        results.push({ label: route.label, path: route.path, width, ok: reasons.length === 0, reasons });
      } catch (err) {
        results.push({
          label: route.label,
          path: route.path,
          width,
          ok: false,
          reasons: [{ kind: "overflow", scrollWidth: -1, clientWidth: -1 }],
        });
        console.error(`  ! ${route.label} @ ${width}px threw: ${(err as Error).message}`);
      }
    }
    await page.close();
  }

  await browser.close();

  const failures = results.filter((r) => !r.ok);
  const passes = results.filter((r) => r.ok);

  console.log(`\n${"PATH".padEnd(30)} ${"WIDTH".padEnd(8)} RESULT`);
  console.log("-".repeat(60));
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`${r.label.padEnd(30)} ${String(r.width).padEnd(8)} ${status}`);
    if (!r.ok) {
      for (const reason of r.reasons) {
        if (reason.kind === "overflow") {
          console.log(`    overflow: scrollWidth=${reason.scrollWidth} > clientWidth=${reason.clientWidth}`);
        } else {
          console.log(`    overlap: "${reason.a}" intersects "${reason.b}"`);
        }
      }
    }
  }

  console.log(`\n${passes.length}/${results.length} checks passed.`);
  if (failures.length > 0) {
    console.error(`${failures.length} layout check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
