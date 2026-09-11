/**
 * pnpm run check:layout
 *
 * Renders every route in the frontend router, every project-detail tab, and
 * every portal section at each configured viewport. The route and section
 * inventories are read from the source files instead of being maintained as a
 * second, inevitably stale list in this script.
 *
 * The check is deliberately local-only. It creates a real project/member/QR
 * fixture through the local API, so targeting a shared or production URL is a
 * hard error. Fixture setup is also fail-closed: a missing portal token,
 * dynamic route value, member grant, or QR token aborts the check instead of
 * silently reducing coverage.
 *
 * Requires the single-origin dev bundle running locally:
 *   pnpm --filter @workspace/api-server run build && (cd artifacts/api-server && PORT=8080 node dist/index.mjs)
 *
 * Env:
 *   LAYOUT_CHECK_URL=http://localhost:8080
 *   LAYOUT_VIEWPORTS=360,390,768
 *   LAYOUT_REPORT_PATH=reports/layout-check.json
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pw from "playwright-core";

const { chromium } = pw;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FRONTEND_SOURCE = resolve(REPO_ROOT, "artifacts/sitesort/src");
const APP_SOURCE_PATH = resolve(FRONTEND_SOURCE, "App.tsx");
const PORTAL_LAYOUT_SOURCE_PATH = resolve(FRONTEND_SOURCE, "pages/portal/layout.tsx");
const PORTAL_SECTION_SOURCE_PATH = resolve(FRONTEND_SOURCE, "pages/portal/section.tsx");
const PORTAL_ACTIVITY_SOURCE_PATH = resolve(REPO_ROOT, "artifacts/api-server/src/lib/activity.ts");
const PROJECT_TABS_SOURCE_PATH = resolve(FRONTEND_SOURCE, "pages/projects/detail/tab-config.ts");
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "reports/layout-check.json");

const APP_URL = process.env.LAYOUT_CHECK_URL || "http://localhost:8080";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL)) {
  console.error(
    `Refusing to run: LAYOUT_CHECK_URL "${APP_URL}" is not localhost.\n` +
      "This script creates test fixture data through the API — it must never target a shared/production URL.",
  );
  process.exit(2);
}

const VIEWPORTS = (process.env.LAYOUT_VIEWPORTS || "360,390,768")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
if (VIEWPORTS.length === 0) {
  console.error("LAYOUT_VIEWPORTS must contain at least one positive viewport width.");
  process.exit(2);
}

const REPORT_PATH = process.env.LAYOUT_REPORT_PATH
  ? resolve(REPO_ROOT, process.env.LAYOUT_REPORT_PATH)
  : DEFAULT_REPORT_PATH;

const DEMO_EMAIL = "paul@acme.com";
const DEMO_PASSWORD = "password123";
const FIXTURE_EMAIL = "layout-checker@sitesort.test";
const FIXTURE_PASSWORD = "LayoutCheck123!";
const ADMIN_FIXTURE_PASSWORD = "LayoutAdminCheck123!";
const BCRYPT_MODULE = "bcryptjs";

type AuthMode = "none" | "app" | "portal";
type RouteSpec = { path: string; label: string; auth: AuthMode };
type FixtureData = {
  projectId: string;
  portalToken: string;
  inviteToken: string;
  siteToken: string;
};

type AdminFixture = {
  companyId: string;
  userId: string;
  token: string;
};

type BcryptModule = {
  default: { hash(value: string, rounds: number): Promise<string> };
};

type FailureReason =
  | { kind: "overflow"; scrollWidth: number; clientWidth: number; element?: string; right?: number; left?: number; probe?: string }
  | { kind: "overlap"; a: string; b: string; probe?: string }
  | { kind: "stacking"; target: string; hit: string; x: number; y: number; probe?: string }
  | { kind: "api"; method: string; status: number; url: string }
  | { kind: "navigation"; message: string };

type LayoutMetrics = {
  scrollWidth: number;
  clientWidth: number;
  viewportWidth: number;
  overflowElements: Array<{ element: string; left: number; right: number }>;
  overlaps: Array<{ a: string; b: string }>;
  stacking: Array<{ target: string; hit: string; x: number; y: number }>;
};

type Result = {
  label: string;
  path: string;
  width: number;
  finalPath?: string;
  ok: boolean;
  reasons: FailureReason[];
  metrics?: LayoutMetrics;
  probes?: Array<{ name: string; metrics: LayoutMetrics }>;
};

type ApiFailure = { method: string; status: number; url: string };

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read route source ${path}: ${(error as Error).message}`);
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function quotedValues(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}

/**
 * The Wouter router is the source of truth for top-level routes. A route with
 * a dynamic segment is retained as a template until setupFixtures supplies a
 * real value for it. The generic portal segment is expanded from the portal
 * section sources below.
 */
