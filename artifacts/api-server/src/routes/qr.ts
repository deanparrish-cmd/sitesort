import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qrCodesTable, qrBoardPinsTable, documentsTable, projectsTable, projectMembersTable, usersTable, permitsTable, photosTable, siteCheckinsTable, subcontractorsTable, calendarEventsTable, companyMembersTable, notificationsTable, peopleTable, companiesTable } from "@workspace/db/schema";
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
import { getBucket, objectKey } from "../lib/gcs";
import { londonDateStr } from "../lib/daily-reports";
import { isProjectApprover } from "../lib/project-authority";
import { logActivity } from "../lib/activity";

const checkinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Images only"));
  },
});

const router: IRouter = Router();

// Best-effort: alert the project's managers (owner company users with an admin /
// project_manager role) when a worker is turned away at check-in, so a blocked
// arrival never goes unseen. Never throws — a failed alert must not fail the
// check-in response.
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
    .where(and(
      eq(companyMembersTable.companyId, proj.companyId),
      inArray(companyMembersTable.role, ["admin", "project_manager"]),
    ));
  const ids = new Set(managers.map(m => m.userId));
  if (proj.siteManagerId) ids.add(proj.siteManagerId);
  return { projectName: proj.name, userIds: [...ids] };
}

async function notifyBlockedCheckin(
  projectId: string,
  workerName: string,
  companyName: string,
  reason: "not_registered" | "no_valid_insurance",
): Promise<void> {
  try {
    const rec = await checkinRecipients(projectId);
    if (!rec) return;
    const reasonText = reason === "not_registered"
      ? "they are not registered on this project"
      : "they have no valid insurance on file";
    for (const userId of rec.userIds) {
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        type: "check_in_blocked",
        title: `Check-in blocked at ${rec.projectName}`,
        message: `${workerName} (${companyName}) was blocked from checking in: ${reasonText}.`,
        relatedEntityId: projectId,
        relatedEntityType: "project",
        read: false,
      });
    }
  } catch {
    /* alerting is best-effort */
  }
}

