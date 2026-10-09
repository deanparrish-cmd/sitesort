import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qrCodesTable, qrBoardPinsTable, documentsTable, projectsTable, projectMembersTable, usersTable, permitsTable, photosTable, siteCheckinsTable, subcontractorsTable, calendarEventsTable, companyMembersTable, notificationsTable, peopleTable, companiesTable, pushSubscriptionsTable, projectInvitesTable } from "@workspace/db/schema";
import { eq, and, or, desc, asc, inArray, isNull, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";
import { buildSiteBoardPayload } from "../lib/site-board";
import { subcontractorInsuranceStatus } from "../lib/insurance";
import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { uploadFile } from "../lib/gcs";
import { signUploadUrl } from "../lib/signed-uploads";
import { siteDateStr, siteTime, siteTzLabel, closeDueAfter, safeTz, DEFAULT_SITE_CLOSE } from "../lib/site-clock";
import { isProjectApprover } from "../lib/project-authority";
import { logActivity } from "../lib/activity";
import { allow, COMPANY_MANAGER, ANY_MEMBER, INTERNAL_STAFF, projectApprover, projectSiteManager, declarePolicy } from "../lib/authz";
import { sendPushToMember } from "../lib/web-push";
import { requirePortalSession, requirePortalMember } from "../middlewares/portal";

const checkinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Images only"));
  },
});

const router: IRouter = Router();

// Who hears about check-in activity on a project: the owner company's
// admins / project managers PLUS the project's designated site manager
// (projects.site_manager_id — a designation, not a role, so they're included
// even when their company role is site_worker). Deduped.
async function checkinRecipients(projectId: string): Promise<{ projectName: string; userIds: string[] } | null> {
  const proj = (await db.select({
    name: projectsTable.name,
    companyId: projectsTable.companyId,
    siteManagerId: projectsTable.siteManagerId,
  }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  if (!proj) return null;
  const managers = await db.select({ userId: companyMembersTable.userId })
    .from(companyMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
    .where(and(
      eq(companyMembersTable.companyId, proj.companyId),
      inArray(companyMembersTable.role, ["admin", "project_manager"]),
      eq(usersTable.portalOnly, false),
    ));
  const ids = new Set(managers.map(m => m.userId));
  if (proj.siteManagerId) ids.add(proj.siteManagerId);
  return { projectName: proj.name, userIds: [...ids] };
}

// Best-effort: tell the same audience (managers + site manager) who arrived
// and when, each time a worker successfully checks in via the QR board. The
// notification points at the check-in row itself so it can open its detail.
async function notifySuccessfulCheckin(
  projectId: string,
  workerName: string,
  companyName: string,
  checkedInAt: Date,
  checkinId: string,
): Promise<void> {
  try {
    const rec = await checkinRecipients(projectId);
    if (!rec) return;
    const clock = await siteClock(projectId);
    const timeStr = `${siteTime(checkedInAt, clock.tz)} ${siteTzLabel(clock.tz, checkedInAt)}`;
    for (const userId of rec.userIds) {
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        type: "check_in",
        title: `Check-in at ${rec.projectName}`,
        message: `${workerName} (${companyName}) checked in on site at ${timeStr}.`,
        relatedEntityId: checkinId,
        relatedEntityType: "site_checkin",
        metadata: { projectId, workerName, companyName },
        read: false,
      });
    }
  } catch {
    /* alerting is best-effort */
  }
}

// Best-effort: sign-outs now show in the activity feed too, so a sign-out
// between two check-ins is visible instead of looking like a double check-in.
async function notifySignedOut(
  projectId: string,
  row: { id: string; workerName: string; companyName: string | null },
  at: Date,
  by?: { name: string; note?: string | null },
): Promise<void> {
  try {
    const rec = await checkinRecipients(projectId);
    if (!rec) return;
    const clock = await siteClock(projectId);
    const timeStr = `${siteTime(at, clock.tz)} ${siteTzLabel(clock.tz, at)}`;
    const who = `${row.workerName}${row.companyName ? ` (${row.companyName})` : ""}`;
    for (const userId of rec.userIds) {
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        type: "check_out",
        title: `Signed out at ${rec.projectName}`,
        message: by ? `${who} was signed out by ${by.name} at ${timeStr}${by.note ? `: ${by.note}` : ""}.` : `${who} signed out at ${timeStr}.`,
        relatedEntityId: row.id,
        relatedEntityType: "site_checkin",
        metadata: { projectId, workerName: row.workerName, companyName: row.companyName },
        read: false,
      });
    }
  } catch {
    /* alerting is best-effort */
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  site_board: "Site Board",
  safety: "Safety Information",
  emergency: "Emergency Procedures",
  drawings: "Current Drawings",
  general: "General Documents",
};

// Insurance hold (#114): tell the managers someone is waiting at the gate and
// needs an approve / refuse decision. Points at the held row itself.
async function notifyHeldCheckin(projectId: string, row: { id: string; workerName: string; companyName: string | null }, holdReason: string): Promise<void> {
  try {
    const rec = await checkinRecipients(projectId);
    if (!rec) return;
    const why = holdReasonText(holdReason);
    // The people deciding on site (#124): the site manager and anyone with PM
    // cover get a push on their phone, straight to the portal register.
    for (const userId of await registerHolderIds(projectId)) {
      void sendPushToMember(userId, projectId, {
        title: `Waiting at the gate: ${rec.projectName}`,
        body: `${row.workerName}${row.companyName ? ` (${row.companyName})` : ""}: ${why}. Approve or refuse.`,
        url: "/portal/site-register",
        tag: `hold-${row.id}`,
      }).catch(() => {});
    }
    for (const userId of rec.userIds) {
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        type: "check_in_held",
        title: `Waiting at the gate: ${rec.projectName}`,
        message: `${row.workerName}${row.companyName ? ` (${row.companyName})` : ""} is waiting at the gate because ${why}. Approve or refuse their check-in.`,
        relatedEntityId: row.id,
        relatedEntityType: "site_checkin",
        metadata: { projectId, workerName: row.workerName, companyName: row.companyName, reason: holdReason },
        read: false,
      });
    }
  } catch {
    /* alerting is best-effort */
  }
}

function holdReasonText(reason: string | null | undefined): string {
  if (reason === "unverified") return "the mobile number they gave isn't on file for anyone on this project";
  if (reason === "insurance_expired") return "their insurance has expired";
  return "there is no insurance on file for them";
}

// Who runs the gate when the PM isn't there (#124): the project's designated
// site manager and every member given PM cover on this project, as long as
// they're still on the project's team. Used for the portal register and the
// hold pushes.
async function registerHolderIds(projectId: string): Promise<string[]> {
  const p = (await db.select({ siteManagerId: projectsTable.siteManagerId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  const rows = await db.select({ userId: projectMembersTable.userId, isPm: projectMembersTable.isProjectManager }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), sql`${projectMembersTable.userId} IS NOT NULL`));
  const ids = new Set(rows.filter(r => r.isPm).map(r => r.userId as string));
  if (p?.siteManagerId && rows.some(r => r.userId === p.siteManagerId)) ids.add(p.siteManagerId);
  return [...ids];
}
export async function canSeeSiteRegister(userId: string, projectId: string): Promise<boolean> {
  return (await registerHolderIds(projectId)).includes(userId);
}

// The held worker's page polls its own hold with this signed token (names the
// row only), so a held row can't be looked up by anyone else.
function signHoldToken(projectId: string, checkinId: string): string {
  return jwt.sign({ kind: "site-hold", projectId, checkinId }, process.env.JWT_SECRET as string, { expiresIn: "24h" });
}
function readHoldToken(raw: unknown, projectId: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const p = jwt.verify(raw, process.env.JWT_SECRET as string) as any;
    return p?.kind === "site-hold" && p.projectId === projectId && typeof p.checkinId === "string" ? p.checkinId : null;
  } catch { return null; }
}

// The site check-in QR code and its /site/<token> URL are the only thing that
// lets someone check in, so they must never reach anyone who could pass them
// on. Only company Admins and Project Managers may list, create or delete them;
// site workers and (via the /api/portal containment in middlewares/auth) portal
// members get 403 from the API itself, not just a hidden button.
const QR_MANAGER_ROLES = ["admin", "project_manager"];
function requireQrManager(req: Request, res: Response, next: import("express").NextFunction): void {
  if (!QR_MANAGER_ROLES.includes(req.user?.role ?? "")) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can view the site QR code." });
    return;
  }
  next();
}