function discoverAppRouteTemplates(): string[] {
  const source = readSource(APP_SOURCE_PATH);
  const paths = quotedValues(source, /<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["'][^>]*>/g);
  if (paths.length === 0) throw new Error(`No <Route path="..."> entries found in ${APP_SOURCE_PATH}`);
  for (const path of paths) {
    if (!path.startsWith("/")) throw new Error(`Unsupported route path discovered in App.tsx: ${path}`);
  }
  return unique(paths);
}

function discoverPortalSections(): string[] {
  const frontendLayout = readSource(PORTAL_LAYOUT_SOURCE_PATH);
  const frontendSection = readSource(PORTAL_SECTION_SOURCE_PATH);
  const backendActivity = readSource(PORTAL_ACTIVITY_SOURCE_PATH);

  // SECTION_NAV is the frontend's destination/permission source of truth.
  const navKeys = quotedValues(frontendLayout, /\bkey:\s*["']([^"']+)["']/g);
  // renderSection includes legacy deep-links that remain intentionally
  // routable even though they now land on Home or an empty filtered view.
  const renderedKeys = quotedValues(frontendSection, /\bcase\s+["']([^"']+)["']\s*:/g);
  const allowlistBody = backendActivity.match(/PORTAL_SECTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const serverKeys = allowlistBody
    ? quotedValues(allowlistBody[1], /["']([^"']+)["']/g)
    : [];
  const sections = unique([...navKeys, ...renderedKeys, ...serverKeys]);
  if (sections.length === 0) {
    throw new Error("No portal sections discovered from frontend nav/rendering or server allowlist.");
  }
  return sections;
}

function discoverProjectTabs(): string[] {
  const source = readSource(PROJECT_TABS_SOURCE_PATH);
  const tabs = quotedValues(source, /\bvalue:\s*["']([^"']+)["']/g);
  if (tabs.length === 0) throw new Error(`No project-detail tabs found in ${PROJECT_TABS_SOURCE_PATH}`);
  return unique(tabs);
}

function labelForPath(path: string): string {
  if (path === "/") return "landing";
  return path
    .replace(/^\//, "")
    .replace(/\/:[^/]+/g, "")
    .replace(/[/?=&-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-") || "root";
}

function resolveDynamicPath(path: string, fixtures: Record<string, string>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_whole, name: string) => {
    const value = fixtures[name];
    if (!value) {
      throw new Error(`No fixture value exists for dynamic route parameter ":${name}" in ${path}`);
    }
    return encodeURIComponent(value);
  });
}

function buildRoutes(fixtures: FixtureData): RouteSpec[] {
  const templates = discoverAppRouteTemplates();
  const portalSections = discoverPortalSections();
  const projectTabs = discoverProjectTabs();
  const publicRoutes = new Set([
    "/",
    "/info",
    "/login",
    "/register",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/forgot-pin",
    "/reset-pin",
    "/guide",
    "/site/:token",
    "/portal/login",
    "/portal/accept/:token",
    "/portal/forgot-password",
    "/portal/reset-password",
    "/portal",
  ]);

  const routes: RouteSpec[] = [];
  for (const template of templates) {
    // /portal/:section is the generic expansion point. Testing it literally
    // would only render "Section not found", so each source-discovered section
    // below is the meaningful concrete route.
    if (template === "/portal/:section") continue;
    const dynamicFixtures: Record<string, string> =
      template === "/projects/:id"
        ? { id: fixtures.projectId }
        : template === "/site/:token"
        ? { token: fixtures.siteToken }
        : template === "/portal/accept/:token"
        ? { token: fixtures.inviteToken }
        : {};
    const path = resolveDynamicPath(template, dynamicFixtures);
    const auth: AuthMode = template.startsWith("/portal/") && !publicRoutes.has(template)
      ? "portal"
      : template.startsWith("/portal/")
      ? "none"
      : publicRoutes.has(template)
      ? "none"
      : "app";
    routes.push({ path, label: labelForPath(template), auth });
  }

  for (const tab of projectTabs) {
    routes.push({
      path: `/projects/${encodeURIComponent(fixtures.projectId)}?tab=${encodeURIComponent(tab)}`,
      label: `project-detail:${tab}`,
      auth: "app",
    });
  }
  for (const section of portalSections) {
    routes.push({ path: `/portal/${encodeURIComponent(section)}`, label: `portal:${section}`, auth: "portal" });
  }

  const deduped = new Map<string, RouteSpec>();
  for (const route of routes) deduped.set(`${route.path}|${route.auth}`, route);
  return [...deduped.values()];
}

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
  const body = (await res.json()) as { token?: string; user?: { companyId?: string; token?: string } };
  const token = body.token ?? body.user?.token ?? "";
  if (!token || !body.user?.companyId) throw new Error(`login for ${email} returned no usable token/company`);
  return { token, companyId: body.user.companyId };
}

/**
 * The production admin API deliberately has no bootstrap endpoint: only a
 * platform admin can grant platform-admin.  The layout gate therefore creates
 * a short-lived internal-staff row directly in the local development database.
 * It never changes the authority of the demo account (or any existing user),
 * and is removed in main's finally block even when a layout assertion fails.
 */
async function setupAdminFixture(): Promise<AdminFixture> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to create the dedicated local platform-admin layout fixture; refusing to downgrade /admin coverage.",
    );
  }
  const suffix = randomUUID();
  const companyId = `layout-check-admin-company-${suffix}`;
  const userId = `layout-check-admin-user-${suffix}`;
  const memberId = `layout-check-admin-member-${suffix}`;
  const email = `layout-check-admin-${suffix}@sitesort.test`;
  // Keep the package name indirect so this script can be typechecked before
  // a newly declared workspace dependency is linked by pnpm.
  const bcrypt = await import(BCRYPT_MODULE) as BcryptModule;
  const passwordHash = await bcrypt.default.hash(ADMIN_FIXTURE_PASSWORD, 10);

  try {
    runFixtureSql(`
      INSERT INTO companies (id, name, subscription_status)
      VALUES ('${companyId}', 'Layout Check Platform Admin', 'active');
      INSERT INTO users (id, company_id, email, password_hash, name, role, email_verified, platform_admin)
      VALUES ('${userId}', '${companyId}', '${email}', '${passwordHash}', 'Layout Check Platform Admin', 'admin', true, true);
      INSERT INTO company_members (id, user_id, company_id, role)
      VALUES ('${memberId}', '${userId}', '${companyId}', 'admin');
    `);
    const login = await apiLogin(email, ADMIN_FIXTURE_PASSWORD);
    if (!login.token || login.companyId !== companyId) {
      throw new Error("Dedicated platform-admin fixture login did not return its own authenticated company context.");
    }
    return { companyId, userId, token: login.token };
  } catch (error) {
    await cleanupAdminFixture({ companyId, userId }).catch(() => {});
    throw error;
  }
}