// Best-effort: tell the same audience (managers + site manager) who arrived
// and when, each time a worker successfully checks in via the QR board.
async function notifySuccessfulCheckin(
  projectId: string,
  workerName: string,
  companyName: string,
  checkedInAt: Date,
): Promise<void> {
  try {
    const rec = await checkinRecipients(projectId);
    if (!rec) return;
    const timeStr = checkedInAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    for (const userId of rec.userIds) {
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        type: "check_in",
        title: `Check-in at ${rec.projectName}`,
        message: `${workerName} (${companyName}) checked in on site at ${timeStr}.`,
        relatedEntityId: projectId,
        relatedEntityType: "project",
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

// List QR codes for a project
router.get("/projects/:projectId/qr-codes", authenticate, async (req, res) => {
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
router.post("/projects/:projectId/qr-codes", authenticate, async (req, res) => {
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
router.delete("/projects/:projectId/qr-codes/:id", authenticate, async (req, res) => {
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
router.get("/projects/:projectId/qr-pins", authenticate, async (req, res) => {
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
router.post("/projects/:projectId/qr-pins", authenticate, async (req, res) => {
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
router.delete("/projects/:projectId/qr-pins", authenticate, async (req, res) => {
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
    res.json({ ...payload, onSiteCount: await countOnSite(qr.projectId), generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load site board" });
  }
});

// Sign-out state for a check-in row. One row = one in/out cycle. `onSite` means
// signed in and not signed out; `notSignedOut` flags an open row from a
// PREVIOUS (London) day. Those are surfaced for a manager to close manually,
// never auto-closed, so the emergency roll-call never silently drops anyone.
function checkinState(c: { checkedInAt: Date; checkedOutAt: Date | null; checkoutMethod?: string | null }) {
  // 'legacy' = recorded before sign-out existed (no way to sign out then), so
  // it's history, not someone still on site.
  const open = !c.checkedOutAt && c.checkoutMethod !== "legacy";
  return {
    onSite: open,
    notSignedOut: open && londonDateStr(c.checkedInAt) < londonDateStr(new Date()),
  };
}
function serializeCheckin<T extends { checkedInAt: Date; checkedOutAt: Date | null; checkoutMethod?: string | null }>(c: T) {
  return {
    ...c,
    checkedInAt: c.checkedInAt.toISOString(),
    checkedOutAt: c.checkedOutAt ? c.checkedOutAt.toISOString() : null,
    ...checkinState(c),
  };
}
// The person's currently-open cycles on a project (name + company, case-insensitive),
// newest first.
async function openCheckinsFor(projectId: string, workerName: string, companyName: string) {
  return db.select().from(siteCheckinsTable).where(and(
    eq(siteCheckinsTable.projectId, projectId),
    isNull(siteCheckinsTable.checkedOutAt),
    sql`coalesce(${siteCheckinsTable.checkoutMethod}, '') <> 'legacy'`,
    sql`lower(regexp_replace(trim(${siteCheckinsTable.workerName}), '[[:space:]]+', ' ', 'g')) = ${normText(workerName)}`,
    sql`lower(regexp_replace(trim(coalesce(${siteCheckinsTable.companyName}, '')), '[[:space:]]+', ' ', 'g')) = ${normText(companyName)}`,
  )).orderBy(desc(siteCheckinsTable.checkedInAt));
}

// Count-only view of the "Currently on site" register (signed in, not signed out;
// legacy rows excluded) for the PUBLIC board. Deliberately no names.
async function countOnSite(projectId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(siteCheckinsTable).where(and(
    eq(siteCheckinsTable.projectId, projectId),
    isNull(siteCheckinsTable.checkedOutAt),
    sql`coalesce(${siteCheckinsTable.checkoutMethod}, '') <> 'legacy'`,
  ));
  return row?.n ?? 0;
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
// Optimal string alignment distance: like Levenshtein, but swapping two
// adjacent letters ("Pual" for "Paul") costs 1 edit, the most common typo.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// "Close" = within ~20% edits (min 1, max 3). Catches small typos and swaps.
function isClose(typed: string, actual: string): boolean {
  if (!typed || !actual) return false;
  const limit = Math.min(3, Math.max(1, Math.floor(Math.max(typed.length, actual.length) * 0.2)));
  return editDistance(typed, actual) <= limit;
}
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

type OpenRow = typeof siteCheckinsTable.$inferSelect;
async function openRowsForProject(projectId: string): Promise<OpenRow[]> {
  return db.select().from(siteCheckinsTable).where(and(
    eq(siteCheckinsTable.projectId, projectId),
    isNull(siteCheckinsTable.checkedOutAt),
    sql`coalesce(${siteCheckinsTable.checkoutMethod}, '') <> 'legacy'`,
  )).orderBy(desc(siteCheckinsTable.checkedInAt));
}
// Public label = first name + company only. If two people on site would show
// the same label, add the surname initial to tell them apart (never the full name).
function publicLabels(rows: OpenRow[]): Map<string, string> {
  const base = (r: OpenRow) => `${firstName(r.workerName)}, ${r.companyName ?? ""}`.replace(/, $/, "");
  const count = new Map<string, number>();
  for (const r of rows) count.set(base(r).toLowerCase(), (count.get(base(r).toLowerCase()) ?? 0) + 1);
  return new Map(rows.map(r => {
    const parts = r.workerName.trim().split(/\s+/);
    const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : "";
    const dup = (count.get(base(r).toLowerCase()) ?? 0) > 1;
    return [r.id, dup ? `${firstName(r.workerName)}${initial}, ${r.companyName ?? ""}`.replace(/, $/, "") : base(r)];
  }));
}

// Remembered-device token: a signed, project-scoped record of who last signed
// in from this device. Nothing new is stored server-side.
const DEVICE_TOKEN_TTL = "180d";
function signDeviceToken(projectId: string, workerName: string, companyName: string): string {
  return jwt.sign({ kind: "site-device", projectId, workerName, companyName }, process.env.JWT_SECRET as string, { expiresIn: DEVICE_TOKEN_TTL });
}
function readDeviceToken(raw: unknown, projectId: string): { workerName: string; companyName: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const p = jwt.verify(raw, process.env.JWT_SECRET as string) as any;
    if (p?.kind !== "site-device" || p.projectId !== projectId) return null;
    return { workerName: String(p.workerName), companyName: String(p.companyName) };
  } catch { return null; }
}

// Public: who on THIS site matches what the visitor has typed?
//  - exact: their own open sign-in (normalised name + company)
//  - matches: people signed in whose name contains the typed text, ONLY once at
//    least 3 letters are typed (never a full public list). First name + company.
//  - suggestions: near-misses (typos) offered as "Did you mean...?" only when
//    there is no exact match. The client always asks the user to confirm.
router.get("/site/:token/who", async (req: Request, res: Response) => {
  try {
    const workerName = String(req.query.workerName ?? "");
    const companyName = String(req.query.companyName ?? "");
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }

    const typedName = normText(workerName);
    const typedCompany = normText(companyName);
    const open = typedName.length >= 3 ? await openRowsForProject(qr.projectId) : [];
    const labels = publicLabels(open);
    const shape = (r: OpenRow) => ({ checkinId: r.id, label: labels.get(r.id), checkedInAt: r.checkedInAt.toISOString() });

    const exact = typedCompany ? open.find(r => normText(r.workerName) === typedName && normText(r.companyName ?? "") === typedCompany) : undefined;
    if (exact) { res.json({ exact: shape(exact), matches: [], suggestions: [] }); return; }

    const tokens = (r: OpenRow) => normText(r.workerName).split(" ");
    const matches = open.filter(r => normText(r.workerName).includes(typedName) || tokens(r).some(t => t.startsWith(typedName)));
    let suggestions: OpenRow[] = [];
    if (matches.length === 0) {
      suggestions = open.filter(r => {
        const nameClose = isClose(typedName, normText(r.workerName));
        if (!nameClose) return false;
        return !typedCompany || isClose(typedCompany, normText(r.companyName ?? "")) || normText(r.companyName ?? "").includes(typedCompany) || typedCompany.includes(normText(r.companyName ?? ""));
      });
      // A typed name that is a typo AND a company that only partly matches also counts
      if (suggestions.length === 0 && typedName.includes(" ")) {
        suggestions = open.filter(r => isClose(typedName, normText(r.workerName)));
      }
    }
    res.json({ exact: null, matches: matches.slice(0, 8).map(shape), suggestions: suggestions.slice(0, 5).map(shape) });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to look up" });
  }
});

// Public: verify a remembered-device token and report current status.
router.get("/site/:token/device", async (req: Request, res: Response) => {
  try {
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    const who = readDeviceToken(req.query.deviceToken, qr.projectId);
    if (!who) { res.json({ valid: false }); return; }
    const open = await openCheckinsFor(qr.projectId, who.workerName, who.companyName);
    res.json({ valid: true, workerName: who.workerName, companyName: who.companyName, onSite: !!open[0], checkinId: open[0]?.id ?? null, checkedInAt: open[0] ? open[0].checkedInAt.toISOString() : null });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to check device" });
  }
});

// Public: company names already linked to this project, for autocomplete at
// sign-in. Free text is still allowed for anything not listed.
router.get("/site/:token/companies", async (req: Request, res: Response) => {
  try {
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    const own = await db.select({ name: companiesTable.name }).from(projectsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, projectsTable.companyId))
      .where(eq(projectsTable.id, qr.projectId));
    const linked = await db.select({ name: subcontractorsTable.companyName })
      .from(projectMembersTable)
      .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
      .where(eq(projectMembersTable.projectId, qr.projectId));
    const viaPeople = await db.select({ name: subcontractorsTable.companyName })
      .from(projectMembersTable)
      .innerJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
      .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, peopleTable.subcontractorId))
      .where(and(eq(projectMembersTable.projectId, qr.projectId), isNull(peopleTable.archivedAt)));
    const names = [...new Set([...own, ...linked, ...viaPeople].map(r => (r.name ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json(names);
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to load companies" });
  }
});

// Public: is this person currently signed in on this site? Drives whether the
// QR page offers SIGN IN or SIGN OUT. Returns only a boolean + their own times.
router.get("/site/:token/status", async (req: Request, res: Response) => {
  try {
    const workerName = String(req.query.workerName ?? "");
    const companyName = String(req.query.companyName ?? "");
    if (!workerName.trim() || !companyName.trim()) {
      res.status(400).json({ error: "validation_error", message: "workerName and companyName required" });
      return;
    }
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    const open = await openCheckinsFor(qr.projectId, workerName, companyName);
    const latest = open[0];
    res.json({ onSite: !!latest, checkinId: latest?.id ?? null, checkedInAt: latest ? latest.checkedInAt.toISOString() : null });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to check status" });
  }
});

// Public: sign out. Closes the person's most recent open cycle only; an older
// unclosed cycle from a previous day stays flagged for a manager.
router.post("/site/:token/checkout", async (req: Request, res: Response) => {
  try {
    const { workerName, companyName, checkinId } = req.body ?? {};
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    // Either the visitor tapped a specific person from the on-site suggestions
    // (checkinId, project-scoped, still open), or typed name + company.
    let open: OpenRow[];
    if (typeof checkinId === "string" && checkinId) {
      open = (await openRowsForProject(qr.projectId)).filter(r => r.id === checkinId);
    } else {
      if (!workerName?.trim() || !companyName?.trim()) {
        res.status(400).json({ error: "validation_error", message: "workerName and companyName required" });
        return;
      }
      open = await openCheckinsFor(qr.projectId, workerName, companyName);
    }
    if (!open[0]) { res.status(409).json({ error: "not_signed_in", message: "You are not signed in on this site" }); return; }
    const [row] = await db.update(siteCheckinsTable)
      .set({ checkedOutAt: new Date(), checkoutMethod: "self" })
      .where(and(eq(siteCheckinsTable.id, open[0].id), isNull(siteCheckinsTable.checkedOutAt)))
      .returning();
    if (!row) { res.status(409).json({ error: "not_signed_in", message: "You are not signed in on this site" }); return; }
    res.json(serializeCheckin(row));
  } catch {
    res.status(500).json({ error: "server_error", message: "Sign-out failed" });
  }
});

// Authenticated: a manager signs someone out on their behalf (forgot to sign
// out), with a required note. Admin / project manager / project approver only.
router.post("/projects/:projectId/checkins/:id/sign-out", authenticate, async (req: Request, res: Response) => {
  try {
    const project = await db.select({ id: projectsTable.id, companyId: projectsTable.companyId }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!(await isProjectApprover(req.user!, project[0].id))) {
      res.status(403).json({ error: "forbidden", message: "Only a manager can sign someone out" });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!note) { res.status(400).json({ error: "validation_error", message: "A note is required" }); return; }
    const [row] = await db.update(siteCheckinsTable)
      .set({ checkedOutAt: new Date(), checkedOutBy: req.user!.id, checkoutNote: note.slice(0, 500), checkoutMethod: "manual" })
      .where(and(
        eq(siteCheckinsTable.id, req.params.id),
        eq(siteCheckinsTable.projectId, project[0].id),
        isNull(siteCheckinsTable.checkedOutAt),
      )).returning();
    if (!row) { res.status(409).json({ error: "not_signed_in", message: "Already signed out, or not found" }); return; }
    void logActivity({ userId: req.user!.id, projectId: project[0].id, companyId: project[0].companyId, section: "check-ins", action: "update", itemType: "site_checkin", itemId: row.id, metadata: { signedOut: row.workerName, note }, req });
    res.json(serializeCheckin(row));
  } catch (err) {
    req.log.error({ err }, "Manual sign-out error");
    res.status(500).json({ error: "server_error", message: "Failed to sign out" });
  }
});

// Public check-in endpoint — validates contact registration and insurance before recording
router.post("/site/:token/checkin", checkinUpload.single("photo"), async (req: Request, res: Response) => {
  try {
    const { workerName, companyName, lat, lng } = req.body;
    if (!workerName?.trim() || !companyName?.trim()) {
      res.status(400).json({ error: "validation_error", message: "workerName and companyName required" });
      return;
    }
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

    // Already signed in today: don't create a second open row; the client
    // should offer SIGN OUT instead. (An open row from a PREVIOUS day doesn't
    // block: a new visit is a new row and the old one stays flagged.)
    const alreadyOpen = (await openCheckinsFor(qr.projectId, workerName, companyName))
      .find(c => londonDateStr(c.checkedInAt) === londonDateStr(new Date()));
    if (alreadyOpen) {
      res.status(409).json({ error: "already_signed_in", checkinId: alreadyOpen.id, checkedInAt: alreadyOpen.checkedInAt.toISOString() });
      return;
    }

    const nameLower = workerName.trim().toLowerCase();
    const companyLower = companyName.trim().toLowerCase();

    // 1) In-house team members (users) assigned to this project — matched on name
    //    alone (no company / insurance requirement: they're covered by the company).
    const projectUsers = await db
      .select({ name: usersTable.name })
      .from(projectMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
      .where(eq(projectMembersTable.projectId, qr.projectId));

    const isInHouseMember = projectUsers.some(u => u.name.trim().toLowerCase() === nameLower);

    if (!isInHouseMember) {
      // 2) Otherwise must be a subcontractor contact linked to this project (name + company)
      //    with at least one valid (non-archived, non-expired) insurance certificate.
      const projectContacts = await db
        .select({
          id: subcontractorsTable.id,
          contactName: subcontractorsTable.contactName,
          companyName: subcontractorsTable.companyName,
        })
        .from(projectMembersTable)
        .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
        .where(eq(projectMembersTable.projectId, qr.projectId));

      const matched = projectContacts.find(c =>
        c.contactName.toLowerCase() === nameLower &&
        c.companyName.toLowerCase() === companyLower
      );

      // 3) Team contacts (people) added to this project via project_members.person_id
      //    — e.g. a subcontractor's individual workers invited to the portal.
      //    Matched on the person's name; if they belong to a subcontractor, the
      //    typed company name must match that subcontractor's company name and
      //    the same insurance rule applies.
      let insuranceSubId: string | null = matched?.id ?? null;
      let isRegistered = !!matched;
      if (!matched) {
        const projectPeople = await db
          .select({
            personName: peopleTable.name,
            subId: peopleTable.subcontractorId,
            subCompanyName: subcontractorsTable.companyName,
          })
          .from(projectMembersTable)
          .innerJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
          .leftJoin(subcontractorsTable, eq(subcontractorsTable.id, peopleTable.subcontractorId))
          .where(and(
            eq(projectMembersTable.projectId, qr.projectId),
            isNull(peopleTable.archivedAt),
          ));

        const matchedPerson = projectPeople.find(p =>
          p.personName.trim().toLowerCase() === nameLower &&
          (p.subCompanyName ? p.subCompanyName.trim().toLowerCase() === companyLower : true)
        );
        if (matchedPerson) {
          isRegistered = true;
          insuranceSubId = matchedPerson.subId ?? null;
        }
      }

      if (!isRegistered) {
        await notifyBlockedCheckin(qr.projectId, workerName.trim(), companyName.trim(), "not_registered");
        res.status(403).json({ error: "check_in_blocked", reason: "not_registered" });
        return;
      }

      if (insuranceSubId) {
        // Same source the Contacts directory's "Insurance OK" badge reads
        // (company-level insurance_records PLUS any filed insurance-named
        // person certification) — a contact shown as insured on their card
        // must pass here too. "expiring_soon" still passes (not yet expired);
        // only "expired" or "none" blocks.
        const project = await db.select({ companyId: projectsTable.companyId }).from(projectsTable)
          .where(eq(projectsTable.id, qr.projectId)).limit(1);
        const status = project[0] ? await subcontractorInsuranceStatus(insuranceSubId, project[0].companyId) : "none";

        if (status === "expired" || status === "none") {
          await notifyBlockedCheckin(qr.projectId, workerName.trim(), companyName.trim(), "no_valid_insurance");
          res.status(403).json({ error: "check_in_blocked", reason: "no_valid_insurance" });
          return;
        }
      }
    }

    const ext = path.extname(req.file.originalname || ".jpg").toLowerCase() || ".jpg";
    const filename = `checkin-${randomUUID()}${ext}`;
    const key = objectKey(filename);
    await getBucket().file(key).save(req.file.buffer, {
      contentType: req.file.mimetype,
      resumable: false,
      metadata: { metadata: { originalName: req.file.originalname } },
    });

    const photoUrl = `/api/uploads/${filename}`;
    const id = generateId();
    const [checkin] = await db.insert(siteCheckinsTable).values({
      id,
      projectId: qr.projectId,
      workerName: workerName.trim(),
      companyName: companyName.trim(),
      photoUrl,
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
    }).returning();

    // Fire-and-forget: the worker's check-in must not wait on (or fail with)
    // the notification fan-out.
    void notifySuccessfulCheckin(qr.projectId, workerName.trim(), companyName.trim(), checkin.checkedInAt);

    res.status(201).json({ ...serializeCheckin(checkin), deviceToken: signDeviceToken(qr.projectId, workerName.trim(), companyName.trim()) });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Check-in failed" });
  }
});

// Authenticated — list all check-ins across all company projects
router.get("/checkins", authenticate, async (req: Request, res: Response) => {
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
      })
      .from(siteCheckinsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, siteCheckinsTable.projectId))
      .where(eq(projectsTable.companyId, req.user!.companyId))
      .orderBy(desc(siteCheckinsTable.checkedInAt));

    res.json(rows.map(serializeCheckin));
  } catch (err) {
    req.log.error({ err }, "List all checkins error");
    res.status(500).json({ error: "server_error", message: "Failed to load check-ins" });
  }
});

// Authenticated — list all check-ins for a project
router.get("/projects/:projectId/checkins", authenticate, async (req: Request, res: Response) => {
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

    res.json(checkins.map(serializeCheckin));
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load check-ins" });
  }
});

export default router;