// List QR codes for a project
router.get("/projects/:projectId/qr-codes", authenticate, allow(COMPANY_MANAGER), requireQrManager, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const codes = await db.select()
      .from(qrCodesTable)
      .where(eq(qrCodesTable.projectId, req.params.projectId));

    const base = `${req.protocol}://${req.get("host")}`;
    res.json(codes.map(qr => ({
      ...qr,
      siteUrl: `${base}/site/${qr.token}`,
      createdAt: qr.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "List QR codes error");
    res.status(500).json({ error: "server_error", message: "Failed to list QR codes" });
  }
});

// Generate QR codes for a project
router.post("/projects/:projectId/qr-codes", authenticate, allow(COMPANY_MANAGER), requireQrManager, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) {
      res.status(400).json({ error: "validation_error", message: "categories array required" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .then(r => r[0]);

    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const base = `${req.protocol}://${req.get("host")}`;
    const result = [];

    for (const category of categories) {
      const existing = await db.select().from(qrCodesTable)
        .where(and(eq(qrCodesTable.projectId, req.params.projectId), eq(qrCodesTable.category, category)))
        .then(r => r[0]);

      if (existing) {
        result.push({ ...existing, siteUrl: `${base}/site/${existing.token}`, createdAt: existing.createdAt.toISOString() });
        continue;
      }

      const token = randomBytes(16).toString("hex");
      const id = generateId();
      const label = CATEGORY_LABELS[category] ?? category;

      const [qr] = await db.insert(qrCodesTable).values({
        id,
        projectId: req.params.projectId,
        category,
        token,
        label,
        requiresLogin: false,
      }).returning();

      result.push({ ...qr, siteUrl: `${base}/site/${qr.token}`, createdAt: qr.createdAt.toISOString() });
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Generate QR codes error");
    res.status(500).json({ error: "server_error", message: "Failed to generate QR codes" });
  }
});

// Delete a QR code
router.delete("/projects/:projectId/qr-codes/:id", authenticate, allow(COMPANY_MANAGER), requireQrManager, async (req, res) => {
  try {
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .then(r => r[0]);

    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    await db.delete(qrCodesTable).where(and(eq(qrCodesTable.id, req.params.id), eq(qrCodesTable.projectId, req.params.projectId)));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete QR code error");
    res.status(500).json({ error: "server_error", message: "Failed to delete QR code" });
  }
});

// List pinned items for a project's QR board
// Which items are pinned: shown on the project page to any of the company's staff.
router.get("/projects/:projectId/qr-pins", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found" }); return; }
    const pins = await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, req.params.projectId));
    res.json(pins.map(p => ({ id: p.id, itemType: p.itemType, itemId: p.itemId })));
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

// Pin an item to the QR board
// Pinning publishes an item on the PUBLIC site board (anyone with the QR can
// read it), so pinning and unpinning are for the project's approvers (#118).
router.post("/projects/:projectId/qr-pins", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found" }); return; }
    const { itemType, itemId } = req.body;
    if (!itemType || !itemId) { res.status(400).json({ error: "validation_error", message: "itemType and itemId required" }); return; }
    const id = generateId();
    await db.insert(qrBoardPinsTable).values({ id, projectId: req.params.projectId, itemType, itemId }).onConflictDoNothing();
    res.status(201).json({ id, itemType, itemId });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

// Unpin an item from the QR board
router.delete("/projects/:projectId/qr-pins", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found" }); return; }
    const { itemType, itemId } = req.body;
    await db.delete(qrBoardPinsTable).where(
      and(eq(qrBoardPinsTable.projectId, req.params.projectId), eq(qrBoardPinsTable.itemType, itemType), eq(qrBoardPinsTable.itemId, itemId))
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

// Public site board endpoint — no auth required
router.get("/site/:token", async (req, res) => {
  try {
    const qr = await db.select().from(qrCodesTable)
      .where(eq(qrCodesTable.token, req.params.token))
      .then(r => r[0]);

    if (!qr) {
      res.status(404).json({ error: "not_found", message: "Site board not found" });
      return;
    }

    const payload = await buildSiteBoardPayload(qr.projectId);
    if (!payload) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }
    const clock = await siteClock(qr.projectId);
    res.json({ ...payload, onSiteCount: await countOnSite(qr.projectId), siteTimeZone: clock.tz, siteTzLabel: siteTzLabel(clock.tz), generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load site board" });
  }
});

// The site clock for one or many projects (timezone + daily close time).
export type SiteClock = { tz: string; close: string };
async function siteClocks(projectIds: string[]): Promise<Map<string, SiteClock>> {
  const ids = [...new Set(projectIds)];
  const rows = ids.length
    ? await db.select({ id: projectsTable.id, tz: projectsTable.siteTimeZone, close: projectsTable.siteCloseTime }).from(projectsTable).where(inArray(projectsTable.id, ids))
    : [];
  return new Map(rows.map(r => [r.id, { tz: safeTz(r.tz), close: r.close || DEFAULT_SITE_CLOSE }]));
}
async function siteClock(projectId: string): Promise<SiteClock> {
  return (await siteClocks([projectId])).get(projectId) ?? { tz: safeTz(null), close: DEFAULT_SITE_CLOSE };
}

type StateRow = {
  checkedInAt: Date; checkedOutAt: Date | null; checkoutMethod?: string | null;
  holdStatus?: string | null; autoClosedAt?: Date | null;
};
// Where a check-in row stands, on its site's clock. One row = one in/out cycle.
//   held              waiting at the gate for an admin / PM insurance decision
//   on_site           signed in, not signed out, site close time not yet passed
//   auto_closed_today the close time passed without a sign-out, today (site
//                     day): NOT counted, but still on today's roll-call, marked
//   auto_closed       the same, from an earlier day: history only
//   signed_out        genuinely signed out (self or by a manager)
//   none              refused / lapsed hold, or a pre-sign-out legacy row
// A close time that has passed counts as closed even before the end-of-day
// job writes autoClosedAt, so the count is right between job runs.
export function checkinState(c: StateRow, clock: SiteClock, now: Date = new Date()) {
  const held = c.holdStatus === "pending";
  const excluded = c.holdStatus === "refused" || c.holdStatus === "lapsed" || (!c.checkedOutAt && c.checkoutMethod === "legacy");
  const due = closeDueAfter(c.checkedInAt, clock.tz, clock.close);
  const autoAt = c.autoClosedAt ?? (!c.checkedOutAt && !held && !excluded && now.getTime() >= due.getTime() ? due : null);
  const today = siteDateStr(now, clock.tz);
  let presence: "held" | "on_site" | "auto_closed_today" | "auto_closed" | "signed_out" | "none";
  if (held) presence = "held";
  else if (excluded) presence = "none";
  else if (c.checkedOutAt) presence = "signed_out";
  else if (autoAt) presence = (siteDateStr(c.checkedInAt, clock.tz) === today || siteDateStr(autoAt, clock.tz) === today) ? "auto_closed_today" : "auto_closed";
  else presence = "on_site";
  return {
    presence,
    onSite: presence === "on_site",
    autoClosed: !!autoAt && !c.checkedOutAt,
    autoClosedAt: autoAt ? autoAt.toISOString() : null,
    notSignedOut: presence === "auto_closed_today" || presence === "auto_closed",
    siteTimeZone: clock.tz,
    siteTzLabel: siteTzLabel(clock.tz, c.checkedInAt),
  };
}
function serializeCheckin<T extends StateRow & { holdDecidedAt?: Date | null; photoUrl?: string | null }>(c: T, clock: SiteClock) {
  return {
    ...c,
    // Check-in photos are served only with a short-lived signature.
    ...("photoUrl" in c ? { photoUrl: signUploadUrl(c.photoUrl) } : {}),
    checkedInAt: c.checkedInAt.toISOString(),
    checkedOutAt: c.checkedOutAt ? c.checkedOutAt.toISOString() : null,
    holdDecidedAt: c.holdDecidedAt ? c.holdDecidedAt.toISOString() : null,
    ...checkinState(c, clock),
  };
}
// Public QR responses (the person at the gate, no login) never carry the photo,
// GPS or identity key: anyone can type a name and company at the sign-out screen.
function publicCheckin<T extends StateRow & { holdDecidedAt?: Date | null; photoUrl?: string | null; lat?: number | null; lng?: number | null; personKey?: string | null }>(c: T, clock: SiteClock) {
  const { photoUrl: _p, lat: _la, lng: _ln, personKey: _k, ...rest } = serializeCheckin(c, clock);
  return rest;
}
// The person's currently-open cycles on a project (name + company, case-insensitive),
// newest first.
async function openCheckinsFor(projectId: string, workerName: string, companyName: string) {
  const open = await openRowsForProject(projectId);
  const key = matchRegistered(await loadRegistered(projectId), workerName, companyName)?.key ?? null;
  const n = normText(workerName), c = normText(companyName);
  // Same registered person (by identity link) OR same typed name + company.
  return open.filter(r => (key && r.personKey === key) || (normText(r.workerName) === n && normText(r.companyName ?? "") === c));
}

// Open cycles for registered identities (newest first). Rows from before the
// identity link existed (no personKey) count when their name + company match
// the record exactly.
async function openRowsForRecords(projectId: string, recs: Registered[]) {
  const keys = recs.map(r => r.key);
  return (await openRowsForProject(projectId)).filter(r =>
    r.personKey ? keys.includes(r.personKey) : !!matchRegistered(recs, r.workerName, r.companyName ?? ""));
}

// Count-only view of the "Currently on site" register for the PUBLIC board.
// Distinct PEOPLE who are on_site right now (not held, not past the close
// time); one identity (or, for older rows, one name + company) counts once.
async function countOnSite(projectId: string): Promise<number> {
  const clock = await siteClock(projectId);
  const rows = await db.select().from(siteCheckinsTable).where(and(
    eq(siteCheckinsTable.projectId, projectId),
    isNull(siteCheckinsTable.checkedOutAt),
    isNull(siteCheckinsTable.autoClosedAt),
  ));
  const keys = new Set(rows.filter(r => checkinState(r, clock).onSite)
    .map(r => r.personKey ?? `${normText(r.workerName)}|${normText(r.companyName ?? "")}`));
  return keys.size;
}

router.get("/site/:token/on-site-count", async (req: Request, res: Response) => {
  try {
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Site board not found" }); return; }
    res.json({ count: await countOnSite(qr.projectId) });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to load count" });
  }
});

// ---- Matching helpers for public sign-in/out ---------------------------------
// Lowercase, trim, collapse inner whitespace. Diacritics are left alone so
// this stays consistent with the SQL comparison in openCheckinsFor.
function normText(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

// ---- Registered people for a project (who may check in) ---------------------
// Three record kinds can register someone: an in-house user, a subcontractor
// contact card, and a team person. `key` is the identity used to group
// check-ins, so a contact card and its primary-contact person (which can carry
// slightly different names) count as ONE human.
//
// INSURANCE (#114): every record that belongs to a subcontractor card carries
// that card's id in `insuranceSubId`, and the check-in gate checks it. That
// includes a USER account linked to a card (a subcontractor who joined the
// Team Portal): before #114 those matched as plain users on name alone and
// skipped the insurance check entirely. Only genuine in-house staff (no card)
// have no insuranceSubId, and they must give THIS company's name to match, so
// nobody from a subcontractor can pass as staff by name alone.
type Registered = {
  key: string;
  kind: "user" | "contact" | "person";
  names: string[];            // accepted spellings of the name
  company: string | null;     // canonical company text
  companyRequired: boolean;
  insuranceSubId: string | null;
};

async function loadRegistered(projectId: string): Promise<Registered[]> {
  const out: Registered[] = [];
  const own = (await db.select({ name: companiesTable.name }).from(projectsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, projectsTable.companyId))
    .where(eq(projectsTable.id, projectId)).limit(1))[0]?.name ?? null;

  // Every card on the project, with its primary person, keyed once.
  const contacts = await db.select({ id: subcontractorsTable.id, contactName: subcontractorsTable.contactName, companyName: subcontractorsTable.companyName })
    .from(projectMembersTable)
    .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
    .where(eq(projectMembersTable.projectId, projectId));

  // People on the project (and the card each belongs to, if any).
  const people = await db.select({ id: peopleTable.id, name: peopleTable.name, subId: peopleTable.subcontractorId, subCompany: subcontractorsTable.companyName })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
    .leftJoin(subcontractorsTable, eq(subcontractorsTable.id, peopleTable.subcontractorId))
    .where(and(eq(projectMembersTable.projectId, projectId), isNull(peopleTable.archivedAt)));

  // Users on the project, with whatever card their membership links to: the
  // membership row's own card, or the card of the person it points at.
  const users = await db.select({
    id: usersTable.id, name: usersTable.name,
    personId: projectMembersTable.personId, personName: peopleTable.name,
    subId: sql<string | null>`coalesce(${projectMembersTable.subcontractorId}, ${peopleTable.subcontractorId})`,
  })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
    .leftJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
    .where(eq(projectMembersTable.projectId, projectId));

  const userSubIds = users.map(u => u.subId).filter((v): v is string => !!v);
  const subIds = [...new Set([...contacts.map(c => c.id), ...userSubIds])];
  const subs = subIds.length
    ? await db.select({ id: subcontractorsTable.id, companyName: subcontractorsTable.companyName }).from(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds))
    : [];
  const subCompany = new Map(subs.map(x => [x.id, x.companyName]));
  const primaries = subIds.length
    ? await db.select({ id: peopleTable.id, subId: peopleTable.subcontractorId, name: peopleTable.name })
        .from(peopleTable)
        .where(and(inArray(peopleTable.subcontractorId, subIds), eq(peopleTable.isPrimaryContact, true), isNull(peopleTable.archivedAt)))
    : [];
  const primaryBySub = new Map(primaries.map(p => [p.subId as string, p]));
  const cardKey = (subId: string) => { const prim = primaryBySub.get(subId); return prim ? `person:${prim.id}` : `sub:${subId}`; };

  for (const u of users) {
    const names = [...new Set([u.name, u.personName].filter((n): n is string => !!n))];
    if (u.subId) {
      // A subcontractor's own login: same identity, company and insurance as their card.
      out.push({ key: u.personId ? `person:${u.personId}` : cardKey(u.subId), kind: "user", names, company: subCompany.get(u.subId) ?? null, companyRequired: true, insuranceSubId: u.subId });
    } else {
      out.push({ key: `user:${u.id}`, kind: "user", names, company: own, companyRequired: !!own, insuranceSubId: null });
    }
  }
  for (const c of contacts) {
    const prim = primaryBySub.get(c.id);
    // Accept the contact card's spelling AND its linked primary person's, and
    // key both to the person so they group as one human.
    out.push({ key: cardKey(c.id), kind: "contact", names: [c.contactName, ...(prim ? [prim.name] : [])], company: c.companyName, companyRequired: true, insuranceSubId: c.id });
  }
  for (const p of people) {
    if (p.subId) out.push({ key: `person:${p.id}`, kind: "person", names: [p.name], company: p.subCompany ?? null, companyRequired: true, insuranceSubId: p.subId });
    else out.push({ key: `person:${p.id}`, kind: "person", names: [p.name], company: own, companyRequired: !!own, insuranceSubId: null });
  }
  return out;
}

// Name (any accepted spelling) AND company must match, whitespace- and
// case-insensitive. If several records match, one tied to a subcontractor card
// wins, so a match can never dodge an insurance check that another matching
// record would have run. Otherwise users, then contacts, then people.
// Mobile numbers on file for a registered identity (#122): the person's own,
// their login's, and their card's contact number when they are its primary.
async function phonesForKey(key: string): Promise<string[]> {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  const out: (string | null)[] = [];
  if (kind === "person") {
    const p = (await db.select({ phone: peopleTable.phone, userId: peopleTable.userId, subId: peopleTable.subcontractorId, primary: peopleTable.isPrimaryContact })
      .from(peopleTable).where(eq(peopleTable.id, id)).limit(1))[0];
    if (p) {
      out.push(p.phone);
      if (p.userId) out.push((await db.select({ phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, p.userId)).limit(1))[0]?.phone ?? null);
      if (p.subId && p.primary) out.push((await db.select({ phone: subcontractorsTable.contactPhone }).from(subcontractorsTable).where(eq(subcontractorsTable.id, p.subId)).limit(1))[0]?.phone ?? null);
    }
  } else if (kind === "sub") {
    out.push((await db.select({ phone: subcontractorsTable.contactPhone }).from(subcontractorsTable).where(eq(subcontractorsTable.id, id)).limit(1))[0]?.phone ?? null);
  } else if (kind === "user") {
    out.push((await db.select({ phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, id)).limit(1))[0]?.phone ?? null);
  }
  return out.filter((v): v is string => !!v && normPhone(v).length >= 9);
}
// Digits only, UK +44 / 0044 folded to a leading 0.
function normPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0044")) d = "0" + d.slice(4);
  else if (d.startsWith("44") && d.length >= 12) d = "0" + d.slice(2);
  return d;
}
export function samePhone(a: string, b: string): boolean {
  const x = normPhone(a), y = normPhone(b);
  return x.length >= 9 && x === y;
}

function matchRegistered(records: Registered[], typedName: string, typedCompany: string): Registered | null {
  const n = normText(typedName), c = normText(typedCompany);
  const order = { user: 0, contact: 1, person: 2 } as const;
  const hits = records
    .filter(r => r.names.some(x => normText(x) === n) && (!r.companyRequired || normText(r.company ?? "") === c))
    .sort((a, b) => Number(!b.insuranceSubId) - Number(!a.insuranceSubId) || order[a.kind] - order[b.kind]);
  return hits[0] ?? null;
}

type OpenRow = typeof siteCheckinsTable.$inferSelect;
// Rows a person could still be "in" for sign-in / sign-out purposes: not
// signed out, not a legacy row, not a pending / refused / lapsed insurance
// hold. An automatically closed row stays here for 12 hours so the man still
// working past the close time can sign out properly (and isn't offered a
// second sign-in).
async function openRowsForProject(projectId: string): Promise<OpenRow[]> {
  return db.select().from(siteCheckinsTable).where(and(
    eq(siteCheckinsTable.projectId, projectId),
    isNull(siteCheckinsTable.checkedOutAt),
    sql`coalesce(${siteCheckinsTable.checkoutMethod}, '') <> 'legacy'`,
    sql`(${siteCheckinsTable.holdStatus} IS NULL OR ${siteCheckinsTable.holdStatus} = 'approved')`,
    sql`(${siteCheckinsTable.autoClosedAt} IS NULL OR ${siteCheckinsTable.autoClosedAt} > now() - interval '12 hours')`,
  )).orderBy(desc(siteCheckinsTable.checkedInAt));
}
// The fullest accepted spelling of a record's name ("Amy Parrish" over "Amy").
function fullName(r: Registered): string {
  return [...r.names].sort((a, b) => b.trim().split(/\s+/).length - a.trim().split(/\s+/).length || b.length - a.length)[0] ?? "";
}

// Public label = first name + surname initial + company ("Amy P, Amy I Cloud").
// Full names never go out on the public endpoints.
function publicLabel(fullName: string, company: string | null | undefined): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? fullName.trim();
  const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}` : "";
  return `${first}${initial}${company ? `, ${company}` : ""}`;
}

// "Did you mean" confirmation: a short-lived signed token naming ONLY the
// registered record (key), never a name, so tapping a suggestion can check the
// person in without their full name ever being sent to the public page.
function signMatchToken(projectId: string, key: string): string {
  return jwt.sign({ kind: "site-match", projectId, key }, process.env.JWT_SECRET as string, { expiresIn: "10m" });
}
function readMatchToken(raw: unknown, projectId: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const p = jwt.verify(raw, process.env.JWT_SECRET as string) as any;
    return p?.kind === "site-match" && p.projectId === projectId && typeof p.key === "string" ? p.key : null;
  } catch { return null; }
}

// Remembered-device token: a signed, project-scoped record of who last signed
// in from this device. Nothing new is stored server-side.
const DEVICE_TOKEN_TTL = "180d";
// #124: it also carries the registered identity key, so a remembered phone
// signs in as that person without typing anything. Older tokens (names only)
// still resolve by an exact name + company match.
function signDeviceToken(projectId: string, workerName: string, companyName: string, key?: string | null): string {
  return jwt.sign({ kind: "site-device", projectId, workerName, companyName, ...(key ? { key } : {}) }, process.env.JWT_SECRET as string, { expiresIn: DEVICE_TOKEN_TTL });
}
function readDeviceToken(raw: unknown, projectId: string): { workerName: string; companyName: string; key: string | null } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const p = jwt.verify(raw, process.env.JWT_SECRET as string) as any;
    if (p?.kind !== "site-device" || p.projectId !== projectId) return null;
    return { workerName: String(p.workerName), companyName: String(p.companyName), key: typeof p.key === "string" ? p.key : null };
  } catch { return null; }
}
// The registered record a remembered device stands for, if still on the project.
function deviceRecord(records: Registered[], who: { workerName: string; companyName: string; key: string | null }): Registered | null {
  return (who.key ? records.find(r => r.key === who.key) : null) ?? matchRegistered(records, who.workerName, who.companyName);
}

// ---- Phone-first identity (#124) ----------------------------------------------
// The gate asks for a mobile number first. A number on file for someone on
// the project identifies them (first name + surname initial + company are
// shown back so they can confirm). Nothing else about the project's people is
// public: no name lookups, no suggestions, no company list.
async function recordsForPhone(records: Registered[], phone: string): Promise<Registered[]> {
  const seen = new Set<string>();
  const out: Registered[] = [];
  const order = { user: 0, contact: 1, person: 2 } as const;
  // Same priority as matchRegistered: a record tied to a card wins, so a
  // phone match can't dodge an insurance check.
  const sorted = [...records].sort((a, b) => Number(!b.insuranceSubId) - Number(!a.insuranceSubId) || order[a.kind] - order[b.kind]);
  for (const r of sorted) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if ((await phonesForKey(r.key)).some(p => samePhone(p, phone))) out.push(r);
  }
  return out;
}

// Numbers that find nobody are limited per network address and board, so the
// gate can't be used to try number after number. Only MISSES count: a whole
// crew arriving on the site's wifi (one address) with their numbers on file is
// never slowed down.
const PHONE_MISSES = 60, PHONE_WINDOW_MS = 10 * 60_000;
const phoneMisses = new Map<string, number[]>();
function recentMisses(req: Request, token: string): number[] {
  const now = Date.now();
  return (phoneMisses.get(`${req.ip}|${token}`) ?? []).filter(t => now - t < PHONE_WINDOW_MS);
}
function phoneRateLimited(req: Request, token: string): boolean {
  return recentMisses(req, token).length >= PHONE_MISSES;
}
function notePhoneMiss(req: Request, token: string): void {
  const now = Date.now();
  phoneMisses.set(`${req.ip}|${token}`, [...recentMisses(req, token), now]);
  if (phoneMisses.size > 5000) for (const [key, ts] of phoneMisses) if (!ts.some(t => now - t < PHONE_WINDOW_MS)) phoneMisses.delete(key);
}
// Sign-out only: at the gate itself the limit never turns anyone away (see
// /identify and /checkin: a limited board stops LOOKING UP numbers and holds
// everyone for the site manager instead).
const TOO_MANY_TRIES = { error: "too_many_tries", message: "We can't check numbers just now. Ask your site manager to sign you out." };

// Fill in a registered record's mobile number, only where none is on file.
// Used when a manager approves someone who gave their number at the gate.
async function fillPhoneForKey(key: string, phone: string): Promise<boolean> {
  if ((await phonesForKey(key)).length > 0) return false;
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  const value = phone.trim().slice(0, 40);
  if (kind === "person") await db.update(peopleTable).set({ phone: value }).where(eq(peopleTable.id, id));
  else if (kind === "sub") await db.update(subcontractorsTable).set({ contactPhone: value }).where(eq(subcontractorsTable.id, id));
  else if (kind === "user") await db.update(usersTable).set({ phone: value }).where(eq(usersTable.id, id));
  else return false;
  return true;
}

// Public (#124): step one at the gate. A mobile number on file for someone on
// this project returns who that is (first name, surname initial, company) and a
// short-lived signed token naming the record, for the "Is this you?" tap. An
// unknown number returns no matches; the visitor then gives their name and
// company and waits for the site manager (an "unverified" hold).
router.post("/site/:token/identify", async (req: Request, res: Response) => {
  try {
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    if (normPhone(phone).length < 9) { res.status(400).json({ error: "validation_error", message: "Enter your mobile number." }); return; }
    // Someone has been trying number after number at this board: stop looking
    // numbers up for a while, but never turn a worker away. No matches sends
    // him to name + company, which is held for the site manager.
    if (phoneRateLimited(req, req.params.token)) { res.json({ matches: [], checkingPaused: true }); return; }
    // One choice per distinct label: an in-house person with a portal login is
    // on the project as both a login and a person, the same human.
    const seenLabels = new Set<string>();
    const matches = (await recordsForPhone(await loadRegistered(qr.projectId), phone))
      .map(r => ({ label: publicLabel(fullName(r), r.company), matchToken: signMatchToken(qr.projectId, r.key) }))
      .filter(m => !seenLabels.has(m.label) && !!seenLabels.add(m.label))
      .slice(0, 3);
    if (matches.length === 0) notePhoneMiss(req, req.params.token);
    res.json({ matches });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to look up" });
  }
});

// (#122) The public "who's on site" lookup is gone: anyone at the gate could
// list who was on site three letters at a time. The board now only knows the
// person on a remembered device (/device), and sign-out needs that device or
// the person's phone number on file (/checkout).

// Public: verify a remembered-device token and report current status.
router.get("/site/:token/device", async (req: Request, res: Response) => {
  try {
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    const who = readDeviceToken(req.query.deviceToken, qr.projectId);
    if (!who) { res.json({ valid: false }); return; }
    const rec = deviceRecord(await loadRegistered(qr.projectId), who);
    const open = rec ? await openRowsForRecords(qr.projectId, [rec]) : await openCheckinsFor(qr.projectId, who.workerName, who.companyName);
    res.json({ valid: true, workerName: who.workerName, companyName: who.companyName, onSite: !!open[0], checkinId: open[0]?.id ?? null, checkedInAt: open[0] ? open[0].checkedInAt.toISOString() : null });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to check device" });
  }
});

// One person = one presence. Signing out closes the target row AND any other
// still-open row for the same person from the SAME site day (duplicates from
// earlier spelling variants), so the roll-call can't keep a ghost.
async function openRowsToClose(projectId: string, target: OpenRow): Promise<OpenRow[]> {
  const { tz } = await siteClock(projectId);
  const dayOf = (d: Date) => siteDateStr(d, tz);
  const day = dayOf(target.checkedInAt);
  const t = normText(target.workerName), c = normText(target.companyName ?? "");
  // The target itself always (it may be an older automatically closed row that
  // a manager is confirming), plus any same-day duplicates still open.
  const others = (await openRowsForProject(projectId)).filter(r => r.id !== target.id &&
    dayOf(r.checkedInAt) === day &&
    ((target.personKey && r.personKey === target.personKey) || (normText(r.workerName) === t && normText(r.companyName ?? "") === c)));
  return [target, ...others];
}

// Public: is this person currently signed in on this site? Drives whether the
// QR page offers SIGN IN or SIGN OUT. Returns only a boolean + their own times.
// Public: sign out. Closes the person's most recent open cycle only; an older
// unclosed cycle from a previous day stays flagged for a manager.
// (#122, #124) The caller must prove who they are: the remembered-device token
// this phone got at check-in, or their mobile number (on file, or the one they
// gave at the gate when a manager let them on). Before #122 anyone could sign
// anyone out by name, emptying the fire roll of people still on site.
const IDENTITY_NOT_CONFIRMED = { error: "identity_not_confirmed", message: "We couldn't confirm it's you. Ask your site manager to sign you out." };
router.post("/site/:token/checkout", async (req: Request, res: Response) => {
  try {
    const { deviceToken, phone } = req.body ?? {};
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    let open: OpenRow[];
    if (typeof deviceToken === "string" && deviceToken) {
      const who = readDeviceToken(deviceToken, qr.projectId);
      if (!who) { res.status(403).json(IDENTITY_NOT_CONFIRMED); return; }
      const rec = deviceRecord(await loadRegistered(qr.projectId), who);
      open = rec ? await openRowsForRecords(qr.projectId, [rec]) : await openCheckinsFor(qr.projectId, who.workerName, who.companyName);
    } else {
      if (typeof phone !== "string" || normPhone(phone).length < 9) {
        res.status(400).json({ error: "validation_error", message: "Enter your mobile number." });
        return;
      }
      if (phoneRateLimited(req, req.params.token)) { res.status(429).json(TOO_MANY_TRIES); return; }
      // One answer for "unknown number" and "not signed in by that number", so
      // the form can't be used to test who is registered or on site.
      const recs = await recordsForPhone(await loadRegistered(qr.projectId), phone);
      const byRecord = new Set((await openRowsForRecords(qr.projectId, recs)).map(r => r.id));
      open = (await openRowsForProject(qr.projectId)).filter(r => byRecord.has(r.id) || (!!r.typedPhone && samePhone(r.typedPhone, phone)));
      if (!open[0]) { notePhoneMiss(req, req.params.token); res.status(403).json(IDENTITY_NOT_CONFIRMED); return; }
    }
    if (!open[0]) { res.status(409).json({ error: "not_signed_in", message: "You are not signed in on this site" }); return; }
    const targetRow = open[0];
    const toClose = await openRowsToClose(qr.projectId, targetRow);
    const now = new Date();
    const closed = await db.update(siteCheckinsTable)
      .set({ checkedOutAt: now, checkoutMethod: "self" })
      .where(and(inArray(siteCheckinsTable.id, toClose.map(r => r.id)), isNull(siteCheckinsTable.checkedOutAt)))
      .returning();
    const row = closed.find(r => r.id === targetRow.id);
    if (!row) { res.status(409).json({ error: "not_signed_in", message: "You are not signed in on this site" }); return; }
    void notifySignedOut(qr.projectId, row, now);
    res.json(publicCheckin(row, await siteClock(qr.projectId)));
  } catch {
    res.status(500).json({ error: "server_error", message: "Sign-out failed" });
  }
});

// A manager (dashboard) or the site manager / cover (portal, #124) signs
// someone out on their behalf (forgot to sign out), with a required note.
type Outcome = { status: number; body: unknown };
async function managerSignOut(projectId: string, checkinId: string, actorId: string, rawNote: unknown, req: Request): Promise<Outcome> {
  const project = (await db.select({ id: projectsTable.id, companyId: projectsTable.companyId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  if (!project) return { status: 404, body: { error: "not_found", message: "Project not found" } };
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!note) return { status: 400, body: { error: "validation_error", message: "A note is required" } };
  // Any row not yet genuinely signed out, including one closed automatically
  // on an earlier day (the manager confirming when they actually left).
  const target = (await db.select().from(siteCheckinsTable).where(and(
    eq(siteCheckinsTable.id, checkinId), eq(siteCheckinsTable.projectId, project.id),
    isNull(siteCheckinsTable.checkedOutAt),
    sql`(${siteCheckinsTable.holdStatus} IS NULL OR ${siteCheckinsTable.holdStatus} = 'approved')`,
  )).limit(1))[0];
  if (!target) return { status: 409, body: { error: "not_signed_in", message: "Already signed out, or not found" } };
  const toClose = await openRowsToClose(project.id, target);
  const now = new Date();
  const closed = await db.update(siteCheckinsTable)
    .set({ checkedOutAt: now, checkedOutBy: actorId, checkoutNote: note.slice(0, 500), checkoutMethod: "manual" })
    .where(and(inArray(siteCheckinsTable.id, toClose.map(r => r.id)), eq(siteCheckinsTable.projectId, project.id), isNull(siteCheckinsTable.checkedOutAt)))
    .returning();
  const row = closed.find(r => r.id === target.id);
  if (!row) return { status: 409, body: { error: "not_signed_in", message: "Already signed out, or not found" } };
  const managerName = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actorId)).limit(1))[0]?.name ?? "a manager";
  void notifySignedOut(project.id, row, now, { name: managerName, note });
  void logActivity({ userId: actorId, projectId: project.id, companyId: project.companyId, section: "check-ins", action: "update", itemType: "site_checkin", itemId: row.id, metadata: { signedOut: row.workerName, note }, req });
  return { status: 200, body: serializeCheckin(row, await siteClock(project.id)) };
}

router.post("/projects/:projectId/checkins/:id/sign-out", authenticate, allow(projectApprover()), async (req: Request, res: Response) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!(await isProjectApprover(req.user!, project[0].id))) {
      res.status(403).json({ error: "forbidden", message: "Only a manager can sign someone out" });
      return;
    }
    const out = await managerSignOut(project[0].id, req.params.id, req.user!.id, req.body?.note, req);
    res.status(out.status).json(out.body);
  } catch (err) {
    req.log.error({ err }, "Manual sign-out error");
    res.status(500).json({ error: "server_error", message: "Failed to sign out" });
  }
});

// (#124) The public name lookup ("register-match") and the company list are
// gone: with them anyone holding the board link could test guessed names and
// list the roster three letters at a time. The gate identifies people by
// mobile number instead (/identify).

// Authenticated: the detail behind a check-in / check-in-blocked / sign-out
// notification (opened from the activity feed). Scoped to the notification's
// owner and their company.
// Scoped to the notification's own recipient inside the handler.
router.get("/notifications/:notificationId/checkin", authenticate, allow(ANY_MEMBER), async (req: Request, res: Response) => {
  try {
    const n = (await db.select().from(notificationsTable).where(and(eq(notificationsTable.id, req.params.notificationId), eq(notificationsTable.userId, req.user!.id))).limit(1))[0];
    if (!n || !["check_in", "check_in_blocked", "check_out", "check_in_held", "check_in_auto_closed"].includes(n.type)) { res.status(404).json({ error: "not_found", message: "Not found" }); return; }
    const meta = (n.metadata ?? {}) as { projectId?: string; workerName?: string; companyName?: string; reason?: string; checkinIds?: string[] };
    const projectId = meta.projectId ?? (n.relatedEntityType === "project" ? n.relatedEntityId : null);

    // Older notifications carry only the message text: recover name/company from it.
    const parsed = n.message.match(/^(.*?) \((.*)\) (?:checked in on site at|signed out at|was signed out by|was blocked from checking in)/);
    const workerName = meta.workerName ?? parsed?.[1] ?? null;
    const companyName = meta.companyName ?? parsed?.[2] ?? null;

    let project = projectId
      ? (await db.select({ id: projectsTable.id, name: projectsTable.name, companyId: projectsTable.companyId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0]
      : undefined;
    let checkin: OpenRow | undefined;
    if (n.relatedEntityType === "site_checkin" && n.relatedEntityId) {
      checkin = (await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, n.relatedEntityId)).limit(1))[0];
      if (checkin && !project) project = (await db.select({ id: projectsTable.id, name: projectsTable.name, companyId: projectsTable.companyId }).from(projectsTable).where(eq(projectsTable.id, checkin.projectId)).limit(1))[0];
    } else if (n.type !== "check_in_blocked" && project && workerName) {
      // Legacy check-in notification (pointed at the project): find the row by
      // name, within a few minutes of the notification.
      const rows = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, project.id)).orderBy(desc(siteCheckinsTable.checkedInAt));
      checkin = rows.find(r => normText(r.workerName) === normText(workerName) && Math.abs(r.checkedInAt.getTime() - n.createdAt.getTime()) <= 5 * 60_000);
    }
    if (!project || project.companyId !== req.user!.companyId) { res.status(404).json({ error: "not_found", message: "Not found" }); return; }

    const clock = await siteClock(project.id);

    if (n.type === "check_in_auto_closed") {
      // End-of-day list: everyone closed automatically in that run.
      const ids = Array.isArray(meta.checkinIds) ? meta.checkinIds : [];
      const rows = ids.length ? await db.select().from(siteCheckinsTable).where(and(inArray(siteCheckinsTable.id, ids), eq(siteCheckinsTable.projectId, project.id))).orderBy(asc(siteCheckinsTable.workerName)) : [];
      res.json({ kind: "auto_closed", project: { id: project.id, name: project.name }, at: n.createdAt.toISOString(), rows: rows.map(r => ({ ...serializeCheckin(r, clock), photoUrl: signUploadUrl(r.photoUrl) })) });
      return;
    }

    if (n.type === "check_in_held") {
      const decidedByName = checkin?.holdDecidedBy
        ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, checkin.holdDecidedBy)).limit(1))[0]?.name ?? null
        : null;
      res.json({
        kind: "held", project: { id: project.id, name: project.name }, at: n.createdAt.toISOString(),
        fallback: { workerName, companyName },
        checkin: checkin ? { ...serializeCheckin(checkin, clock), photoUrl: signUploadUrl(checkin.photoUrl), holdDecidedByName: decidedByName } : null,
        canDecide: await isProjectApprover(req.user!, project.id),
      });
      return;
    }

    if (n.type === "check_in_blocked") {
      const reason = meta.reason ?? (/insurance/i.test(n.message) ? "no_valid_insurance" : "not_registered");
      res.json({
        kind: "blocked", project: { id: project.id, name: project.name }, at: n.createdAt.toISOString(),
        attempt: { workerName, companyName, reason, reasonText: reason === "not_registered" ? "They are not registered on this project (name or company did not match a project contact)." : "They have no valid insurance on file." },
      });
      return;
    }
    res.json({
      kind: n.type === "check_out" ? "check_out" : "check_in",
      project: { id: project.id, name: project.name },
      at: n.createdAt.toISOString(),
      fallback: { workerName, companyName },
      checkin: checkin ? { ...serializeCheckin(checkin, clock), photoUrl: signUploadUrl(checkin.photoUrl) } : null,
    });
  } catch (err) {
    req.log.error({ err }, "Check-in notification detail error");
    res.status(500).json({ error: "server_error", message: "Failed to load" });
  }
});

async function saveCheckinPhoto(file: Express.Multer.File): Promise<string> {
  const ext = path.extname(file.originalname || ".jpg").toLowerCase() || ".jpg";
  const filename = `checkin-${randomUUID()}${ext}`;
  await uploadFile(filename).save(file.buffer, {
    contentType: file.mimetype,
    resumable: false,
    metadata: { metadata: { originalName: file.originalname } },
  });
  return `/api/uploads/${filename}`;
}

// Public check-in endpoint (#124: phone first). Who is this?
//   - a remembered device (deviceToken), or
//   - the "Is this you?" tap after /identify found their mobile (matchToken), or
//   - a mobile number on file sent directly with the check-in.
// Any of those is a VERIFIED identity, then the insurance gate runs as before.
// Otherwise (number not on file for anyone) the visitor gives name, company
// and mobile and the check-in is HELD as "unverified" for the site manager:
// nobody is turned away, but nobody reaches the fire roll unverified either.
router.post("/site/:token/checkin", checkinUpload.single("photo"), async (req: Request, res: Response) => {
  try {
    const { lat, lng, matchToken, deviceToken } = req.body;
    const workerName = typeof req.body.workerName === "string" ? req.body.workerName : "";
    const companyName = typeof req.body.companyName === "string" ? req.body.companyName : "";
    const phone = typeof req.body.phone === "string" ? req.body.phone : "";
    if (!req.file) {
      res.status(400).json({ error: "validation_error", message: "photo required" });
      return;
    }

    const qr = await db.select().from(qrCodesTable)
      .where(eq(qrCodesTable.token, req.params.token))
      .then(r => r[0]);
    if (!qr) {
      res.status(404).json({ error: "not_found", message: "Invalid site token" });
      return;
    }

    const registered = await loadRegistered(qr.projectId);
    let match: Registered | null = null;
    if (typeof deviceToken === "string" && deviceToken) {
      const who = readDeviceToken(deviceToken, qr.projectId);
      match = who ? deviceRecord(registered, who) : null;
      if (!match) { res.status(403).json({ error: "identity_not_confirmed", message: "We couldn't confirm it's you. Enter your mobile number." }); return; }
    } else if (typeof matchToken === "string" && matchToken) {
      const key = readMatchToken(matchToken, qr.projectId);
      match = key ? registered.find(r => r.key === key) ?? null : null;
      if (!match) { res.status(403).json({ error: "identity_not_confirmed", message: "That took too long. Enter your mobile number again." }); return; }
    } else {
      if (normPhone(phone).length < 9) { res.status(400).json({ error: "validation_error", message: "Enter your mobile number." }); return; }
      // Limited board: no number lookups, so it's a hold (needs name + company).
      const limited = phoneRateLimited(req, req.params.token);
      // A number on its own signs in whoever it's on file for. Once a name is
      // given ("No, that's not me" at the gate, or the number isn't on file)
      // the number proves nothing about that name: always a hold for the
      // site manager, never a sign-in as the number's owner.
      const named = !!workerName.trim() || !!companyName.trim();
      match = named || limited ? null : (await recordsForPhone(registered, phone))[0] ?? null;
      if (!match) notePhoneMiss(req, req.params.token);
      if (!match && (!workerName.trim() || !companyName.trim())) {
        res.status(400).json({ error: "validation_error", message: "Enter your name and company." });
        return;
      }
    }

    // Already signed in today, on the site's own day (by identity OR by typed
    // text): don't create a second open row; the client offers SIGN OUT
    // instead. An open row from a PREVIOUS day doesn't block.
    const clock = await siteClock(qr.projectId);
    const now = new Date();
    const today = siteDateStr(now, clock.tz);
    const typedN = normText(workerName), typedC = normText(companyName);
    const sameIdentity = (c: OpenRow) => match ? c.personKey === match.key : (normText(c.workerName) === typedN && normText(c.companyName ?? "") === typedC);
    const alreadyOpen = (await openRowsForProject(qr.projectId)).find(c => siteDateStr(c.checkedInAt, clock.tz) === today && sameIdentity(c));
    if (alreadyOpen) {
      res.status(409).json({ error: "already_signed_in", checkinId: alreadyOpen.id, checkedInAt: alreadyOpen.checkedInAt.toISOString() });
      return;
    }

    // Held responses use 403 so a page loaded before this change still shows
    // "Access Denied" rather than a success screen.
    const heldResponse = (row: { id: string; checkedInAt: Date }, reason: string) => res.status(403).json({
      error: "check_in_held", reason: reason === "unverified" ? "unverified" : "no_valid_insurance", held: true, holdReason: reason,
      holdToken: signHoldToken(qr.projectId, row.id), checkedInAt: row.checkedInAt.toISOString(),
    });

    if (!match) {
      // UNVERIFIED: number not on file. Note who they say they are (an exact
      // registered name + company, if any) so approval can file their number.
      const claimed = matchRegistered(registered, workerName, companyName);
      const pending = (await db.select().from(siteCheckinsTable).where(and(
        eq(siteCheckinsTable.projectId, qr.projectId), eq(siteCheckinsTable.holdStatus, "pending"), eq(siteCheckinsTable.holdReason, "unverified"),
      )).orderBy(desc(siteCheckinsTable.checkedInAt))).find(r => siteDateStr(r.checkedInAt, clock.tz) === today &&
        normText(r.workerName) === typedN && normText(r.companyName ?? "") === typedC && !!r.typedPhone && samePhone(r.typedPhone, phone));
      if (pending) { heldResponse(pending, "unverified"); return; }
      const photoUrl = await saveCheckinPhoto(req.file);
      const [row] = await db.insert(siteCheckinsTable).values({
        id: generateId(), projectId: qr.projectId,
        workerName: workerName.trim().slice(0, 200), companyName: companyName.trim().slice(0, 200),
        personKey: claimed?.key ?? null, typedPhone: phone.trim().slice(0, 40), photoUrl,
        lat: lat ? parseFloat(lat) : null, lng: lng ? parseFloat(lng) : null,
        holdReason: "unverified", holdStatus: "pending",
      }).returning();
      void notifyHeldCheckin(qr.projectId, row, "unverified");
      heldResponse(row, "unverified");
      return;
    }

    // INSURANCE GATE. Every match tied to a subcontractor card is checked here,
    // whichever way they were identified (a remembered device, their mobile
    // number on file, or the "Is this you?" tap after it). Same source as the
    // Contacts card badge: company insurance records plus filed insurance-named
    // person certificates, judged against today's date. "expiring_soon" still
    // passes; "expired" or "none" does NOT let them on site: the check-in is
    // HELD for an admin / PM to approve (with a reason) or refuse.
    let holdReason: "insurance_none" | "insurance_expired" | null = null;
    if (match.insuranceSubId) {
      const project = await db.select({ companyId: projectsTable.companyId }).from(projectsTable)
        .where(eq(projectsTable.id, qr.projectId)).limit(1);
      const status = project[0] ? await subcontractorInsuranceStatus(match.insuranceSubId, project[0].companyId) : "none";
      if (status === "expired") holdReason = "insurance_expired";
      else if (status === "none") holdReason = "insurance_none";
    }

    // Store the registered record's own spelling so every visit reads the same.
    const storedName = fullName(match) || workerName.trim();
    const storedCompany = match.company ?? companyName.trim();

    if (holdReason) {
      // Already waiting at the gate today? Same request, not a second one.
      const pending = (await db.select().from(siteCheckinsTable).where(and(
        eq(siteCheckinsTable.projectId, qr.projectId),
        eq(siteCheckinsTable.holdStatus, "pending"),
        eq(siteCheckinsTable.personKey, match.key),
        sql`${siteCheckinsTable.holdReason} <> 'unverified'`,
      )).orderBy(desc(siteCheckinsTable.checkedInAt)))[0];
      if (pending && siteDateStr(pending.checkedInAt, clock.tz) === today) { heldResponse(pending, pending.holdReason ?? holdReason); return; }
    }

    const photoUrl = await saveCheckinPhoto(req.file);
    const id = generateId();
    const [checkin] = await db.insert(siteCheckinsTable).values({
      id,
      projectId: qr.projectId,
      workerName: storedName,
      companyName: storedCompany,
      personKey: match.key,
      photoUrl,
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
      holdReason,
      holdStatus: holdReason ? "pending" : null,
    }).returning();

    if (holdReason) {
      void notifyHeldCheckin(qr.projectId, checkin, holdReason);
      heldResponse(checkin, holdReason);
      return;
    }

    // Fire-and-forget: the worker's check-in must not wait on (or fail with)
    // the notification fan-out.
    void notifySuccessfulCheckin(qr.projectId, storedName, storedCompany, checkin.checkedInAt, checkin.id);
    // First arrival and nobody has opened today's register: alert now, not in 5 minutes.
    void runFireRollAlerts(new Date(), qr.projectId).catch(() => {});

    res.status(201).json({ ...publicCheckin(checkin, clock), deviceToken: signDeviceToken(qr.projectId, storedName, storedCompany, match.key) });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Check-in failed" });
  }
});

// Public: the held worker's page polls this until a manager decides. On
// approval it also hands back the remembered-device token a normal check-in gets.
router.get("/site/:token/hold", async (req: Request, res: Response) => {
  try {
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    const checkinId = readHoldToken(req.query.holdToken, qr.projectId);
    if (!checkinId) { res.status(404).json({ error: "not_found", message: "Not found" }); return; }
    const row = (await db.select().from(siteCheckinsTable).where(and(eq(siteCheckinsTable.id, checkinId), eq(siteCheckinsTable.projectId, qr.projectId))).limit(1))[0];
    if (!row) { res.status(404).json({ error: "not_found", message: "Not found" }); return; }
    res.json({
      status: row.holdStatus ?? "approved",
      decidedAt: row.holdDecidedAt ? row.holdDecidedAt.toISOString() : null,
      ...(row.holdStatus === "approved" ? { deviceToken: signDeviceToken(qr.projectId, row.workerName, row.companyName ?? "", row.personKey) } : {}),
    });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to check" });
  }
});

// A held check-in is decided by an admin / PM / project approver (dashboard)
// or the site manager / cover (portal, #124). Approve needs a reason; both are
// recorded (who, when, why) on the row and in the activity log. Only a PENDING
// hold can be decided. Approving an "unverified" hold files the mobile number
// they gave on the record they named, if that record has none yet.
async function decideHold(projectId: string, checkinId: string, actorId: string, body: { decision?: unknown; note?: unknown } | undefined, req: Request): Promise<Outcome> {
  const project = (await db.select({ id: projectsTable.id, companyId: projectsTable.companyId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  if (!project) return { status: 404, body: { error: "not_found", message: "Project not found" } };
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "refuse") return { status: 400, body: { error: "validation_error", message: "decision must be approve or refuse" } };
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (decision === "approve" && !note) return { status: 400, body: { error: "validation_error", message: "Give a reason for letting them on site" } };
  const now = new Date();
  const [row] = await db.update(siteCheckinsTable)
    .set({ holdStatus: decision === "approve" ? "approved" : "refused", holdDecidedBy: actorId, holdDecidedAt: now, holdNote: note || null })
    .where(and(eq(siteCheckinsTable.id, checkinId), eq(siteCheckinsTable.projectId, project.id), eq(siteCheckinsTable.holdStatus, "pending")))
    .returning();
  if (!row) return { status: 409, body: { error: "not_pending", message: "This check-in has already been decided, or isn't waiting for a decision" } };
  let phoneFiled = false;
  if (decision === "approve" && row.holdReason === "unverified" && row.personKey && row.typedPhone) {
    phoneFiled = await fillPhoneForKey(row.personKey, row.typedPhone).catch(() => false);
  }
  void logActivity({ userId: actorId, projectId: project.id, companyId: project.companyId, section: "check-ins", action: "update", itemType: "site_checkin", itemId: row.id, metadata: { insuranceHold: decision === "approve" ? "approved" : "refused", reason: row.holdReason, note: note || null, worker: row.workerName, ...(phoneFiled ? { mobileFiled: true } : {}) }, req });
  return { status: 200, body: { ...serializeCheckin(row, await siteClock(project.id)), phoneFiled } };
}

router.post("/projects/:projectId/checkins/:id/hold-decision", authenticate, allow(projectApprover()), async (req: Request, res: Response) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!(await isProjectApprover(req.user!, project[0].id))) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can decide this" });
      return;
    }
    const out = await decideHold(project[0].id, req.params.id, req.user!.id, req.body, req);
    res.status(out.status).json(out.body);
  } catch (err) {
    req.log.error({ err }, "Hold decision error");
    res.status(500).json({ error: "server_error", message: "Failed to save the decision" });
  }
});

// Check-ins are personal data (name, company, photo, GPS). Company-wide list:
// admin / PM only. Before #116 any company login could read every check-in.
router.get("/checkins", authenticate, allow(COMPANY_MANAGER), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: siteCheckinsTable.id,
        projectId: siteCheckinsTable.projectId,
        projectName: projectsTable.name,
        workerName: siteCheckinsTable.workerName,
        companyName: siteCheckinsTable.companyName,
        photoUrl: siteCheckinsTable.photoUrl,
        checkedInAt: siteCheckinsTable.checkedInAt,
        lat: siteCheckinsTable.lat,
        lng: siteCheckinsTable.lng,
        checkedOutAt: siteCheckinsTable.checkedOutAt,
        checkoutNote: siteCheckinsTable.checkoutNote,
        checkoutMethod: siteCheckinsTable.checkoutMethod,
        personKey: siteCheckinsTable.personKey,
        holdReason: siteCheckinsTable.holdReason,
        holdStatus: siteCheckinsTable.holdStatus,
        holdNote: siteCheckinsTable.holdNote,
        holdDecidedAt: siteCheckinsTable.holdDecidedAt,
        autoClosedAt: siteCheckinsTable.autoClosedAt,
      })
      .from(siteCheckinsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, siteCheckinsTable.projectId))
      .where(eq(projectsTable.companyId, req.user!.companyId))
      .orderBy(desc(siteCheckinsTable.checkedInAt));

    const clocks = await siteClocks(rows.map(r => r.projectId));
    res.json(rows.map(r => serializeCheckin(r, clocks.get(r.projectId) ?? { tz: safeTz(null), close: DEFAULT_SITE_CLOSE })));
  } catch (err) {
    req.log.error({ err }, "List all checkins error");
    res.status(500).json({ error: "server_error", message: "Failed to load check-ins" });
  }
});

// One project's check-ins: that project's approvers (company admin / PM,
// per-project PM cover) and its designated site manager only.
router.get("/projects/:projectId/checkins", authenticate, allow(projectApprover(), projectSiteManager()), async (req: Request, res: Response) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const checkins = await db.select().from(siteCheckinsTable)
      .where(eq(siteCheckinsTable.projectId, req.params.projectId))
      .orderBy(desc(siteCheckinsTable.checkedInAt));

    const clock = await siteClock(req.params.projectId);
    res.json(checkins.map(c => serializeCheckin(c, clock)));
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load check-ins" });
  }
});

// ==========================================================================
// FIRE-ROLL READINESS (#125)
// Everything the Site Register needs to be right on the day, checked by the
// system instead of a guide: who runs it, can they get in, will they hear
// about the gate, is the board in use, and is today's copy on their phone.
// Red = the fire roll would be missing or wrong. Projects without a site QR
// code don't use the gate: "not_in_use", never alerted.
// ==========================================================================
type Light = "green" | "amber" | "red";
export type FireRollCheck = { key: string; status: Light; label: string; fix?: string };
export type FireRollReadiness = {
  projectId: string; projectName: string; status: Light | "not_in_use"; checks: FireRollCheck[];
  holders: { userId: string; name: string; role: "site_manager" | "cover"; portal: boolean }[];
  siteDate: string;
};
const worst = (a: Light[]): Light => a.includes("red") ? "red" : a.includes("amber") ? "amber" : "green";

export async function fireRollReadiness(projectId: string, now: Date = new Date()): Promise<FireRollReadiness | null> {
  const p = (await db.select({ id: projectsTable.id, name: projectsTable.name, siteManagerId: projectsTable.siteManagerId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  if (!p) return null;
  const clock = await siteClock(projectId);
  const siteDate = siteDateStr(now, clock.tz);
  const base = { projectId, projectName: p.name, siteDate };
  const qrs = await db.select({ id: qrCodesTable.id }).from(qrCodesTable).where(eq(qrCodesTable.projectId, projectId)).limit(1);
  if (qrs.length === 0) {
    return { ...base, status: "not_in_use", holders: [], checks: [{ key: "qr", status: "amber", label: "No site QR code yet, so the site register isn't in use on this project.", fix: "Create one on the Site Board tab if people sign in here." }] };
  }

  const holderIds = await registerHolderIds(projectId);
  const members = holderIds.length ? await db.select({
    userId: projectMembersTable.userId, personId: projectMembersTable.personId, openedAt: projectMembersTable.registerOpenedAt, name: usersTable.name,
  }).from(projectMembersTable).innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
    .where(and(eq(projectMembersTable.projectId, projectId), inArray(projectMembersTable.userId, holderIds))) : [];
  const byUser = new Map<string, { name: string; portal: boolean; openedAt: Date | null }>();
  for (const m of members) {
    const prev = byUser.get(m.userId as string);
    byUser.set(m.userId as string, {
      name: m.name, portal: (prev?.portal ?? false) || !!m.personId,
      openedAt: [prev?.openedAt, m.openedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    });
  }
  const holders = holderIds.map(id => ({ userId: id, name: byUser.get(id)?.name ?? "", role: (id === p.siteManagerId ? "site_manager" : "cover") as "site_manager" | "cover", portal: !!byUser.get(id)?.portal }));
  const checks: FireRollCheck[] = [];

  // 1. Someone runs the gate.
  if (holders.length === 0) {
    checks.push({ key: "who", status: "red", label: "No site manager is named and nobody has PM cover.", fix: "Name the site manager in Edit Details, or tick PM cover for someone on the Team tab." });
    return { ...base, status: "red", holders, checks };
  }
  checks.push({ key: "who", status: "green", label: `Run by ${holders.map(h => `${h.name} (${h.role === "site_manager" ? "site manager" : "PM cover"})`).join(", ")}.` });

  // 2. They can get into the Team Portal.
  const ready = holders.filter(h => h.portal);
  if (ready.length === 0) {
    const pending = await db.select({ id: projectInvitesTable.id }).from(projectInvitesTable)
      .innerJoin(peopleTable, eq(peopleTable.id, projectInvitesTable.personId))
      .where(and(eq(projectInvitesTable.projectId, projectId), eq(projectInvitesTable.status, "pending"), inArray(peopleTable.userId, holders.map(h => h.userId)))).limit(1);
    checks.push(pending.length
      ? { key: "access", status: "red", label: `${holders[0].name} hasn't accepted their Team Portal invite, so they can't open the Site Register.`, fix: "Ask them to accept it, or resend it from the Team Portal tab." }
      : { key: "access", status: "red", label: `${holders.map(h => h.name).join(", ")} ${holders.length > 1 ? "have" : "has"} no Team Portal access, so the Site Register can't be opened.`, fix: "Invite them to the Team Portal from the Team tab." });
    return { ...base, status: "red", holders, checks };
  }
  checks.push({ key: "access", status: "green", label: "Team Portal access accepted." });

  // 2b. Someone else can take over. One person alone is a single point of
  // failure: if they're off site, nobody has the fire roll on their phone.
  checks.push(ready.length > 1
    ? { key: "cover", status: "green", label: `${ready.length} people can open the Site Register.` }
    : { key: "cover", status: "amber", label: `Only ${ready[0].name} can open the Site Register. If they're off site, nobody has the fire roll.`, fix: "Tick PM cover for a second person on the Team tab and invite them to the Team Portal." });

  // 3. They'll hear about people at the gate.
  const subs = await db.select({ userId: pushSubscriptionsTable.userId }).from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.projectId, projectId), inArray(pushSubscriptionsTable.userId, ready.map(h => h.userId))));
  checks.push(subs.length
    ? { key: "notify", status: "green", label: "Phone notifications on." }
    : { key: "notify", status: "amber", label: "Notifications are off, so nobody on site hears when someone is waiting at the gate.", fix: "Turn them on in Team Portal Settings." });

  // 4. The board is actually in use at the gate.
  const recent = await db.select({ id: siteCheckinsTable.id }).from(siteCheckinsTable)
    .where(and(eq(siteCheckinsTable.projectId, projectId), sql`${siteCheckinsTable.checkedInAt} > now() - interval '7 days'`)).limit(1);
  checks.push(recent.length
    ? { key: "board", status: "green", label: "People are signing in at the site QR code." }
    : { key: "board", status: "amber", label: "Nobody has signed in at the site QR code in the last week.", fix: "Check the QR code is posted at the gate." });

  // 5. Today's register is on their phone. Red once people have signed in
  // today and nobody has opened it: the saved copy would be a wrong fire roll.
  const openedToday = ready.some(h => { const o = byUser.get(h.userId)?.openedAt; return !!o && siteDateStr(o, clock.tz) === siteDate; });
  if (openedToday) {
    checks.push({ key: "today", status: "green", label: "Site Register opened today." });
  } else {
    const todays = await db.select({ checkedInAt: siteCheckinsTable.checkedInAt }).from(siteCheckinsTable)
      .where(and(eq(siteCheckinsTable.projectId, projectId), sql`${siteCheckinsTable.checkedInAt} > now() - interval '36 hours'`,
        sql`(${siteCheckinsTable.holdStatus} IS NULL OR ${siteCheckinsTable.holdStatus} = 'approved')`));
    const arrived = todays.some(r => siteDateStr(r.checkedInAt, clock.tz) === siteDate);
    checks.push(arrived
      ? { key: "today", status: "red", label: "People have signed in today but the Site Register hasn't been opened, so the copy on the phone is out of date.", fix: "Open the Site Register in the Team Portal with signal." }
      : { key: "today", status: "amber", label: "Site Register not opened yet today.", fix: "Open it in the Team Portal once people start arriving." });
  }
  return { ...base, status: worst(checks.map(c => c.status)), holders, checks };
}