async function cleanupAdminFixture(fixture: Pick<AdminFixture, "companyId" | "userId">): Promise<void> {
  // These IDs are generated exclusively above. Delete the identity first so
  // its cascading company-membership row cannot leave a company FK behind.
  runFixtureSql(`
    DELETE FROM users WHERE id = '${fixture.userId}';
    DELETE FROM companies WHERE id = '${fixture.companyId}';
  `);
}

function runFixtureSql(sql: string): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the local layout fixture database connection.");
  const database = new URL(databaseUrl);
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "-q", "-c", sql],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: database.hostname,
        PGPORT: database.port || "5432",
        PGUSER: decodeURIComponent(database.username),
        PGPASSWORD: decodeURIComponent(database.password),
        PGDATABASE: decodeURIComponent(database.pathname.replace(/^\//, "")),
        ...(database.searchParams.get("sslmode") ? { PGSSLMODE: database.searchParams.get("sslmode")! } : {}),
      },
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Could not manage the dedicated platform-admin layout fixture: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

async function apiJson(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function inviteTokenFromUrl(inviteUrl: unknown): string {
  if (typeof inviteUrl !== "string") throw new Error("Portal invite response did not include inviteUrl");
  const match = inviteUrl.match(/\/portal\/accept\/([^/?#]+)/);
  if (!match?.[1]) throw new Error(`Portal invite URL did not contain an acceptance token: ${inviteUrl}`);
  return decodeURIComponent(match[1]);
}

/**
 * Creates/reuses one authentic project fixture, accepts its portal invite,
 * grants all portal write permissions, and ensures the public site-board route
 * has a real QR token. Every assertion is intentional: skipping a fixture
 * means silently skipping a route, which is worse than a failed check.
 */
async function setupFixtures(appToken: string): Promise<FixtureData> {
  const projects = await apiJson("/api/projects", appToken) as Array<{ id?: string; name?: string }>;
  const projectId = projects[0]?.id;
  if (!projectId) throw new Error("No projects found on the demo company — cannot resolve dynamic project routes.");

  const person = await apiJson(`/api/projects/${projectId}/in-house-people`, appToken, {
    method: "POST",
    body: JSON.stringify({ firstName: "Layout", lastName: "Checker", email: FIXTURE_EMAIL }),
  }) as { id?: string };
  if (!person.id) throw new Error("Fixture person creation returned no person id.");

  // The invite endpoint deliberately assumes the person is already on the
  // project. Add the person-backed membership first, while allowing a repeat
  // sweep to reuse the existing row.
  try {
    await apiJson(`/api/projects/${projectId}/members/person`, appToken, {
      method: "POST",
      body: JSON.stringify({ personId: person.id, role: "worker" }),
    });
  } catch (error) {
    if (!/HTTP 409\b/.test((error as Error).message)) throw error;
  }

  const invite = await apiJson(`/api/projects/${projectId}/portal-invites`, appToken, {
    method: "POST",
    body: JSON.stringify({ personId: person.id }),
  }) as { inviteUrl?: string; status?: string };
  const acceptanceToken = inviteTokenFromUrl(invite.inviteUrl);

  let portalToken = "";
  let accepted: { token?: string } | null = null;
  try {
    accepted = await apiJson(`/api/portal/invite/${encodeURIComponent(acceptanceToken)}/accept`, "", {
      method: "POST",
      body: JSON.stringify({ password: FIXTURE_PASSWORD }),
    }) as { token?: string };
  } catch (error) {
    // Re-running a local sweep rotates/reuses an invite that may already have
    // been consumed. Only that expected idempotency case may fall through to
    // login. A server error or malformed response must fail closed.
    if (!/HTTP (400|409)\b/.test((error as Error).message)) throw error;
  }
  if (accepted?.token) portalToken = accepted.token;

  // An accepted/reused fixture has no new token. Login is the supported
  // idempotent path for subsequent local sweeps.
  if (!portalToken) {
    const login = await fetch(`${APP_URL}/api/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD, projectId }),
    });
    if (login.ok) {
      const body = await login.json() as { token?: string };
      portalToken = body.token ?? "";
    }
  }
  if (!portalToken) throw new Error("Could not mint a portal session for the layout fixture; portal coverage is unavailable.");

  const members = await apiJson(`/api/projects/${projectId}/members`, appToken) as Array<{
    id?: string;
    personId?: string | null;
    userId?: string | null;
  }>;
  const fixtureMember = members.find((member) => member.personId === person.id && member.userId);
  if (!fixtureMember?.id) {
    throw new Error("Fixture person has no user-backed project membership; refusing to run portal routes.");
  }
  await apiJson(`/api/projects/${projectId}/members/${fixtureMember.id}/permissions`, appToken, {
    method: "PATCH",
    body: JSON.stringify({ canLogIssues: true, canUpdatePlantMaterials: true, canEditDailyReport: true }),
  });
  // Give the demo manager project authority as well so conditional Team Portal
  // project tabs are rendered instead of silently omitted by capability gating.
  const managerMember = members.find((member) => member.userId);
  if (managerMember?.id) {
    await apiJson(`/api/projects/${projectId}/members/${managerMember.id}/authority`, appToken, {
      method: "PATCH",
      body: JSON.stringify({ isProjectManager: true }),
    });
  }

  const context = await apiJson("/api/portal/me", portalToken) as {
    member?: { canLogIssues?: boolean; canUpdatePlantMaterials?: boolean; canEditDailyReport?: boolean };
    sections?: unknown[];
  };
  if (
    !context.member?.canLogIssues ||
    !context.member?.canUpdatePlantMaterials ||
    !context.member?.canEditDailyReport ||
    !Array.isArray(context.sections) ||
    context.sections.length === 0
  ) {
    throw new Error("Portal fixture permissions/context did not round-trip; refusing to run reduced portal coverage.");
  }

  // Keep a fresh pending token for the acceptance page route itself. The
  // first token is intentionally consumed above, so probing it would produce
  // an expected 410 and hide whether the page can load a real invite.
  const pendingInvite = await apiJson(`/api/projects/${projectId}/portal-invites`, appToken, {
    method: "POST",
    body: JSON.stringify({ personId: person.id }),
  }) as { inviteUrl?: string };
  const inviteToken = inviteTokenFromUrl(pendingInvite.inviteUrl);

  let qrCodes = await apiJson(`/api/projects/${projectId}/qr-codes`, appToken) as Array<{ category?: string; token?: string }>;
  let siteToken = qrCodes.find((qr) => qr.category === "site_board")?.token ?? "";
  if (!siteToken) {
    qrCodes = await apiJson(`/api/projects/${projectId}/qr-codes`, appToken, {
      method: "POST",
      body: JSON.stringify({ categories: ["site_board"] }),
    }) as Array<{ category?: string; token?: string }>;
    siteToken = qrCodes.find((qr) => qr.category === "site_board")?.token ?? "";
  }
  if (!siteToken) throw new Error("Could not resolve a site-board QR token for /site/:token.");

  return { projectId, portalToken, inviteToken, siteToken };
}

function describeElement(el: Element): string {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const aria = el.getAttribute("aria-label");
  const testId = el.getAttribute("data-testid");
  const tag = el.tagName.toLowerCase();
  return [tag, testId ? `[${testId}]` : "", aria ? `(${aria})` : "", text ? `"${text}"` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 140);
}

/**
 * Checks the whole rendered tree, not only document.scrollWidth. A child that
 * sticks past a page boundary is reported even if a higher-level layout
 * prevents document scroll. The only clipped descendants exempted from that
 * check are explicitly marked decorative elements and horizontal scroller
 * contents.
 * Visible-intersection elementFromPoint samples catch a second class of bugs
 * where an action remains geometrically present but is covered by another
 * stacking layer and cannot be tapped.
 */
async function inspectLayout(
  page: import("playwright-core").Page,
  options: { ignorePersistentChromeOverlap?: boolean } = {},
): Promise<LayoutMetrics> {
  return page.evaluate(({ ignorePersistentChromeOverlap }) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrolling = document.scrollingElement ?? document.documentElement;
    const scrollWidth = Math.max(scrolling.scrollWidth, document.body?.scrollWidth ?? 0);
    const clientWidth = document.documentElement.clientWidth;
    const overflowElements: Array<{ element: string; left: number; right: number }> = [];
    const overlaps: Array<{ a: string; b: string }> = [];
    const stacking: Array<{ target: string; hit: string; x: number; y: number }> = [];

    type Region = { left: number; right: number; top: number; bottom: number };
    const visibleRegion = (el: Element): Region | null => {
      const ownStyle = getComputedStyle(el);
      const ownRect = (el as HTMLElement).getBoundingClientRect();
      if (
        ownStyle.display === "none" ||
        ownStyle.visibility === "hidden" ||
        ownStyle.contentVisibility === "hidden" ||
        Number.parseFloat(ownStyle.opacity || "1") <= 0 ||
        ownRect.width <= 0 ||
        ownRect.height <= 0
      ) return null;

      let region: Region = {
        left: Math.max(0, ownRect.left),
        right: Math.min(viewportWidth, ownRect.right),
        top: Math.max(0, ownRect.top),
        bottom: Math.min(viewportHeight, ownRect.bottom),
      };
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const rect = (ancestor as HTMLElement).getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.contentVisibility === "hidden" ||
          Number.parseFloat(style.opacity || "1") <= 0
        ) return null;
        if (style.overflowX === "hidden" || style.overflowX === "clip" || style.overflowX === "auto" || style.overflowX === "scroll") {
          region.left = Math.max(region.left, rect.left);
          region.right = Math.min(region.right, rect.right);
        }
        if (style.overflowY === "hidden" || style.overflowY === "clip" || style.overflowY === "auto" || style.overflowY === "scroll") {
          region.top = Math.max(region.top, rect.top);
          region.bottom = Math.min(region.bottom, rect.bottom);
        }
        if (region.right <= region.left || region.bottom <= region.top) return null;
      }
      return region;
    };
    const visible = (el: Element): boolean => visibleRegion(el) !== null;
    const describe = (el: Element): string => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const aria = el.getAttribute("aria-label");
      const testId = el.getAttribute("data-testid");
      const tag = el.tagName.toLowerCase();
      return [tag, testId ? `[${testId}]` : "", aria ? `(${aria})` : "", text ? `"${text}"` : ""]
        .filter(Boolean)
        .join(" ")
        .slice(0, 140);
    };

    const candidates = Array.from(document.querySelectorAll("body *")).filter(visible);
    for (const el of candidates) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const region = visibleRegion(el);
      if (!region) continue;
      // A shared overflow-x-clip safety net must not conceal a content/action
      // layout defect. Only explicit visual decoration may extend beyond a
      // clipping boundary; horizontal scroller contents are handled below.
      const visibleAtLeftEdge = region.left <= 1 && rect.left < -1;
      const visibleAtRightEdge = region.right >= viewportWidth - 1 && rect.right > viewportWidth + 1;
      if (visibleAtLeftEdge || visibleAtRightEdge) {
        // A child inside a deliberate horizontal scroller is allowed to be
        // wider than its scroller. The scroller itself remains checked.
        let scrollContainer: Element | null = el.parentElement;
        let intentionallyScrollable = false;
        while (scrollContainer && scrollContainer !== document.body) {
          const parentStyle = getComputedStyle(scrollContainer);
          if (parentStyle.overflowX === "auto" || parentStyle.overflowX === "scroll") {
            intentionallyScrollable = true;
            break;
          }
          scrollContainer = scrollContainer.parentElement;
        }
        const decorative = !!el.closest("[data-layout-decoration]");
        if (!intentionallyScrollable && !decorative) {
          overflowElements.push({ element: describe(el), left: Math.round(rect.left), right: Math.round(rect.right) });
        }
      }
    }

    const marked = Array.from(document.querySelectorAll('[data-ll="pill"], [data-ll="actionbar"]')).filter(visible);
    const rects = marked
      .map((el) => ({ el, rect: visibleRegion(el) }))
      .filter((entry): entry is { el: Element; rect: Region } => !!entry.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (overlapX > 2 && overlapY > 2) overlaps.push({ a: describe(a.el), b: describe(b.el) });
      }
    }

    const hitTargets = Array.from(document.querySelectorAll(
      '[data-ll="pill"], [data-ll="actionbar"], a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [role="menuitem"]:not([data-disabled]), [role="option"]:not([aria-disabled="true"])',
    )).filter((target) => visible(target) && getComputedStyle(target).pointerEvents !== "none");
    const inlineTargetCanDelegateToAncestor = (target: Element, hit: Element): boolean => {
      // Inline links have a union bounding box that includes glyph gaps.
      // elementFromPoint correctly reports their text container in those gaps;
      // that is not an overlay or a blocked link.
      const display = getComputedStyle(target).display;
      return (display === "inline" || display.startsWith("inline-")) && hit.contains(target);
    };
    const isCoveredByPersistentChrome = (target: Element, hit: Element): boolean => {
      if (!ignorePersistentChromeOverlap) return false;
      const chrome = hit.closest("header, nav, [data-layout-sticky-header]");
      if (!chrome) return false;
      const style = getComputedStyle(chrome);
      if (style.position !== "fixed" && style.position !== "sticky") return false;
      const targetRect = (target as HTMLElement).getBoundingClientRect();
      const chromeRect = (chrome as HTMLElement).getBoundingClientRect();
      return targetRect.top < chromeRect.bottom &&
        targetRect.bottom > chromeRect.top &&
        targetRect.right > chromeRect.left &&
        targetRect.left < chromeRect.right;
    };
    for (const target of hitTargets) {
      const rect = visibleRegion(target);
      if (!rect) continue;
      // A 1–2px sliver at the edge of a horizontal scroller is not a useful
      // hit-test sample. Overflow/layout checks still inspect the scroller.
      if (rect.right - rect.left < 8 || rect.bottom - rect.top < 8) continue;
      const points = [
        [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
        [Math.min(rect.right - 2, rect.left + 8), Math.min(rect.bottom - 2, rect.top + 8)],
        [Math.max(rect.left + 2, rect.right - 8), Math.min(rect.bottom - 2, rect.top + 8)],
        [Math.min(rect.right - 2, rect.left + 8), Math.max(rect.top + 2, rect.bottom - 8)],
        [Math.max(rect.left + 2, rect.right - 8), Math.max(rect.top + 2, rect.bottom - 8)],
      ];
      const hits = points.map(([rawX, rawY]) => {
        const x = Math.max(0, Math.min(viewportWidth - 1, rawX));
        const y = Math.max(0, Math.min(viewportHeight - 1, rawY));
        const top = document.elementFromPoint(x, y);
        return { x, y, top };
      });
      const receivesHit = (hit: Element | null): boolean =>
        !!hit && (hit === target || target.contains(hit) || inlineTargetCanDelegateToAncestor(target, hit));
      // Rounded controls legitimately have transparent corners. A control is
      // blocked only if none of its meaningful center/inset samples receives
      // the event, rather than if a single rounded-corner sample misses it.
      const blocked = hits.find((hit) => hit.top && !receivesHit(hit.top));
      if (blocked && !hits.some((hit) => receivesHit(hit.top)) && blocked.top && !isCoveredByPersistentChrome(target, blocked.top)) {
        stacking.push({ target: describe(target), hit: describe(blocked.top), x: Math.round(blocked.x), y: Math.round(blocked.y) });
      }
    }

    return {
      scrollWidth,
      clientWidth,
      viewportWidth,
      overflowElements: overflowElements.slice(0, 50),
      overlaps: overlaps.slice(0, 50),
      stacking: stacking.slice(0, 50),
    };
  }, options);
}

async function scrollForProbe(page: import("playwright-core").Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.scrollingElement?.scrollHeight ?? document.body.scrollHeight);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
  await page.waitForTimeout(100);
}

async function stressLongStrings(page: import("playwright-core").Page): Promise<number> {
  return page.evaluate(() => {
    const longText = ` ${"long-unbroken-email-or-document-name".repeat(6)}@example.test`;
    const isVisible = (el: Element) => {
      const style = getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;
    };
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      "main h1, main h2, main h3, main h4, main p, [data-layout-stress]",
    ))
      .filter((el) => isVisible(el) && el.textContent?.trim())
      .slice(0, 12);
    for (const el of candidates) el.appendChild(document.createTextNode(longText));
    return candidates.length;
  });
}

async function openSharedMenus(
  page: import("playwright-core").Page,
  onOpen: (index: number) => Promise<void>,
): Promise<number> {
  const selector = 'button[aria-haspopup="menu"], button[aria-haspopup="listbox"], [data-layout-menu-trigger]';
  const count = await page.locator(selector).count();
  let opened = 0;
  for (let i = 0; i < count; i++) {
    const trigger = page.locator(selector).nth(i);
    if (!(await trigger.isVisible().catch(() => false))) continue;
    const clicked = await trigger.click({ timeout: 1500 }).then(() => true).catch(() => false);
    if (!clicked) continue;
    await page.waitForTimeout(100);
    opened++;
    await onOpen(opened);
    await page.keyboard.press("Escape").catch(() => {});
  }
  return opened;
}

function addMetricReasons(reasons: FailureReason[], metrics: LayoutMetrics, probe: string): void {
  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    reasons.push({ kind: "overflow", scrollWidth: metrics.scrollWidth, clientWidth: metrics.clientWidth, probe });
  }
  for (const overflow of metrics.overflowElements) {
    reasons.push({ kind: "overflow", scrollWidth: metrics.scrollWidth, clientWidth: metrics.clientWidth, ...overflow, probe });
  }
  for (const overlap of metrics.overlaps) reasons.push({ kind: "overlap", ...overlap, probe });
  for (const stacking of metrics.stacking) reasons.push({ kind: "stacking", ...stacking, probe });
}

function writeReport(report: unknown): void {
  try {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error(`Could not write layout report ${REPORT_PATH}: ${(error as Error).message}`);
  }
}

async function main() {
  const exec = requireExec();
  console.log(`Layout check against ${APP_URL} @ viewports [${VIEWPORTS.join(", ")}]`);

  const appRoutes = discoverAppRouteTemplates();
  const portalSections = discoverPortalSections();
  const projectTabs = discoverProjectTabs();

  const health = await fetch(`${APP_URL}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `App not reachable at ${APP_URL}/api/health. Build + start the api-server first:\n` +
        `  pnpm --filter @workspace/api-server run build && (cd artifacts/api-server && PORT=8080 node dist/index.mjs)`,
    );
  }

  const { token: appToken } = await apiLogin(DEMO_EMAIL, DEMO_PASSWORD);
  const adminFixture = await setupAdminFixture();
  let browser: import("playwright-core").Browser | undefined;
  try {
    const fixtures = await setupFixtures(appToken);
    const routes = buildRoutes(fixtures);
    if (routes.length === 0) throw new Error("Route discovery produced zero concrete routes.");

    console.log(`Discovered ${appRoutes.length} router templates, ${projectTabs.length} project tabs, ${portalSections.length} portal sections.`);
    console.log(`Concrete sweep: ${routes.length} routes × ${VIEWPORTS.length} viewports.`);

    browser = await chromium.launch({ executablePath: exec, args: ["--no-sandbox"] });
    const results: Result[] = [];
    try {
    for (const width of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewportSize({ width, height: 900 });
      // tsx preserves function names using this helper inside serialized callbacks.
      await page.addInitScript("window.__name = (fn) => fn;");
      await page.addInitScript(
        ({ appToken: seededAppToken, adminToken, portalToken }) => {
          localStorage.setItem("sitesort_token", window.location.pathname === "/admin" ? adminToken : seededAppToken);
          localStorage.setItem("sitesort_portal_token", portalToken);
        },
        { appToken, adminToken: adminFixture.token, portalToken: fixtures.portalToken },
      );

      for (const route of routes) {
        const apiFailures: ApiFailure[] = [];
        const onResponse = (response: import("playwright-core").Response) => {
          if (response.status() < 400) return;
          try {
            const parsed = new URL(response.url());
            if (parsed.origin === new URL(APP_URL).origin && parsed.pathname.startsWith("/api/")) {
              apiFailures.push({ method: response.request().method(), status: response.status(), url: `${parsed.pathname}${parsed.search}` });
            }
          } catch {
            // A malformed/non-HTTP response cannot be associated with this local API.
          }
        };
        page.on("response", onResponse);
        try {
          await page.goto(`${APP_URL}${route.path}`, { waitUntil: "networkidle", timeout: 20000 });
          await page.waitForTimeout(500);
          const finalUrl = new URL(page.url());
          const reasons: FailureReason[] = [];
          const probes: Array<{ name: string; metrics: LayoutMetrics }> = [];

          if (route.auth === "app" && finalUrl.pathname === "/login") {
            reasons.push({ kind: "navigation", message: "App route redirected to /login despite a seeded app fixture token." });
          }
          if (route.auth === "portal" && finalUrl.pathname === "/portal/login") {
            reasons.push({ kind: "navigation", message: "Portal route redirected to /portal/login despite a seeded portal fixture token." });
          }

          const metrics = await inspectLayout(page);
          probes.push({ name: "initial", metrics });
          addMetricReasons(reasons, metrics, "initial");

          await scrollForProbe(page);
          const scrolledMetrics = await inspectLayout(page, { ignorePersistentChromeOverlap: true });
          probes.push({ name: "scrolled", metrics: scrolledMetrics });
          addMetricReasons(reasons, scrolledMetrics, "scrolled");

          const menuCount = await openSharedMenus(page, async (index) => {
            const menuMetrics = await inspectLayout(page);
            probes.push({ name: `menu-open-${index}`, metrics: menuMetrics });
            addMetricReasons(reasons, menuMetrics, `menu-open-${index}`);
          });

          await page.evaluate(() => {
            window.scrollTo(0, 0);
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
              const style = getComputedStyle(el);
              if (style.overflowY === "auto" || style.overflowY === "scroll") el.scrollTop = 0;
            }
          });
          const stressedCount = await stressLongStrings(page);
          const stressedMetrics = await inspectLayout(page);
          probes.push({ name: "long-string-stress", metrics: stressedMetrics });
          addMetricReasons(reasons, stressedMetrics, "long-string-stress");
          for (const failure of apiFailures) reasons.push({ kind: "api", ...failure });
          if (menuCount > 0 || stressedCount > 0) {
            console.log(`  probes on ${route.label}: ${menuCount} shared menu(s), ${stressedCount} long-string target(s)`);
          }

          results.push({
            label: route.label,
            path: route.path,
            width,
            finalPath: finalUrl.pathname,
            ok: reasons.length === 0,
            reasons,
            metrics,
            probes,
          });
        } catch (error) {
          const message = (error as Error).message;
          results.push({
            label: route.label,
            path: route.path,
            width,
            ok: false,
            reasons: [{ kind: "navigation", message }, ...apiFailures.map((failure) => ({ kind: "api" as const, ...failure }))],
          });
          console.error(`  ! ${route.label} @ ${width}px threw: ${message}`);
        } finally {
          page.removeListener("response", onResponse);
        }
      }
      await page.close();
    }
  } finally {
      await browser.close();
      browser = undefined;
    }

    const failures = results.filter((result) => !result.ok);
    const passes = results.filter((result) => result.ok);
    const report = {
    generatedAt: new Date().toISOString(),
    target: APP_URL,
    viewports: VIEWPORTS,
    routeDiscovery: {
      appRouteTemplates: appRoutes,
      projectTabs,
      portalSections,
      concreteRoutes: routes,
      routeCount: routes.length,
      legacyCoverageDefects: [
        "The previous checker manually duplicated top-level routes and therefore could miss a newly added <Route>.",
        "The previous checker omitted /verify-email, /reset-password, /forgot-pin, /reset-pin, and /portal/accept/:token.",
        "The previous checker silently skipped every portal section when invite/session setup failed.",
        "The previous checker used a stale hand-maintained project-tab and portal-section list.",
      ],
    },
    probes: {
      initial: "Normal route render at the configured viewport.",
      scrolled: "Window and same-origin vertical scrollers are moved to their bottom before inspection.",
      sharedMenus: "Visible aria-haspopup menu/listbox triggers are opened one at a time, inspected, then closed with Escape.",
      longStringStress: "Up to twelve visible headings, text blocks, links, buttons, or marked pills receive a long DOM-only suffix; the route is reloaded for the next case.",
      limitations: [
        "The long-string probe mutates rendered DOM text rather than server fixtures and does not cover text that is only revealed after an application-specific interaction.",
        "Only generic ARIA menu/listbox triggers are opened; custom controls without those attributes are not automatically discoverable.",
        "Element hit-testing samples center and inset points in the visible intersection. Controls with less than 8px of visible width or height are reported by overflow checks but omitted from stacking samples because a point there is not a meaningful tap target. A target is reported only when no sample receives its event; transparent rounded corners and inline text-glyph gaps are not treated as blocked controls.",
        "When a menu uses modal pointer-event locking, background controls inherit pointer-events:none and are excluded while the menu foreground remains inspected. On the scrolled probe, controls temporarily behind fixed/sticky header or nav chrome are not treated as a page overlap.",
        "API failures are collected for same-origin /api responses with HTTP status 400 or higher; browser console errors and cross-origin requests are outside this gate.",
      ],
    },
    results,
    summary: { passed: passes.length, failed: failures.length, total: results.length },
    };
    writeReport(report);

    console.log(`\n${"PATH".padEnd(36)} ${"WIDTH".padEnd(8)} RESULT`);
  console.log("-".repeat(72));
  for (const result of results) {
    console.log(`${result.label.padEnd(36)} ${String(result.width).padEnd(8)} ${result.ok ? "PASS" : "FAIL"}`);
    if (!result.ok) {
      for (const reason of result.reasons) {
        if (reason.kind === "overflow") {
          console.log(`    overflow: ${reason.element ? `${reason.element} ` : ""}left=${reason.left ?? "?"} right=${reason.right ?? "?"} (scrollWidth=${reason.scrollWidth}, clientWidth=${reason.clientWidth})`);
        } else if (reason.kind === "overlap") {
          console.log(`    overlap: "${reason.a}" intersects "${reason.b}"`);
        } else if (reason.kind === "stacking") {
          console.log(`    stacking: "${reason.target}" is covered by "${reason.hit}" at (${reason.x}, ${reason.y})`);
        } else if (reason.kind === "api") {
          console.log(`    api: ${reason.method} ${reason.url} -> HTTP ${reason.status}`);
        } else {
          console.log(`    navigation: ${reason.message}`);
        }
      }
    }
  }
  console.log(`\n${passes.length}/${results.length} checks passed.`);
  console.log(`Full per-route report: ${REPORT_PATH}`);
    if (failures.length > 0) {
      console.error(`${failures.length} layout check(s) failed.`);
      // Do not terminate here: the finally block must remove the dedicated
      // platform-admin fixture before the process returns a failing status.
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    await cleanupAdminFixture(adminFixture);
  }
}

main().catch((error) => {
  writeReport({
    generatedAt: new Date().toISOString(),
    target: APP_URL,
    viewports: VIEWPORTS,
    status: "error",
    error: (error as Error).message,
  });
  console.error(error);
  process.exit(1);
});