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
        // What they typed and why: the detail view can't rely on parsing the message.
        metadata: { projectId, workerName, companyName, reason },
        read: false,
      });
    }
  } catch {
    /* alerting is best-effort */
  }
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
    const timeStr = checkedInAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
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
    const timeStr = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
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
  const open = await openRowsForProject(projectId);
  const key = matchRegistered(await loadRegistered(projectId), workerName, companyName)?.key ?? null;
  const n = normText(workerName), c = normText(companyName);
  // Same registered person (by identity link) OR same typed name + company.
  return open.filter(r => (key && r.personKey === key) || (normText(r.workerName) === n && normText(r.companyName ?? "") === c));
}

// Count-only view of the "Currently on site" register (signed in, not signed out;
// legacy rows excluded) for the PUBLIC board. Deliberately no names.
async function countOnSite(projectId: string): Promise<number> {
  // Distinct PEOPLE: one identity (or, for older rows, one name+company) counts once.
  const [row] = await db.select({ n: sql<number>`count(distinct coalesce(${siteCheckinsTable.personKey}, lower(trim(${siteCheckinsTable.workerName})) || '|' || lower(trim(coalesce(${siteCheckinsTable.companyName}, '')))))::int` }).from(siteCheckinsTable).where(and(
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

// ---- Registered people for a project (who may check in) ---------------------
// Three record kinds can register someone: an in-house user (matched on name
// only), a subcontractor contact (name + company), a team person (name, plus
// company when they belong to a subcontractor). `key` is the identity used to
// group check-ins, so a contact card and its primary-contact person (which can
// carry slightly different names) count as ONE human.
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
  const users = await db.select({ id: usersTable.id, name: usersTable.name })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
    .where(eq(projectMembersTable.projectId, projectId));
  for (const u of users) out.push({ key: `user:${u.id}`, kind: "user", names: [u.name], company: null, companyRequired: false, insuranceSubId: null });

  const contacts = await db.select({ id: subcontractorsTable.id, contactName: subcontractorsTable.contactName, companyName: subcontractorsTable.companyName })
    .from(projectMembersTable)
    .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
    .where(eq(projectMembersTable.projectId, projectId));
  const subIds = [...new Set(contacts.map(c => c.id))];
  const primaries = subIds.length
    ? await db.select({ id: peopleTable.id, subId: peopleTable.subcontractorId, name: peopleTable.name })
        .from(peopleTable)
        .where(and(inArray(peopleTable.subcontractorId, subIds), eq(peopleTable.isPrimaryContact, true), isNull(peopleTable.archivedAt)))
    : [];
  const primaryBySub = new Map(primaries.map(p => [p.subId as string, p]));
  for (const c of contacts) {
    const prim = primaryBySub.get(c.id);
    // Accept the contact card's spelling AND its linked primary person's, and
    // key both to the person so they group as one human.
    out.push({ key: prim ? `person:${prim.id}` : `sub:${c.id}`, kind: "contact", names: [c.contactName, ...(prim ? [prim.name] : [])], company: c.companyName, companyRequired: true, insuranceSubId: c.id });
  }

  const people = await db.select({ id: peopleTable.id, name: peopleTable.name, subId: peopleTable.subcontractorId, subCompany: subcontractorsTable.companyName })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
    .leftJoin(subcontractorsTable, eq(subcontractorsTable.id, peopleTable.subcontractorId))
    .where(and(eq(projectMembersTable.projectId, projectId), isNull(peopleTable.archivedAt)));
  for (const p of people) out.push({ key: `person:${p.id}`, kind: "person", names: [p.name], company: p.subCompany ?? null, companyRequired: !!p.subCompany, insuranceSubId: p.subId ?? null });
  return out;
}

// Same rules the check-in has always used (users by name; contacts by name +
// company; people by name, + company when they belong to a firm), whitespace-
// and case-insensitive. Users win, then contacts, then people.
function matchRegistered(records: Registered[], typedName: string, typedCompany: string): Registered | null {
  const n = normText(typedName), c = normText(typedCompany);
  for (const kind of ["user", "contact", "person"] as const) {
    const hit = records.find(r => r.kind === kind && r.names.some(x => normText(x) === n) && (!r.companyRequired || normText(r.company ?? "") === c));
    if (hit) return hit;
  }
  return null;
}

// Close-but-not-exact registered people, for "Did you mean...?" at check-in.
// Only for 3+ typed letters; at most 3; the client always asks for a tap.
function nearRegistered(records: Registered[], typedName: string, typedCompany: string): { key: string; label: string; workerName: string; companyName: string }[] {
  const n = normText(typedName), c = normText(typedCompany);
  if (n.length < 3) return [];
  const scored: { r: Registered; name: string; score: number }[] = [];
  for (const r of records) {
    for (const nm of r.names) {
      const full = normText(nm);
      const tokens = full.split(" ");
      const nameClose = isClose(n, full) || tokens.some(t => t === n || (n.length >= 3 && t.startsWith(n))) || full.startsWith(n) || tokens.some(t => isClose(n, t));
      if (!nameClose) continue;
      const rc = normText(r.company ?? "");
      const companyFine = !c || !r.companyRequired || rc === c || isClose(c, rc) || rc.includes(c) || c.includes(rc);
      if (!companyFine) continue;
      scored.push({ r, name: nm, score: (full === n ? 0 : isClose(n, full) ? 1 : 2) + (rc === c ? 0 : 1) });
    }
  }
  const seen = new Set<string>();
  return scored.sort((a, b) => a.score - b.score).filter(x => (seen.has(x.r.key) ? false : (seen.add(x.r.key), true))).slice(0, 3).map(x => ({
    key: x.r.key,
    label: [x.name, x.r.company].filter(Boolean).join(", "),
    workerName: x.name,
    companyName: x.r.company ?? typedCompany.trim(),
  }));
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

    const typedKey = typedCompany && typedName.length >= 3 ? matchRegistered(await loadRegistered(qr.projectId), typedName, typedCompany)?.key ?? null : null;
    const exact = typedCompany ? open.find(r => (typedKey && r.personKey === typedKey) || (normText(r.workerName) === typedName && normText(r.companyName ?? "") === typedCompany)) : undefined;
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

// One person = one presence. Signing out closes the target row AND any other
// still-open row for the same person from the SAME London day (duplicates from
// earlier spelling variants), so the roll-call can't keep a ghost. Open rows
// from a PREVIOUS day are deliberately left flagged, never auto-closed.
async function openRowsToClose(projectId: string, target: OpenRow): Promise<OpenRow[]> {
  const day = londonDateStr(target.checkedInAt);
  const t = normText(target.workerName), c = normText(target.companyName ?? "");
  const all = await openRowsForProject(projectId);
  return all.filter(r => r.id === target.id || (
    londonDateStr(r.checkedInAt) === day &&
    ((target.personKey && r.personKey === target.personKey) || (normText(r.workerName) === t && normText(r.companyName ?? "") === c))
  ));
}

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
    const target = (await openRowsForProject(project[0].id)).find(r => r.id === req.params.id);
    if (!target) { res.status(409).json({ error: "not_signed_in", message: "Already signed out, or not found" }); return; }
    const toClose = await openRowsToClose(project[0].id, target);
    const now = new Date();
    const closed = await db.update(siteCheckinsTable)
      .set({ checkedOutAt: now, checkedOutBy: req.user!.id, checkoutNote: note.slice(0, 500), checkoutMethod: "manual" })
      .where(and(inArray(siteCheckinsTable.id, toClose.map(r => r.id)), eq(siteCheckinsTable.projectId, project[0].id), isNull(siteCheckinsTable.checkedOutAt)))
      .returning();
    const row = closed.find(r => r.id === target.id);
    if (!row) { res.status(409).json({ error: "not_signed_in", message: "Already signed out, or not found" }); return; }
    const managerName = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1))[0]?.name ?? "a manager";
    void notifySignedOut(project[0].id, row, now, { name: managerName, note });
    void logActivity({ userId: req.user!.id, projectId: project[0].id, companyId: project[0].companyId, section: "check-ins", action: "update", itemType: "site_checkin", itemId: row.id, metadata: { signedOut: row.workerName, note }, req });
    res.json(serializeCheckin(row));
  } catch (err) {
    req.log.error({ err }, "Manual sign-out error");
    res.status(500).json({ error: "server_error", message: "Failed to sign out" });
  }
});