// One alert a day while red: a push to the site manager / cover who can open
// the Team Portal, and a notification to the company's admins and PMs (they
// fix missing invites and cover). Only during the site day (07:00 to close),
// and never for a project that doesn't use the gate.
const FIRE_ROLL_DAY_START = "07:00";
export async function runFireRollAlerts(now: Date = new Date(), onlyProjectId?: string): Promise<number> {
  const projects = await db.select({ id: projectsTable.id, companyId: projectsTable.companyId, alertedOn: projectsTable.fireRollAlertedOn })
    .from(projectsTable)
    .where(and(eq(projectsTable.status, "active"), onlyProjectId ? eq(projectsTable.id, onlyProjectId) : sql`true`,
      sql`EXISTS (SELECT 1 FROM qr_codes q WHERE q.project_id = ${projectsTable.id})`));
  let sent = 0;
  for (const proj of projects) {
    const clock = await siteClock(proj.id);
    const hhmm = siteTime(now, clock.tz);
    if (hhmm < FIRE_ROLL_DAY_START || hhmm >= clock.close) continue;
    const r = await fireRollReadiness(proj.id, now);
    if (!r || r.status !== "red" || proj.alertedOn === r.siteDate) continue;
    // Claim today's alert first, so two runs can't both send it.
    const claimed = await db.update(projectsTable).set({ fireRollAlertedOn: r.siteDate })
      .where(and(eq(projectsTable.id, proj.id), sql`${projectsTable.fireRollAlertedOn} IS DISTINCT FROM ${r.siteDate}`)).returning({ id: projectsTable.id });
    if (!claimed.length) continue;
    const reasons = r.checks.filter(c => c.status === "red");
    const body = reasons.map(c => c.label).join(" ");
    for (const h of r.holders.filter(x => x.portal)) {
      void sendPushToMember(h.userId, proj.id, { title: `Fire roll not ready: ${r.projectName}`, body, url: "/portal/site-register", tag: `fire-roll-${proj.id}` }).catch(() => {});
    }
    const managers = await db.select({ userId: companyMembersTable.userId }).from(companyMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
      .where(and(eq(companyMembersTable.companyId, proj.companyId), inArray(companyMembersTable.role, ["admin", "project_manager"]), eq(usersTable.portalOnly, false)));
    for (const m of managers) {
      await db.insert(notificationsTable).values({
        id: generateId(), userId: m.userId, type: "fire_roll_not_ready",
        title: `Fire roll not ready: ${r.projectName}`,
        message: `${body} ${reasons.map(c => c.fix).filter(Boolean).join(" ")}`.trim(),
        relatedEntityId: proj.id, relatedEntityType: "project",
        metadata: { projectId: proj.id, checks: reasons.map(c => c.key) }, read: false,
      });
    }
    sent++;
  }
  return sent;
}

// Dashboard: one project's readiness (its approvers) and the company's
// projects that use the gate (admins / PMs, for Needs Attention).
router.get("/projects/:projectId/fire-roll", authenticate, allow(projectApprover()), async (req: Request, res: Response) => {
  try {
    const owned = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!owned[0]) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    res.json(await fireRollReadiness(req.params.projectId));
  } catch (err) {
    req.log.error({ err }, "Fire roll readiness error");
    res.status(500).json({ error: "server_error", message: "Failed to check the fire roll" });
  }
});
router.get("/fire-roll", authenticate, allow(COMPANY_MANAGER), async (req: Request, res: Response) => {
  try {
    const projects = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.companyId, req.user!.companyId), eq(projectsTable.status, "active"),
        sql`EXISTS (SELECT 1 FROM qr_codes q WHERE q.project_id = ${projectsTable.id})`));
    const out: FireRollReadiness[] = [];
    for (const p of projects) { const r = await fireRollReadiness(p.id); if (r) out.push(r); }
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Fire roll list error");
    res.status(500).json({ error: "server_error", message: "Failed to check the fire roll" });
  }
});

// ==========================================================================
// TEAM PORTAL SITE REGISTER (#124)
// The designated site manager and anyone given PM cover on the project run
// the gate from their phone when the PM isn't there: who is on site now (the
// fire roll), who is waiting at the gate, approve / refuse, sign someone out.
// Nothing else (permits, documents, milestones, close-out) moves to the portal.
// ==========================================================================
const requireSiteRegister = declarePolicy(async function (req: Request, res: Response, next: import("express").NextFunction): Promise<void> {
  try {
    if (!req.portalProjectId || !(await canSeeSiteRegister(req.user!.id, req.portalProjectId))) {
      res.status(403).json({ error: "forbidden", message: "Only the site manager or someone covering for the project manager can see the site register." });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "requireSiteRegister failed");
    res.status(500).json({ error: "server_error", message: "Permission check failed." });
  }
}, "siteManagerOrCover");
const siteRegisterGuards = [authenticate, requirePortalSession, requirePortalMember, requireSiteRegister];

router.get("/portal/site-register", ...siteRegisterGuards, async (req: Request, res: Response) => {
  try {
    const projectId = req.portalProjectId!;
    // Readiness check 5: today's copy is now on this phone.
    await db.update(projectMembersTable).set({ registerOpenedAt: new Date() })
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, req.user!.id)));
    const project = (await db.select({ name: projectsTable.name, companyId: projectsTable.companyId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
    const clock = await siteClock(projectId);
    const now = new Date();
    // Today's site day can't start more than ~36h back; open rows are kept regardless.
    const rows = await db.select().from(siteCheckinsTable).where(and(
      eq(siteCheckinsTable.projectId, projectId),
      or(sql`${siteCheckinsTable.checkedInAt} > now() - interval '48 hours'`, isNull(siteCheckinsTable.checkedOutAt)),
    )).orderBy(desc(siteCheckinsTable.checkedInAt));
    const registered = await loadRegistered(projectId);
    const byKey = new Map(registered.map(r => [r.key, r]));
    const seen = new Set<string>();
    const onSite: object[] = [], notSignedOut: object[] = [], held: object[] = [];
    for (const r of rows) {
      const st = checkinState(r, clock, now);
      const base = { id: r.id, workerName: r.workerName, companyName: r.companyName, checkedInAt: r.checkedInAt.toISOString() };
      if (st.presence === "held") {
        const claimed = r.personKey ? byKey.get(r.personKey) : undefined;
        const insurance = claimed?.insuranceSubId && project ? await subcontractorInsuranceStatus(claimed.insuranceSubId, project.companyId) : null;
        held.push({
          ...base, holdReason: r.holdReason, why: holdReasonText(r.holdReason),
          typedPhone: r.holdReason === "unverified" ? r.typedPhone : null,
          claimed: claimed ? { name: fullName(claimed) || r.workerName, company: claimed.company } : null,
          insurance, photoUrl: signUploadUrl(r.photoUrl),
        });
        continue;
      }
      if (st.presence !== "on_site" && st.presence !== "auto_closed_today") continue;
      // One person, one line (newest row wins).
      const ident = r.personKey ?? `${normText(r.workerName)}|${normText(r.companyName ?? "")}`;
      if (seen.has(ident)) continue;
      seen.add(ident);
      (st.presence === "on_site" ? onSite : notSignedOut).push({ ...base, autoClosedAt: st.autoClosedAt });
    }
    const byName = (a: any, b: any) => String(a.workerName).localeCompare(String(b.workerName));
    onSite.sort(byName); notSignedOut.sort(byName);
    res.json({
      projectId, projectName: project?.name ?? "", generatedAt: now.toISOString(),
      siteTimeZone: clock.tz, siteTzLabel: siteTzLabel(clock.tz, now), siteDate: siteDateStr(now, clock.tz),
      onSite, notSignedOut, held,
      readiness: await fireRollReadiness(projectId, now),
    });
  } catch (err) {
    req.log.error({ err }, "Portal site register error");
    res.status(500).json({ error: "server_error", message: "Failed to load the site register" });
  }
});