// Public: at check-in, is what was typed a registered person? If not, close
// matches ("Did you mean...?") so a company/name typo is suggested, not just blocked.
router.get("/site/:token/register-match", async (req: Request, res: Response) => {
  try {
    const workerName = String(req.query.workerName ?? "");
    const companyName = String(req.query.companyName ?? "");
    const qr = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).then(r => r[0]);
    if (!qr) { res.status(404).json({ error: "not_found", message: "Invalid site token" }); return; }
    if (normText(workerName).length < 3) { res.json({ registered: false, suggestions: [] }); return; }
    const records = await loadRegistered(qr.projectId);
    if (matchRegistered(records, workerName, companyName)) { res.json({ registered: true, suggestions: [] }); return; }
    res.json({ registered: false, suggestions: nearRegistered(records, workerName, companyName).map(({ label, workerName: w, companyName: c }) => ({ label, workerName: w, companyName: c })) });
  } catch {
    res.status(500).json({ error: "server_error", message: "Failed to look up" });
  }
});

// Authenticated: the detail behind a check-in / check-in-blocked / sign-out
// notification (opened from the activity feed). Scoped to the notification's
// owner and their company.
router.get("/notifications/:notificationId/checkin", authenticate, async (req: Request, res: Response) => {
  try {
    const n = (await db.select().from(notificationsTable).where(and(eq(notificationsTable.id, req.params.notificationId), eq(notificationsTable.userId, req.user!.id))).limit(1))[0];
    if (!n || !["check_in", "check_in_blocked", "check_out"].includes(n.type)) { res.status(404).json({ error: "not_found", message: "Not found" }); return; }
    const meta = (n.metadata ?? {}) as { projectId?: string; workerName?: string; companyName?: string; reason?: string };
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
      checkin: checkin ? { ...serializeCheckin(checkin), photoUrl: checkin.photoUrl } : null,
    });
  } catch (err) {
    req.log.error({ err }, "Check-in notification detail error");
    res.status(500).json({ error: "server_error", message: "Failed to load" });
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

    // Who is this? Resolve against the project's registered people (users,
    // contacts, team people) with the same rules as ever, then remember WHICH
    // record matched so "Amy" and "Amy Parrish" can't become two people.
    const registered = await loadRegistered(qr.projectId);
    const match = matchRegistered(registered, workerName, companyName);

    // Already signed in today (by identity OR by typed text): don't create a
    // second open row; the client offers SIGN OUT instead. An open row from a
    // PREVIOUS day doesn't block: a new visit is a new row and the old one
    // stays flagged.
    const today = londonDateStr(new Date());
    const alreadyOpen = (await openCheckinsFor(qr.projectId, workerName, companyName))
      .find(c => londonDateStr(c.checkedInAt) === today);
    if (alreadyOpen) {
      res.status(409).json({ error: "already_signed_in", checkinId: alreadyOpen.id, checkedInAt: alreadyOpen.checkedInAt.toISOString() });
      return;
    }

    if (!match) {
      // Not registered as typed: block, but offer close matches ("Did you mean?").
      await notifyBlockedCheckin(qr.projectId, workerName.trim(), companyName.trim(), "not_registered");
      res.status(403).json({ error: "check_in_blocked", reason: "not_registered", suggestions: nearRegistered(registered, workerName, companyName) });
      return;
    }

    if (match.insuranceSubId) {
      // Same source the Contacts directory's "Insurance OK" badge reads
      // (company-level insurance_records PLUS any filed insurance-named
      // person certification) so a contact shown as insured on their card
      // must pass here too. "expiring_soon" still passes (not yet expired);
      // only "expired" or "none" blocks.
      const project = await db.select({ companyId: projectsTable.companyId }).from(projectsTable)
        .where(eq(projectsTable.id, qr.projectId)).limit(1);
      const status = project[0] ? await subcontractorInsuranceStatus(match.insuranceSubId, project[0].companyId) : "none";

      if (status === "expired" || status === "none") {
        await notifyBlockedCheckin(qr.projectId, workerName.trim(), companyName.trim(), "no_valid_insurance");
        res.status(403).json({ error: "check_in_blocked", reason: "no_valid_insurance" });
        return;
      }
    }

    // Store the registered record's own spelling so every visit reads the same.
    const storedName = match.names.find(n => normText(n) === normText(workerName)) ?? workerName.trim();
    const storedCompany = match.company ?? companyName.trim();

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
      workerName: storedName,
      companyName: storedCompany,
      personKey: match.key,
      photoUrl,
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
    }).returning();

    // Fire-and-forget: the worker's check-in must not wait on (or fail with)
    // the notification fan-out.
    void notifySuccessfulCheckin(qr.projectId, storedName, storedCompany, checkin.checkedInAt, checkin.id);

    res.status(201).json({ ...serializeCheckin(checkin), deviceToken: signDeviceToken(qr.projectId, storedName, storedCompany) });
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
        personKey: siteCheckinsTable.personKey,
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