router.post("/portal/site-register/:id/sign-out", ...siteRegisterGuards, async (req: Request, res: Response) => {
  try {
    const out = await managerSignOut(req.portalProjectId!, req.params.id, req.user!.id, req.body?.note, req);
    res.status(out.status).json(out.body);
  } catch (err) {
    req.log.error({ err }, "Portal sign-out error");
    res.status(500).json({ error: "server_error", message: "Failed to sign out" });
  }
});

router.post("/portal/site-register/:id/hold-decision", ...siteRegisterGuards, async (req: Request, res: Response) => {
  try {
    const out = await decideHold(req.portalProjectId!, req.params.id, req.user!.id, req.body, req);
    res.status(out.status).json(out.body);
  } catch (err) {
    req.log.error({ err }, "Portal hold decision error");
    res.status(500).json({ error: "server_error", message: "Failed to save the decision" });
  }
});

export default router;

// ---- End of day (#114) ------------------------------------------------------
// Every few minutes: any check-in still not signed out once its site's close
// time has passed is closed AUTOMATICALLY. That is not a sign-out (checkedOutAt
// stays empty; they may still be there): it only stops them counting as on
// site, and today's register keeps listing them, marked. A hold nobody decided
// by then lapses. Managers get one end-of-day list per project per run.
// Idempotent: every update re-checks the row is still open.
export async function runCheckinAutoClose(now: Date = new Date()): Promise<{ closed: number; lapsed: number }> {
  const rows = await db.select().from(siteCheckinsTable).where(and(
    isNull(siteCheckinsTable.checkedOutAt),
    isNull(siteCheckinsTable.autoClosedAt),
    sql`coalesce(${siteCheckinsTable.checkoutMethod}, '') <> 'legacy'`,
    sql`(${siteCheckinsTable.holdStatus} IS NULL OR ${siteCheckinsTable.holdStatus} IN ('approved', 'pending'))`,
  ));
  if (rows.length === 0) return { closed: 0, lapsed: 0 };
  const clocks = await siteClocks(rows.map(r => r.projectId));
  const closedByProject = new Map<string, { row: typeof rows[number]; due: Date }[]>();
  let closed = 0, lapsed = 0;
  for (const r of rows) {
    const clock = clocks.get(r.projectId) ?? { tz: safeTz(null), close: DEFAULT_SITE_CLOSE };
    const due = closeDueAfter(r.checkedInAt, clock.tz, clock.close);
    if (now.getTime() < due.getTime()) continue;
    if (r.holdStatus === "pending") {
      const done = await db.update(siteCheckinsTable).set({ holdStatus: "lapsed" })
        .where(and(eq(siteCheckinsTable.id, r.id), eq(siteCheckinsTable.holdStatus, "pending"))).returning({ id: siteCheckinsTable.id });
      lapsed += done.length;
      continue;
    }
    const done = await db.update(siteCheckinsTable).set({ autoClosedAt: due })
      .where(and(eq(siteCheckinsTable.id, r.id), isNull(siteCheckinsTable.checkedOutAt), isNull(siteCheckinsTable.autoClosedAt))).returning({ id: siteCheckinsTable.id });
    if (done.length === 0) continue;
    closed++;
    // Only tell managers about closes from the last day; a backlog of old rows
    // (the first run after release) is closed quietly.
    if (now.getTime() - due.getTime() <= 24 * 60 * 60 * 1000) {
      if (!closedByProject.has(r.projectId)) closedByProject.set(r.projectId, []);
      closedByProject.get(r.projectId)!.push({ row: r, due });
    }
  }
  for (const [projectId, list] of closedByProject) {
    try {
      const rec = await checkinRecipients(projectId);
      if (!rec) continue;
      const clock = clocks.get(projectId) ?? { tz: safeTz(null), close: DEFAULT_SITE_CLOSE };
      const at = list[0].due;
      const names = list.map(x => `${x.row.workerName}${x.row.companyName ? ` (${x.row.companyName})` : ""}`);
      const shown = names.slice(0, 8).join(", ") + (names.length > 8 ? ` and ${names.length - 8} more` : "");
      for (const userId of rec.userIds) {
        await db.insert(notificationsTable).values({
          id: generateId(),
          userId,
          type: "check_in_auto_closed",
          title: `${list.length} not signed out at ${rec.projectName}`,
          message: `Not signed out by ${siteTime(at, clock.tz)} ${siteTzLabel(clock.tz, at)}: ${shown}. They no longer count as on site, but stay on today's register, marked, until signed out.`,
          relatedEntityId: projectId,
          relatedEntityType: "project",
          metadata: { projectId, checkinIds: list.map(x => x.row.id) },
          read: false,
        });
      }
    } catch {
      /* alerting is best-effort */
    }
  }
  return { closed, lapsed };
}

const AUTO_CLOSE_INTERVAL_MS = 5 * 60 * 1000;
export function scheduleCheckinAutoClose(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): void {
  const tick = () => {
    runCheckinAutoClose()
      .then(r => { if (r.closed || r.lapsed) log.info(r, "check-in auto-close run"); })
      .catch(err => log.error({ err }, "check-in auto-close failed"));
    runFireRollAlerts()
      .then(n => { if (n) log.info({ projects: n }, "fire-roll not-ready alerts sent"); })
      .catch(err => log.error({ err }, "fire-roll alerts failed"));
  };
  // First run after boot gives ensureSchema time to add the columns.
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, AUTO_CLOSE_INTERVAL_MS).unref?.();
}
