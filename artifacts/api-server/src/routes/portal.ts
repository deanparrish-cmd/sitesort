import { Router, type IRouter } from "express";
import multer from "multer";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable, projectsTable, projectMembersTable, projectInvitesTable,
  documentsTable, photosTable, permitsTable, milestonesTable, dailyNotesTable,
  qrBoardPinsTable, calendarEventsTable, subcontractorsTable, peopleTable,
  portalSharesTable, documentDistributionsTable, companiesTable, qrCodesTable,
  portalMemberDocumentsTable, notificationsTable, companyMembersTable,
  plantItemsTable, plantItemAttachmentsTable, plantItemDistributionsTable, personCertificationsTable, dailyReportsTable,
  messagesTable, channelMessagesTable, acknowledgmentAuditTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, isNotNull, desc, asc, gte, lt, count, max, or, ne } from "drizzle-orm";
import { buildSiteBoardPayload } from "../lib/site-board";
import { generateId } from "../lib/id";
import { logActivity } from "../lib/activity";
import { authenticate, generatePortalToken } from "../middlewares/auth";
import { requirePortalMember, requirePortalSession, autoLogPortalActivity, requirePortalPermission } from "../middlewares/portal";
import { createPortalSession, revokePortalSession } from "../lib/portal-sessions";
import { getVapidPublicKey } from "../lib/web-push";
import { pushSubscriptionsTable, activityLogTable } from "@workspace/db/schema";
import { PortalPushSubscribeBody, PortalPushUnsubscribeBody } from "@workspace/api-zod";
import { isLockedOut, recordFailedAttempt, clearAttempts } from "../lib/login-attempts";
import { pinRequiredForDoc } from "../lib/signoff";
import { expiryStatus } from "../lib/expiry";
import { issueCategoryFilter } from "../lib/accountability";
import { canonicalPersonName } from "../lib/person-name";
import { PORTAL_SECTIONS } from "../lib/activity";
import { PortalLoginBody, AcceptPortalInviteBody } from "@workspace/api-zod";
import { getBucket, objectKey } from "../lib/gcs";
import { memberUploadSingle, saveMemberUpload } from "../lib/portal-upload";
import { isReportLocked, upsertManagerReport, contributorsForReport, hasManagerContent, londonDateStr } from "../lib/daily-reports";
import { notesFor, addNote } from "../lib/portal-submission-notes";
import { isPinLockedOut, recordFailedPinAttempt, clearPinAttempts } from "../lib/pin-attempts";
import { setUserPin } from "../lib/pin";
import { requestCredentialReset, consumeCredentialResetToken } from "../lib/credential-reset";
import { transcribeAudio } from "../lib/transcribe";
import { completePasswordReset } from "../lib/credential-reset-complete";
import { createRequire } from "module";
import type { Archiver, ArchiverOptions } from "archiver";
const nodeRequire = createRequire(import.meta.url);
const archiver = nodeRequire("archiver") as (format: string, options?: ArchiverOptions) => Archiver;

const router: IRouter = Router();

// The middleware chain every read-only member endpoint runs: verify the portal
// token → enforce the server-side session (sliding 30d / 12h inactivity / revoke)
// → re-check membership → auto-log the view. No per-page manual logging anywhere.
// Exported so routes/portal-messages.ts uses this SAME chain, not a second copy.
export const portalGuards = [authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity];

// Only the token HASH is ever stored, so a DB leak can't be replayed.
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

// A stored doc.fileUrl is "/api/uploads/<filename>" or legacy "/uploads/<filename>".
// Pull the bare filename out so it can be resolved to an object storage key.
function fileUrlToFilename(fileUrl: string): string | null {
  const m = fileUrl.match(/\/uploads\/([^/?#]+)$/);
  return m ? m[1] : null;
}

// Follow the supersede chain forward from a superseded doc to its live
// replacement: the next doc is the one whose previousVersionId points at the
// current id. Walk until a `current` doc (or a dead end), capped at 10 hops to
// avoid a cycle ever looping forever.
async function resolveReplacement(projectId: string, supersededId: string) {
  let currentId = supersededId;
  for (let i = 0; i < 10; i++) {
    const next = (await db.select().from(documentsTable)
      .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.previousVersionId, currentId)))
      .limit(1))[0];
    if (!next) return null;
    if (next.status === "current") return next;
    currentId = next.id;
  }
  return null;
}

// ---- serializers (shape-match the OpenAPI Portal* schemas) ----
function serializeDoc(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id, name: d.name, type: d.type, version: d.version,
    revision: d.revision ?? undefined, fileUrl: d.fileUrl, fileSize: d.fileSize,
    status: d.status, createdAt: d.createdAt.toISOString(),
    requiresAcknowledgment: d.requiresAcknowledgment,
    pinRequired: pinRequiredForDoc(d),
  };
}
// This viewer's own sign-off status for a batch of documents — merged onto
// serializeDoc's output wherever a member might need to sign off (the PIN
// gate itself is re-checked server-side regardless of what the client saw).
async function myDocStatuses(userId: string, docIds: string[]): Promise<Map<string, { status: string; acknowledgedAt: Date | null }>> {
  if (docIds.length === 0) return new Map();
  const rows = await db.select({
    documentId: documentDistributionsTable.documentId,
    status: documentDistributionsTable.status,
    acknowledgedAt: documentDistributionsTable.acknowledgedAt,
  }).from(documentDistributionsTable)
    .where(and(inArray(documentDistributionsTable.documentId, docIds), eq(documentDistributionsTable.userId, userId)));
  return new Map(rows.map(r => [r.documentId, { status: r.status, acknowledgedAt: r.acknowledgedAt }]));
}
function withMyStatus<T extends { id: string }>(rows: T[], statuses: Map<string, { status: string; acknowledgedAt: Date | null }>): (T & { myStatus: string | null; mySignedOffAt: string | null })[] {
  return rows.map(r => {
    const mine = statuses.get(r.id);
    return { ...r, myStatus: mine?.status ?? null, mySignedOffAt: mine?.acknowledgedAt?.toISOString() ?? null };
  });
}
function serializePermit(p: typeof permitsTable.$inferSelect) {
  return {
    id: p.id, type: p.type, description: p.description,
    startDate: p.startDate, expiryDate: p.expiryDate,
    status: expiryStatus(p.expiryDate), documentUrl: p.documentUrl ?? undefined,
  };
}
async function serializeIssue(p: typeof photosTable.$inferSelect, reporterName?: string | null) {
  const submittedByName = p.submittedBy ? await nameForPortalUser(p.submittedBy) : undefined;
  const notes = await notesFor("site_issue", p.id);
  return {
    id: p.id, category: p.category, description: p.description ?? undefined,
    zone: p.zone ?? undefined, referenceNumber: p.referenceNumber,
    status: p.status ?? undefined, photoUrl: p.photoUrl ?? undefined,
    takenAt: p.takenAt.toISOString(),
    latitude: p.latitude ?? undefined, longitude: p.longitude ?? undefined,
    // Never exposes share/audience data — only what the reporting/assigned
    // member themselves need to track their own issue.
    assignedToUserId: p.assignedToUserId ?? undefined,
    reporterName: reporterName ?? undefined,
    closureReason: p.closureReason ?? undefined,
    // Portal save-vs-submit lifecycle (Feature).
    submittedAt: p.submittedAt ? p.submittedAt.toISOString() : undefined,
    submittedByName,
    lifecycleStatus: p.submittedAt ? "submitted" : "draft",
    notes,
  };
}
async function nameForPortalUser(userId: string): Promise<string | undefined> {
  const rows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0]?.name ?? undefined;
}

async function computeProgress(projectId: string): Promise<number> {
  const rows = await db.select({ completedAt: milestonesTable.completedAt })
    .from(milestonesTable).where(eq(milestonesTable.projectId, projectId));
  if (rows.length === 0) return 0;
  const done = rows.filter(r => r.completedAt !== null).length;
  return Math.round((done / rows.length) * 100);
}

function serializeProject(p: typeof projectsTable.$inferSelect, progressPercent: number) {
  return {
    id: p.id, name: p.name, address: p.address, status: p.status,
    startDate: p.startDate ?? undefined, targetEndDate: p.targetEndDate ?? undefined,
    trades: p.trades ?? [], progressPercent,
  };
}

async function loadProject(projectId: string) {
  const rows = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  return rows[0] ?? null;
}

// ---- gated portal visibility (Team Portal sharing) ----
// A portal member sees ONLY items shared with them (via 'all' / their trade /
// them personally), EXCEPT `safety`-type documents which are always open. The
// portal NEVER exposes who else an item was shared with.
const SITE_STAFF = "Site Staff";
type Viewer = { personId: string | null; trades: string[]; isSiteStaff: boolean };

async function resolveViewer(userId: string, projectId: string): Promise<Viewer> {
  const rows = await db.select({ personId: projectMembersTable.personId, trades: subcontractorsTable.trades })
    .from(projectMembersTable)
    .leftJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
    .leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId), isNotNull(projectMembersTable.personId)))
    .limit(1);
  const trades = (rows[0]?.trades ?? []) as string[];
  return { personId: (rows[0]?.personId ?? null) as string | null, trades, isSiteStaff: trades.length === 0 };
}

// Ids of a given item type visible to this viewer, resolved from share rules at
// read time (so trade/all shares automatically include members invited later).
async function visibleIds(projectId: string, itemType: string, viewer: Viewer): Promise<Set<string>> {
  const shares = await db.select().from(portalSharesTable)
    .where(and(eq(portalSharesTable.projectId, projectId), eq(portalSharesTable.itemType, itemType)));
  const set = new Set<string>();
  for (const s of shares) {
    if (s.audienceType === "all") set.add(s.itemId);
    else if (s.audienceType === "person" && viewer.personId && s.personId === viewer.personId) set.add(s.itemId);
    else if (s.audienceType === "trade" && s.trade && (viewer.trades.includes(s.trade) || (viewer.isSiteStaff && s.trade === SITE_STAFF))) set.add(s.itemId);
  }
  return set;
}

// Safety docs bypass sharing entirely (always visible); everything else is
// gated on an explicit portal_shares rule. Used by the doc-scoped write routes
// (view/acknowledge) that don't go through docListHandler/docDetailHandler.
async function isDocVisibleToViewer(pid: string, userId: string, doc: { id: string; type: string }): Promise<boolean> {
  if (doc.type === "safety") return true;
  const viewer = await resolveViewer(userId, pid);
  const ids = await visibleIds(pid, "document", viewer);
  return ids.has(doc.id);
}

// Like visibleIds, but maps each visible item to the MOST RECENT matching share
// time — the "shared with me at" timestamp used for unseen-since detection and
// newest-first ordering.
async function visibleShareMap(projectId: string, itemType: string, viewer: Viewer): Promise<Map<string, Date>> {
  const shares = await db.select().from(portalSharesTable)
    .where(and(eq(portalSharesTable.projectId, projectId), eq(portalSharesTable.itemType, itemType)));
  const map = new Map<string, Date>();
  for (const s of shares) {
    const matches = s.audienceType === "all"
      || (s.audienceType === "person" && viewer.personId && s.personId === viewer.personId)
      || (s.audienceType === "trade" && !!s.trade && (viewer.trades.includes(s.trade) || (viewer.isSiteStaff && s.trade === SITE_STAFF)));
    if (!matches) continue;
    const prev = map.get(s.itemId);
    if (!prev || s.createdAt > prev) map.set(s.itemId, s.createdAt);
  }
  return map;
}

// When did this member last VIEW each section? Reuses the existing portal
// activity-log view tracking (one row per section-open). Returns a map keyed by
// section; a section absent from the map has never been viewed (→ all unseen).
async function lastViewedBySection(userId: string, projectId: string): Promise<Map<string, Date>> {
  const rows = await db.select({ section: activityLogTable.section, t: max(activityLogTable.createdAt) })
    .from(activityLogTable)
    .where(and(eq(activityLogTable.userId, userId), eq(activityLogTable.projectId, projectId), eq(activityLogTable.action, "view")))
    .groupBy(activityLogTable.section);
  const m = new Map<string, Date>();
  for (const r of rows) if (r.t) m.set(r.section, r.t as unknown as Date);
  return m;
}

const isAfter = (d: Date | null | undefined, since: Date | undefined): boolean => !!d && (!since || d > since);

// Per-section unseen counts for the member's nav badges. "Unseen" = content
// whose share/create time is newer than the member's last view of that section.
async function computeUnseen(userId: string, projectId: string): Promise<{ counts: Record<string, number>; total: number }> {
  const viewer = await resolveViewer(userId, projectId);
  const [docMap, photoMap, permitMap, lastView, permRow] = await Promise.all([
    visibleShareMap(projectId, "document", viewer),
    visibleShareMap(projectId, "photo", viewer),
    visibleShareMap(projectId, "permit", viewer),
    lastViewedBySection(userId, projectId),
    db.select({
      canLogIssues: projectMembersTable.canLogIssues,
      canUpdatePlantMaterials: projectMembersTable.canUpdatePlantMaterials,
    }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId))).limit(1),
  ]);
  const canLogIssues = permRow[0]?.canLogIssues ?? false;
  const canUpdatePlantMaterials = permRow[0]?.canUpdatePlantMaterials ?? false;
  const lv = (s: string) => lastView.get(s);
  const counts: Record<string, number> = {};
  const bump = (s: string, n = 1) => { if (n) counts[s] = (counts[s] ?? 0) + n; };

  // Gated documents, by type → their (retired) section keys — harmless now that
  // no nav item reads them, kept only for the aggregate "shared" bump below.
  const docIds = [...docMap.keys()];
  const docs = docIds.length
    ? await db.select({ id: documentsTable.id, type: documentsTable.type }).from(documentsTable)
        .where(and(eq(documentsTable.projectId, projectId), inArray(documentsTable.id, docIds), inArray(documentsTable.status, ["current", "superseded"])))
    : [];
  let sharedCount = 0;
  for (const d of docs) {
    const at = docMap.get(d.id);
    if (isAfter(at, lv("shared"))) sharedCount++;
  }
  // Site issues only count toward "Shared with me" (and never leak a count at
  // all) when the viewer actually has that section's grant — otherwise the nav
  // badge itself would tip off gated content they can't open.
  if (canLogIssues) {
    for (const at of photoMap.values()) { if (isAfter(at, lv("shared"))) sharedCount++; if (isAfter(at, lv("site-issues"))) bump("site-issues"); }
  }
  for (const at of permitMap.values()) { if (isAfter(at, lv("shared"))) sharedCount++; }
  // Plant & Materials is its own gated section, not a shared-document type
  // (see the sharing-bug fix above) — its badge counts every project plant
  // item's latest activity, not a portal_shares timestamp.
  if (canUpdatePlantMaterials) {
    // Submission privacy: badge only counts items this member can actually
    // see (own createdBy or distributed to them) — counting the PM's private
    // items would leak their existence via the badge number.
    const plantItems = await db.select({ id: plantItemsTable.id, createdBy: plantItemsTable.createdBy, createdAt: plantItemsTable.createdAt, lastUpdatedAt: plantItemsTable.lastUpdatedAt })
      .from(plantItemsTable).where(eq(plantItemsTable.projectId, projectId));
    const otherIds = plantItems.filter(p => p.createdBy !== userId).map(p => p.id);
    const sharedIds = otherIds.length
      ? new Set((await db.select({ plantItemId: plantItemDistributionsTable.plantItemId }).from(plantItemDistributionsTable)
          .where(and(eq(plantItemDistributionsTable.userId, userId), inArray(plantItemDistributionsTable.plantItemId, otherIds)))).map(d => d.plantItemId))
      : new Set<string>();
    for (const p of plantItems) {
      if (p.createdBy !== userId && !sharedIds.has(p.id)) continue;
      const at = p.lastUpdatedAt ?? p.createdAt;
      if (isAfter(at, lv("plant-materials"))) bump("plant-materials");
    }
  }

  // Safety docs are always visible (never gated) → new ones count toward
  // "Shared with me" too, since that's now the only place they surface.
  const safetyDocs = await db.select({ createdAt: documentsTable.createdAt }).from(documentsTable)
    .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.type, "safety"), eq(documentsTable.status, "current")));
  for (const s of safetyDocs) if (isAfter(s.createdAt, lv("shared"))) sharedCount++;
  bump("shared", sharedCount);

  // Site updates (daily notes) drive Overview + General badges.
  const notes = await db.select({ createdAt: dailyNotesTable.createdAt }).from(dailyNotesTable).where(eq(dailyNotesTable.projectId, projectId));
  for (const n of notes) { if (isAfter(n.createdAt, lv("overview"))) bump("overview"); if (isAfter(n.createdAt, lv("general"))) bump("general"); }

  // Messages: unseen = DMs received (not sent by me) + channel posts not
  // authored by me, newer than my last view of the Messages section. Not fed
  // into the "shared" aggregate — messages aren't gated/shared content.
  const [dmRows, channelRows] = await Promise.all([
    db.select({ createdAt: messagesTable.createdAt }).from(messagesTable)
      .where(and(eq(messagesTable.projectId, projectId), eq(messagesTable.recipientId, userId))),
    db.select({ createdAt: channelMessagesTable.createdAt }).from(channelMessagesTable)
      .where(and(eq(channelMessagesTable.projectId, projectId), ne(channelMessagesTable.senderId, userId))),
  ]);
  for (const m of dmRows) if (isAfter(m.createdAt, lv("messages"))) bump("messages");
  for (const m of channelRows) if (isAfter(m.createdAt, lv("messages"))) bump("messages");

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}

// Register a portal member's view of a shared document in distribution tracking
// (best-effort): create the row lazily for members reached via a rule, and flip
// pending → viewed. The PM dashboard reads these counts.
async function recordDocView(documentId: string, userId: string): Promise<void> {
  try {
    const existing = await db.select({ id: documentDistributionsTable.id, status: documentDistributionsTable.status })
      .from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, documentId), eq(documentDistributionsTable.userId, userId))).limit(1);
    if (existing.length === 0) {
      await db.insert(documentDistributionsTable).values({ id: generateId(), documentId, userId, status: "viewed", viewedAt: new Date() });
    } else if (existing[0].status === "pending") {
      await db.update(documentDistributionsTable).set({ status: "viewed", viewedAt: new Date() }).where(eq(documentDistributionsTable.id, existing[0].id));
    }
  } catch { /* tracking is best-effort */ }
}

// ==========================================================================
// PUBLIC — member onboarding + login (no auth; separate from the PM /auth/*)
// ==========================================================================

// POST /api/portal/login — email + password → a portal-scoped token locked to
// ONE project. Rejects full dashboard accounts (portalOnly gate). If the member
// belongs to several projects and none is chosen, returns the list to pick from
// (a login-time choice, NOT an in-portal switcher).
router.post("/portal/login", async (req, res) => {
  try {
    const parsed = PortalLoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: "Email and password are required." });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const { password, projectId: chosenProjectId } = parsed.data;

    if (await isLockedOut(email)) {
      res.status(429).json({ error: "too_many_attempts", message: "Locked due to too many failed attempts. Try again in 15 minutes." });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (users.length === 0) {
      await recordFailedAttempt(email);
      res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
      return;
    }
    const user = users[0];
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const { locked, remaining } = await recordFailedAttempt(email);
      if (locked) res.status(429).json({ error: "too_many_attempts", message: "Locked due to too many failed attempts. Try again in 15 minutes." });
      else res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password", attemptsRemaining: remaining });
      return;
    }
    await clearAttempts(email);

    // Portal access is an explicit grant: a project_members row with person_id set.
    // This works for BOTH a portalOnly account (created via an invite link) and an
    // in-house team member using their existing dashboard login — the difference is
    // just whether they also have dashboard access, which is a superset, not a leak.
    // A dashboard account with no portal grant is nudged back to the main login.
    const memberships = await db
      .select({ projectId: projectMembersTable.projectId, role: projectMembersTable.role, name: projectsTable.name })
      .from(projectMembersTable)
      .innerJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
      .where(and(eq(projectMembersTable.userId, user.id), isNotNull(projectMembersTable.personId)));

    if (memberships.length === 0) {
      if (user.portalOnly) {
        res.status(403).json({ error: "no_projects", message: "You haven't been added to any project yet. Ask your project manager for an invite." });
      } else {
        res.status(403).json({ error: "use_dashboard", message: "This is a full SiteSort account — please use the main login." });
      }
      return;
    }

    let target = memberships[0];
    if (chosenProjectId) {
      const found = memberships.find(m => m.projectId === chosenProjectId);
      if (!found) {
        res.status(403).json({ error: "forbidden", message: "You are not a member of that project." });
        return;
      }
      target = found;
    } else if (memberships.length > 1) {
      res.json({ requiresProjectChoice: true, projects: memberships.map(m => ({ id: m.projectId, name: m.name })) });
      return;
    }

    await db.update(usersTable).set({ lastActiveAt: new Date() }).where(eq(usersTable.id, user.id));
    const sid = await createPortalSession(user.id, target.projectId);
    const token = generatePortalToken({ id: user.id, email: user.email, companyId: user.companyId, projectId: target.projectId, role: target.role, sid });
    res.json({
      requiresProjectChoice: false,
      token,
      project: { id: target.projectId, name: target.name },
      member: { name: user.name, role: target.role, email: user.email },
    });
  } catch (err) {
    req.log.error({ err }, "Portal login error");
    res.status(500).json({ error: "server_error", message: "Login failed" });
  }
});

// POST /api/portal/forgot-password — public. Same shared reset backbone as the
// main app (a portal member is the same users row underneath); "portal" context
// only changes the email's link target and copy. Generic response — never
// reveals whether the email is registered.
router.post("/portal/forgot-password", async (req, res) => {
  try {
    const { email: rawEmail } = req.body ?? {};
    if (!rawEmail) {
      res.status(400).json({ error: "validation_error", message: "Email required" });
      return;
    }
    const { limited } = await requestCredentialReset({
      email: String(rawEmail), kind: "password", context: "portal", req,
    });
    if (limited) {
      res.status(429).json({ error: "rate_limited", message: "Too many reset requests. Please try again later." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Portal forgot password error");
    res.status(500).json({ error: "server_error", message: "Failed to process request" });
  }
});

// POST /api/portal/reset-password — public. Consumes a single-use token and
// sets the new password; all existing sessions (portal + dashboard) are
// invalidated by completePasswordReset.
router.post("/portal/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
      res.status(400).json({ error: "validation_error", message: "Token and password required" });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: "validation_error", message: "Password must be at least 8 characters" });
      return;
    }
    const consumed = await consumeCredentialResetToken(String(token), "password");
    if (!consumed.ok) {
      if (consumed.reason === "expired") {
        res.status(400).json({ error: "token_expired", message: "This reset link has expired. Please request a new one." });
      } else {
        res.status(400).json({ error: "invalid_token", message: "This reset link is invalid or has already been used. Please request a new one." });
      }
      return;
    }
    await completePasswordReset(consumed.userId, String(password), req);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Portal reset password error");
    res.status(500).json({ error: "server_error", message: "Failed to reset password" });
  }
});

// GET /api/portal/invite/:token — validate a single-use invite link.
router.get("/portal/invite/:token", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: projectInvitesTable.id, name: projectInvitesTable.name, email: projectInvitesTable.email,
        status: projectInvitesTable.status, expiresAt: projectInvitesTable.expiresAt,
        projectName: projectsTable.name,
      })
      .from(projectInvitesTable)
      .innerJoin(projectsTable, eq(projectInvitesTable.projectId, projectsTable.id))
      .where(eq(projectInvitesTable.tokenHash, hashToken(req.params.token)))
      .limit(1);
    const inv = rows[0];
    if (!inv) { res.status(410).json({ error: "invalid_invite", message: "This invite link is not valid." }); return; }
    if (inv.status !== "pending") { res.status(410).json({ error: "invite_used", message: "This invite has already been used or revoked." }); return; }
    if (inv.expiresAt.getTime() < Date.now()) { res.status(410).json({ error: "invite_expired", message: "This invite link has expired." }); return; }
    // Does this email already have a full (dashboard) SiteSort account? If so, the
    // accept flow attaches portal access to it instead of asking for a new password.
    const acct = (await db.select({ portalOnly: usersTable.portalOnly }).from(usersTable)
      .where(eq(usersTable.email, inv.email.trim().toLowerCase())).limit(1))[0];
    const existingAccount = !!acct && !acct.portalOnly;
    res.json({ valid: true, name: inv.name, email: inv.email, projectName: inv.projectName, expiresAt: inv.expiresAt.toISOString(), existingAccount });
  } catch (err) {
    req.log.error({ err }, "Get portal invite error");
    res.status(500).json({ error: "server_error", message: "Failed to load invite" });
  }
});

// POST /api/portal/invite/:token/accept — enter the portal. New/portal-only
// invitees set a password here. An invitee whose email ALREADY has a full SiteSort
// account (this or another company) joins with their EXISTING login — no password
// is required or changed; the valid single-use invite token is the authorisation.
router.post("/portal/invite/:token/accept", async (req, res) => {
  try {
    const invRows = await db.select().from(projectInvitesTable)
      .where(eq(projectInvitesTable.tokenHash, hashToken(req.params.token))).limit(1);
    const inv = invRows[0];
    if (!inv) { res.status(410).json({ error: "invalid_invite", message: "This invite link is not valid." }); return; }
    if (inv.status !== "pending") { res.status(410).json({ error: "invite_used", message: "This invite has already been used or revoked." }); return; }
    if (inv.expiresAt.getTime() < Date.now()) { res.status(410).json({ error: "invite_expired", message: "This invite link has expired." }); return; }

    const email = inv.email.trim().toLowerCase();
    const existing = (await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1))[0];

    // A password is required ONLY when we're creating or (re)securing a portal-only
    // account. An existing dashboard account keeps its own password untouched.
    const needsPassword = !existing || existing.portalOnly;
    const parsed = AcceptPortalInviteBody.safeParse(req.body);
    const password = parsed.success ? String(parsed.data.password ?? "") : "";
    if (needsPassword && password.length < 8) {
      res.status(400).json({ error: "validation_error", message: "A password of at least 8 characters is required." });
      return;
    }

    let userId: string;
    let userName: string;
    let userCompanyId: string;
    // For an existing FULL account we only GRANT access here — we never issue a
    // session without a password check (that would let anyone holding the link in
    // as that account). They authenticate at /portal/login with their own password.
    let grantOnly = false;
    if (!existing) {
      userId = generateId();
      userName = inv.name;
      userCompanyId = inv.companyId;
      await db.insert(usersTable).values({
        id: userId, companyId: inv.companyId, email, passwordHash: await bcrypt.hash(password, 10), name: inv.name,
        role: "site_worker", emailVerified: true, portalOnly: true,
      });
    } else if (existing.portalOnly) {
      userId = existing.id; userName = existing.name; userCompanyId = existing.companyId;
      await db.update(usersTable).set({ passwordHash: await bcrypt.hash(password, 10) }).where(eq(usersTable.id, existing.id));
    } else {
      // Existing full account — attach portal access, DO NOT touch their password
      // and DO NOT auto-authenticate. They sign in with their own credentials.
      userId = existing.id; userName = existing.name; userCompanyId = existing.companyId;
      grantOnly = true;
    }

    // Link the individual person to their account so per-person portal status resolves.
    if (inv.personId) {
      await db.update(peopleTable).set({ userId }).where(eq(peopleTable.id, inv.personId));
    }

    // Membership (user ↔ project) carrying the person link. The person is
    // already a project team member by the time they can be invited (that's
    // how their card exists to invite from — the person-first add flow), so
    // their project_members row already exists here too, keyed by personId
    // with no userId yet. Match on personId (not just the brand-new userId,
    // which can never match an existing row) so accepting UPDATES that row in
    // place — preserving any section permissions a PM already granted while
    // the invite was pending — instead of inserting a second, duplicate row.
    const existingMember = (await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
      .where(and(
        eq(projectMembersTable.projectId, inv.projectId),
        inv.personId ? or(eq(projectMembersTable.userId, userId), eq(projectMembersTable.personId, inv.personId)) : eq(projectMembersTable.userId, userId),
      )).limit(1))[0];
    if (existingMember) {
      await db.update(projectMembersTable).set({ personId: inv.personId ?? null, userId }).where(eq(projectMembersTable.id, existingMember.id));
    } else {
      await db.insert(projectMembersTable)
        .values({ id: generateId(), projectId: inv.projectId, userId, personId: inv.personId ?? null, role: inv.role })
        .onConflictDoNothing();
    }

    await db.update(projectInvitesTable)
      .set({ status: "accepted", acceptedUserId: userId, acceptedAt: new Date() })
      .where(eq(projectInvitesTable.id, inv.id));

    const proj = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, inv.projectId)).limit(1);
    // Existing account: access granted, but they must sign in with their own
    // password — no token issued here.
    if (grantOnly) {
      res.json({
        requiresProjectChoice: false,
        requiresLogin: true,
        project: { id: inv.projectId, name: proj[0]?.name ?? "" },
        member: { name: userName, role: inv.role, email },
      });
      return;
    }
    const sid = await createPortalSession(userId, inv.projectId);
    const token = generatePortalToken({ id: userId, email, companyId: userCompanyId, projectId: inv.projectId, role: inv.role, sid });
    res.json({
      requiresProjectChoice: false,
      token,
      project: { id: inv.projectId, name: proj[0]?.name ?? "" },
      member: { name: userName, role: inv.role, email },
    });
  } catch (err) {
    req.log.error({ err }, "Accept portal invite error");
    res.status(500).json({ error: "server_error", message: "Failed to accept invite" });
  }
});

// ==========================================================================
// MEMBER SECTIONS — read-only, portal-scoped, auto-logged
// ==========================================================================

// GET /api/portal/me — shell context (project + member + allowed sections).
router.get("/portal/me", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const proj = await loadProject(pid);
  if (!proj) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
  const urow = await db.select({ name: usersTable.name, pinHash: usersTable.pinHash }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  const permRow = await db.select({
    canLogIssues: projectMembersTable.canLogIssues,
    canUpdatePlantMaterials: projectMembersTable.canUpdatePlantMaterials,
    canEditDailyReport: projectMembersTable.canEditDailyReport,
  }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.userId, req.user!.id)))
    .limit(1);
  res.json({
    project: serializeProject(proj, await computeProgress(pid)),
    member: {
      userId: req.user!.id,
      name: urow[0]?.name ?? "",
      role: req.portalMemberRole ?? "worker",
      email: req.user!.email,
      canLogIssues: permRow[0]?.canLogIssues ?? false,
      canUpdatePlantMaterials: permRow[0]?.canUpdatePlantMaterials ?? false,
      canEditDailyReport: permRow[0]?.canEditDailyReport ?? false,
      hasPin: !!urow[0]?.pinHash,
    },
    sections: PORTAL_SECTIONS,
  });
});

// POST /api/portal/pin — set/update/reset the signed-in member's sign-off PIN.
// Same password-reverification + audit-log pattern as /auth/pin (dashboard);
// portal members are usersTable rows too, so the underlying logic is identical.
router.post("/portal/pin", ...portalGuards, async (req, res) => {
  try {
    const { currentPassword, pin } = req.body ?? {};
    const result = await setUserPin(req.user!.id, currentPassword, pin, req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, message: result.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Portal set PIN error");
    res.status(500).json({ error: "server_error", message: "Failed to set PIN" });
  }
});

// POST /api/portal/logout — end THIS session server-side (revoked, not just a
// client-side token clear). Idempotent. Uses only authenticate+session so a
// still-valid session can always sign itself out.
router.post("/portal/logout", authenticate, requirePortalSession, async (req, res) => {
  if (req.user?.sid) await revokePortalSession(req.user.sid);
  res.json({ success: true });
});

// GET /api/portal/unseen — per-section badge counts (unseen since last view).
router.get("/portal/unseen", ...portalGuards, async (req, res) => {
  try {
    const result = await computeUnseen(req.user!.id, req.portalProjectId!);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Portal unseen error");
    res.json({ counts: {}, total: 0 });
  }
});

// GET /api/portal/push/public-key — VAPID public key for this deployment (null
// if push isn't configured; the client hides the enable UI in that case).
router.get("/portal/push/public-key", authenticate, requirePortalSession, requirePortalMember, async (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// POST /api/portal/push/subscribe — register (or refresh) this device's push
// subscription for the signed-in member. Keyed on the unique endpoint.
router.post("/portal/push/subscribe", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  const parsed = PortalPushSubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid subscription." }); return; }
  const { endpoint, keys, userAgent } = parsed.data;
  try {
    const existing = (await db.select({ id: pushSubscriptionsTable.id }).from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint)).limit(1))[0];
    if (existing) {
      await db.update(pushSubscriptionsTable)
        .set({ userId: req.user!.id, projectId: req.portalProjectId!, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, lastSeenAt: new Date() })
        .where(eq(pushSubscriptionsTable.id, existing.id));
    } else {
      await db.insert(pushSubscriptionsTable).values({
        id: generateId(), userId: req.user!.id, projectId: req.portalProjectId!,
        endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null,
      });
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Portal push subscribe error");
    res.status(500).json({ error: "server_error", message: "Failed to subscribe" });
  }
});

// POST /api/portal/push/unsubscribe — remove a device's subscription (settings
// toggle-off or logout). Scoped to the member so one can't delete another's.
router.post("/portal/push/unsubscribe", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  const parsed = PortalPushUnsubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid request." }); return; }
  try {
    await db.delete(pushSubscriptionsTable).where(and(
      eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
      eq(pushSubscriptionsTable.userId, req.user!.id),
    ));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Portal push unsubscribe error");
    res.status(500).json({ error: "server_error", message: "Failed to unsubscribe" });
  }
});

// GET /api/portal/overview
router.get("/portal/overview", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const proj = await loadProject(pid);
  if (!proj) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
  // The Open Issues + Active Permits stats deep-link into GATED sections, so their
  // counts must only include what this member is allowed to see (shared items).
  // Open Issues additionally requires the canLogIssues section grant — with no
  // grant the count is forced to 0 server-side, not just hidden client-side,
  // since the raw number would otherwise leak the section's existence.
  const viewer = await resolveViewer(req.user!.id, pid);
  const [photoVisible, permitVisible, permRow] = await Promise.all([
    visibleIds(pid, "photo", viewer),
    visibleIds(pid, "permit", viewer),
    db.select({ canLogIssues: projectMembersTable.canLogIssues }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.userId, req.user!.id))).limit(1),
  ]);
  const canLogIssues = permRow[0]?.canLogIssues ?? false;
  const [openIssueRows, permitRows, milestonesRows, teamRows, notes] = await Promise.all([
    canLogIssues && photoVisible.size ? db.select({ id: photosTable.id }).from(photosTable).where(and(
      eq(photosTable.projectId, pid),
      issueCategoryFilter(),
      inArray(photosTable.status, ["open", "in_progress", "new", "pending_confirmation"]),
      inArray(photosTable.id, [...photoVisible]),
    )) : Promise.resolve([]),
    permitVisible.size ? db.select({ expiryDate: permitsTable.expiryDate }).from(permitsTable)
      .where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt), inArray(permitsTable.id, [...permitVisible]))) : Promise.resolve([]),
    db.select({ completedAt: milestonesTable.completedAt }).from(milestonesTable).where(eq(milestonesTable.projectId, pid)),
    db.select({ total: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, pid)),
    // DECISION: portal members see project history from BEFORE their join date —
    // the site-updates feed (and every portal section) filters by project only,
    // never by join/added date. This is consistent with trade/everyone document
    // shares including later joiners. No per-project toggle.
    db.select({
      id: dailyNotesTable.id, body: dailyNotesTable.body, noteDate: dailyNotesTable.noteDate,
      photoUrl: dailyNotesTable.photoUrl, authorName: usersTable.name,
    }).from(dailyNotesTable)
      .leftJoin(usersTable, eq(dailyNotesTable.authorId, usersTable.id))
      .where(eq(dailyNotesTable.projectId, pid))
      .orderBy(desc(dailyNotesTable.createdAt)).limit(10),
  ]);
  const progressPercent = milestonesRows.length === 0 ? 0 : Math.round(milestonesRows.filter(m => m.completedAt !== null).length / milestonesRows.length * 100);
  const activePermits = (permitRows as { expiryDate: string }[]).filter(p => expiryStatus(p.expiryDate) === "active").length;
  res.json({
    project: serializeProject(proj, progressPercent),
    stats: {
      openIssues: openIssueRows.length,
      upcomingMilestones: milestonesRows.filter(m => m.completedAt === null).length,
      activePermits,
      teamSize: Number(teamRows[0]?.total ?? 0),
    },
    recentNotes: notes.map(n => ({ id: n.id, body: n.body, noteDate: n.noteDate, authorName: n.authorName ?? "Unknown", photoUrl: n.photoUrl ?? undefined })),
  });
});

// GET /api/portal/shared — everything shared with this member across types
// (the "Shared with me" landing — now the ONLY place drawings/method
// statements/permits/safety/general documents surface; the old standalone
// nav tabs for those were retired in favour of a category filter here).
// Safety docs are always included (never gated). Site issues ("photos") are
// additionally gated on canLogIssues — that flag now governs the whole Site
// Issues section, including whether it can leak through this aggregate view.
// A shared daily report is deliberately narrow — just the authored site diary
// (weather/labour/plant/work completed/delays/deliveries/H&S notes), never the
// auto-collated internal activity (check-ins, document views/sign-offs, site
// photos) that the dashboard's full report shows. That activity is operational/
// audit data, not meant for external distribution — the PM chose to share the
// diary, not the whole day's audit trail.
function serializeSharedReport(r: { id: string; reportDate: string; managerReport: unknown }) {
  return { id: r.id, reportDate: r.reportDate, managerReport: r.managerReport };
}

router.get("/portal/shared", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const [docMap, photoMap, permitMap, reportMap, lastView, permRow] = await Promise.all([
    visibleShareMap(pid, "document", viewer),
    visibleShareMap(pid, "photo", viewer),
    visibleShareMap(pid, "permit", viewer),
    visibleShareMap(pid, "daily_report", viewer),
    lastViewedBySection(req.user!.id, pid),
    db.select({ canLogIssues: projectMembersTable.canLogIssues }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.userId, req.user!.id))).limit(1),
  ]);
  const canLogIssues = permRow[0]?.canLogIssues ?? false;
  const seenBefore = lastView.get("shared");
  const docIds = [...docMap.keys()], photoIds = canLogIssues ? [...photoMap.keys()] : [], permitIds = [...permitMap.keys()], reportIds = [...reportMap.keys()];
  const [gatedDocs, safetyDocs, photos, permits, reports] = await Promise.all([
    docIds.length ? db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), inArray(documentsTable.id, docIds), inArray(documentsTable.status, ["current", "superseded"]))) : Promise.resolve([]),
    db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, "safety"), eq(documentsTable.status, "current"))),
    photoIds.length ? db.select().from(photosTable).where(and(eq(photosTable.projectId, pid), inArray(photosTable.id, photoIds))) : Promise.resolve([]),
    permitIds.length ? db.select().from(permitsTable).where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt), inArray(permitsTable.id, permitIds))) : Promise.resolve([]),
    reportIds.length ? db.select().from(dailyReportsTable).where(and(eq(dailyReportsTable.projectId, pid), inArray(dailyReportsTable.id, reportIds))) : Promise.resolve([] as (typeof dailyReportsTable.$inferSelect)[]),
  ]);
  // Safety docs bypass portal_shares entirely, so they have no entry in docMap —
  // fold their own createdAt in as a synthetic "shared at" for ordering/unseen.
  const docMapWithSafety = new Map(docMap);
  for (const d of safetyDocs) if (!docMapWithSafety.has(d.id)) docMapWithSafety.set(d.id, d.createdAt);
  const docs = [...gatedDocs, ...safetyDocs.filter(d => !docMap.has(d.id))];
  const myStatuses = await myDocStatuses(req.user!.id, docs.map(d => d.id));
  // A share rule can outlive its content (e.g. shared before the diary was ever
  // written) — only surface reports that actually have something to read.
  const reportsWithContent = reports.filter(r => hasManagerContent(r.managerReport));
  // Annotate each item with when it was shared + whether it's unseen, and order
  // NEWEST-shared first so fresh content is at the top with the unseen highlight.
  const annotate = <T extends { id: string }>(rows: T[], serialize: (r: T) => any, map: Map<string, Date>) =>
    rows
      .map(r => { const at = map.get(r.id); return { ...serialize(r), sharedAt: at?.toISOString(), _at: at?.getTime() ?? 0, unseen: isAfter(at, seenBefore) }; })
      .sort((a, b) => b._at - a._at)
      .map(({ _at, ...rest }) => rest);
  res.json({
    documents: withMyStatus(annotate(docs, serializeDoc, docMapWithSafety), myStatuses),
    photos: annotate(photos, serializeIssue, photoMap),
    permits: annotate(permits, serializePermit, permitMap),
    dailyReports: annotate(reportsWithContent, serializeSharedReport, reportMap),
  });
});

// POST /api/portal/daily-reports/:reportId/view — log that this member opened a
// report explicitly shared with them via the portal (distinct from the
// permission-gated /portal/daily-report flow for today's report, which doesn't
// need a separate view log since it's already activity-tracked by section).
router.post("/portal/daily-reports/:reportId/view", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const ids = await visibleIds(pid, "daily_report", viewer);
  if (!ids.has(req.params.reportId)) { res.status(404).json({ error: "not_found", message: "Report not found" }); return; }
  void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "shared", action: "view", itemType: "daily_report", itemId: req.params.reportId, req });
  res.json({ success: true });
});

// GET /api/portal/progress
router.get("/portal/progress", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const rows = await db.select().from(milestonesTable).where(eq(milestonesTable.projectId, pid))
    .orderBy(asc(milestonesTable.order), asc(milestonesTable.dueDate));
  const progressPercent = rows.length === 0 ? 0 : Math.round(rows.filter(m => m.completedAt !== null).length / rows.length * 100);
  res.json({
    progressPercent,
    milestones: rows.map(m => ({ id: m.id, title: m.title, dueDate: m.dueDate, completedAt: iso(m.completedAt), order: m.order })),
  });
});

// GET /api/portal/team — each member disambiguated by name + company + job title.
router.get("/portal/team", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const proj = await loadProject(pid);
  const ourCompany = proj
    ? (await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, proj.companyId)).limit(1))[0]?.name ?? "In-house"
    : "In-house";

  const members = await db.select().from(projectMembersTable).where(eq(projectMembersTable.projectId, pid));
  const personIds = members.map(m => m.personId).filter(Boolean) as string[];
  const userIds = members.map(m => m.userId).filter(Boolean) as string[];
  const [people, users, certs] = await Promise.all([
    personIds.length ? db.select().from(peopleTable).where(inArray(peopleTable.id, personIds)) : Promise.resolve([]),
    userIds.length ? db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds)) : Promise.resolve([]),
    // Person certifications (Feature: person-first cards) — shown on the
    // portal team row alongside company info, gated by the same contact
    // visibility toggle as email/phone.
    personIds.length ? db.select().from(personCertificationsTable).where(and(inArray(personCertificationsTable.personId, personIds), isNull(personCertificationsTable.archivedAt))) : Promise.resolve([]),
  ]);
  const certsByPerson = new Map<string, Array<{ name: string; expiryDate: string; status: string }>>();
  for (const c of certs) {
    const status = expiryStatus(c.expiryDate) === "active" ? "valid" : expiryStatus(c.expiryDate);
    const list = certsByPerson.get(c.personId) ?? [];
    list.push({ name: c.name, expiryDate: c.expiryDate, status });
    certsByPerson.set(c.personId, list);
  }
  // All subcontractors referenced either directly (company link) or via a person.
  const subIds = [...new Set([
    ...members.map(m => m.subcontractorId).filter(Boolean) as string[],
    ...people.map(p => p.subcontractorId).filter(Boolean) as string[],
  ])];
  const subs = subIds.length ? await db.select().from(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds)) : [];
  const subById = new Map(subs.map(s => [s.id, s]));
  const personById = new Map(people.map(p => [p.id, p]));
  const userById = new Map(users.map(u => [u.id, u]));

  // Contact details are shown per-person only when allowed: the person's explicit
  // flag, else the role default (managers ON, everyone else OFF). When OFF the row
  // is name + company + job title only.
  const showsContact = (flag: boolean | null | undefined, role: string) => flag ?? role === "manager";

  // Best-effort surname for sorting: the split field when we have it, else the
  // last word of the full name (legacy dashboard users have no firstName/
  // lastName split — see Phase D scope note in people.ts).
  const surnameOf = (name: string, lastName?: string | null) => (lastName?.trim() || name.trim().split(" ").slice(-1)[0] || name).toLowerCase();

  const result = members.map(m => {
    // A portal member (person link) carries the richest info: name + firm + job title.
    const person = m.personId ? personById.get(m.personId) : undefined;
    if (person) {
      const sub = person.subcontractorId ? subById.get(person.subcontractorId) : undefined;
      const user = m.userId ? userById.get(m.userId) : undefined;
      const contact = showsContact(person.showContactInPortal, m.role);
      // person.name/lastName can be a stale copy-on-write mirror of the
      // subcontractor's own contact fields (see lib/person-name.ts) — resolve
      // the canonical value the same way the Team tab does.
      const canonical = canonicalPersonName(person, sub);
      return {
        name: canonical.name,
        sortKey: surnameOf(canonical.name, canonical.lastName),
        company: sub ? (sub.contactType === "self_employed" ? "Self-employed" : sub.companyName) : ourCompany,
        jobTitle: person.roleTitle ?? undefined,
        role: m.role,
        trades: sub?.trades ?? [],
        ...(contact ? { email: person.email ?? undefined, phone: (person.phone ?? user?.phone) ?? undefined } : {}),
        certifications: certsByPerson.get(person.id) ?? [],
      };
    }
    const sub = m.subcontractorId ? subById.get(m.subcontractorId) : undefined;
    if (sub) {
      const contact = showsContact(null, "subcontractor");
      return { name: sub.contactName, sortKey: surnameOf(sub.contactName, sub.contactLastName), company: sub.companyName, jobTitle: undefined, role: "subcontractor", trades: sub.trades ?? [], ...(contact ? { email: sub.contactEmail ?? undefined, phone: sub.contactPhone ?? undefined } : {}) };
    }
    const user = m.userId ? userById.get(m.userId) : undefined;
    const contact = showsContact(null, m.role);
    const name = user?.name ?? "Unknown";
    return { name, sortKey: surnameOf(name), company: ourCompany, jobTitle: undefined, role: m.role, trades: [], ...(contact ? { email: user?.email ?? undefined, phone: user?.phone ?? undefined } : {}) };
  }).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map(({ sortKey, ...rest }) => rest);
  res.json(result);
});

// Portal dictation: speech-to-text for the mic buttons across the portal
// (Daily Report, Site Issues, Plant & Materials, notes, messages). Gated on a
// portal session only — dictation is an input aid, not a data-access surface.
const transcribeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
router.post("/portal/transcribe", authenticate, requirePortalSession, requirePortalMember, transcribeUpload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "validation_error", message: "No audio file provided" });
      return;
    }
    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
    res.json({ transcript });
  } catch (err: any) {
    req.log.error({ err }, "Portal transcription error");
    res.status(500).json({ error: "server_error", message: "Transcription failed" });
  }
});

// GET /api/portal/site-issues — READ is open to every portal member (members
// can always reopen and view issues); canLogIssues only gates the write
// endpoints below. Within a member's view: shared photos, PLUS an issue this
// member reported or is assigned to (they must always see their own status,
// even without an explicit share) — this never leaks who ELSE it's shared
// with, only the reporter's own name on their own reports.
router.get("/portal/site-issues", authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const sharedIds = await visibleIds(pid, "photo", viewer);
  const rows = await db.select().from(photosTable)
    .where(and(
      eq(photosTable.projectId, pid),
      issueCategoryFilter(),
      or(
        // Shared / assigned issues from OTHERS only ever show once submitted —
        // a draft is private to its reporter until they choose to submit it.
        sharedIds.size ? and(inArray(photosTable.id, [...sharedIds]), isNotNull(photosTable.submittedAt)) : undefined,
        and(eq(photosTable.assignedToUserId, req.user!.id), isNotNull(photosTable.submittedAt)),
        // The reporter always sees their own, draft or submitted.
        eq(photosTable.uploadedBy, req.user!.id),
      ),
    ))
    .orderBy(desc(photosTable.takenAt));
  const reporterIds = [...new Set(rows.filter(r => r.uploadedBy === req.user!.id).map(r => r.uploadedBy))];
  const reporters = reporterIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, reporterIds)) : [];
  const reporterName = new Map(reporters.map(u => [u.id, u.name]));
  res.json(await Promise.all(rows.map(r => serializeIssue(r, r.uploadedBy === req.user!.id ? (reporterName.get(r.uploadedBy) ?? null) : null))));
});

// POST /api/portal/site-issues — a portal member (with canLogIssues) logs a
// Snag / Safety Concern / Work Completed report. Mirrors the dashboard form
// but WITHOUT "Assign to" — assignedToUserId/dueDate are server-side ignored
// even if a client sends them; triage/allocation is the PM's job.
router.post("/portal/site-issues", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canLogIssues"), memberUploadSingle("photo"), async (req, res) => {
  const pid = req.portalProjectId!;
  const category = String(req.body?.type ?? "").trim();
  if (!["snag", "safety_concern", "work_completed"].includes(category)) {
    res.status(400).json({ error: "validation_error", message: "type must be snag, safety_concern, or work_completed" });
    return;
  }
  const description = String(req.body?.description ?? "").trim() || null;
  const zone = String(req.body?.zone ?? "").trim() || null;

  try {
    let photoUrl: string | null = null;
    if (req.file) {
      const saved = await saveMemberUpload(req.file, req.user!.id, req.user!.companyId);
      photoUrl = saved.fileUrl;
    }
    const [{ total }] = await db.select({ total: count() }).from(photosTable);
    const referenceNumber = `PHOTO-${String(total + 1).padStart(4, "0")}`;
    const id = generateId();
    // Saved as a DRAFT — submittedAt/submittedBy left null. The PM isn't
    // notified and the issue doesn't appear in their triage queue until the
    // reporter explicitly submits it (see POST .../submit below).
    await db.insert(photosTable).values({
      id, projectId: pid, uploadedBy: req.user!.id, photoUrl, category, description, zone,
      referenceNumber, status: "new", assignedToUserId: null, dueDate: null,
    });

    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "site-issues", action: "create", itemType: "photo", itemId: id, req });

    const created = (await db.select().from(photosTable).where(eq(photosTable.id, id)).limit(1))[0];
    const reporter = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1))[0];
    res.status(201).json(await serializeIssue(created, reporter?.name ?? null));
  } catch (err) {
    req.log.error({ err }, "Portal log site issue error");
    res.status(500).json({ error: "server_error", message: "Failed to log issue" });
  }
});

// PATCH /api/portal/site-issues/:issueId/edit — full edit of a draft's own
// fields (reporter-only, only while status is still "draft"). Once submitted,
// the original fields lock — further changes go through the notes endpoint.
router.patch("/portal/site-issues/:issueId/edit", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canLogIssues"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const rows = await db.select().from(photosTable)
      .where(and(eq(photosTable.id, req.params.issueId), eq(photosTable.projectId, pid))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Issue not found" }); return; }
    const issue = rows[0];
    if (issue.uploadedBy !== req.user!.id) { res.status(403).json({ error: "forbidden", message: "Only the reporter can edit this issue." }); return; }
    if (issue.submittedAt) { res.status(403).json({ error: "forbidden", message: "This issue has already been submitted — add a note instead." }); return; }

    const { type, description, zone } = req.body as { type?: string; description?: string; zone?: string };
    const updates: Partial<typeof photosTable.$inferInsert> = {};
    if (type !== undefined && ["snag", "safety_concern", "work_completed"].includes(type)) updates.category = type;
    if (description !== undefined) updates.description = description.trim() || null;
    if (zone !== undefined) updates.zone = zone.trim() || null;
    if (Object.keys(updates).length > 0) {
      await db.update(photosTable).set(updates).where(eq(photosTable.id, req.params.issueId));
    }

    const updated = (await db.select().from(photosTable).where(eq(photosTable.id, req.params.issueId)).limit(1))[0];
    const reporter = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.uploadedBy)).limit(1))[0];
    res.json(await serializeIssue(updated, reporter?.name ?? null));
  } catch (err) {
    req.log.error({ err }, "Portal edit draft issue error");
    res.status(500).json({ error: "server_error", message: "Failed to update draft" });
  }
});

// POST /api/portal/site-issues/:issueId/submit — reporter-only. Locks the
// original fields and puts the issue in front of the PM for the first time
// (notification + triage queue) — mirrors the create-time notify logic that
// used to fire immediately, now deferred until the reporter is actually ready.
router.post("/portal/site-issues/:issueId/submit", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canLogIssues"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const rows = await db.select().from(photosTable)
      .where(and(eq(photosTable.id, req.params.issueId), eq(photosTable.projectId, pid))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Issue not found" }); return; }
    const issue = rows[0];
    if (issue.uploadedBy !== req.user!.id) { res.status(403).json({ error: "forbidden", message: "Only the reporter can submit this issue." }); return; }
    if (issue.submittedAt) { res.status(403).json({ error: "forbidden", message: "Already submitted." }); return; }

    await db.update(photosTable).set({ submittedAt: new Date(), submittedBy: req.user!.id }).where(eq(photosTable.id, req.params.issueId));
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "site-issues", action: "update", itemType: "photo", itemId: issue.id, metadata: { submitted: { from: false, to: true } }, req });

    const proj = (await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, pid)).limit(1))[0];
    const reporter = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1))[0];
    const managers = await db.select({ userId: projectMembersTable.userId }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.role, "manager")));
    for (const m of managers) {
      if (!m.userId) continue;
      await db.insert(notificationsTable).values({
        id: generateId(), userId: m.userId, type: "portal_issue_logged",
        title: `New — awaiting triage: ${issue.referenceNumber}`,
        message: `${reporter?.name ?? "A member"} logged a ${issue.category.replace("_", " ")} at ${proj?.name ?? "your project"}.`,
        relatedEntityId: issue.id, relatedEntityType: "photo", read: false,
      });
    }

    const updated = (await db.select().from(photosTable).where(eq(photosTable.id, req.params.issueId)).limit(1))[0];
    res.json(await serializeIssue(updated, reporter?.name ?? null));
  } catch (err) {
    req.log.error({ err }, "Portal submit issue error");
    res.status(500).json({ error: "server_error", message: "Failed to submit issue" });
  }
});

// POST /api/portal/site-issues/:issueId/notes — append-only addition on a
// submitted issue. Available to the reporter and any manager; never edits
// the original fields.
router.post("/portal/site-issues/:issueId/notes", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canLogIssues"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const rows = await db.select().from(photosTable)
      .where(and(eq(photosTable.id, req.params.issueId), eq(photosTable.projectId, pid))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Issue not found" }); return; }
    const issue = rows[0];
    if (!issue.submittedAt) { res.status(400).json({ error: "validation_error", message: "Submit this issue before adding notes." }); return; }
    // Same visibility rule as the list read: the reporter, the assignee, or
    // anyone it's been shared to may add a note — never someone who can't see
    // the issue at all.
    if (issue.uploadedBy !== req.user!.id && issue.assignedToUserId !== req.user!.id) {
      const viewer = await resolveViewer(req.user!.id, pid);
      const sharedIds = await visibleIds(pid, "photo", viewer);
      if (!sharedIds.has(issue.id)) { res.status(403).json({ error: "forbidden", message: "You don't have access to this issue." }); return; }
    }
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) { res.status(400).json({ error: "validation_error", message: "A note body is required." }); return; }

    await addNote({ itemType: "site_issue", itemId: issue.id, projectId: pid, authorId: req.user!.id, body: body.trim() });
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "site-issues", action: "update", itemType: "photo", itemId: issue.id, req });

    const reporter = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, issue.uploadedBy)).limit(1))[0];
    res.status(201).json(await serializeIssue(issue, reporter?.name ?? null));
  } catch (err) {
    req.log.error({ err }, "Portal add issue note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

// PATCH /api/portal/site-issues/:issueId — the assignee marks their own
// allocated issue "Done — awaiting confirmation". Ownership-gated only (not
// the canLogIssues permission flag, which only gates creating new issues) —
// whoever an issue is assigned to may mark it done regardless of that flag.
router.patch("/portal/site-issues/:issueId", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const rows = await db.select().from(photosTable)
      .where(and(eq(photosTable.id, req.params.issueId), eq(photosTable.projectId, pid))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Issue not found" }); return; }
    const issue = rows[0];
    if (issue.assignedToUserId !== req.user!.id) {
      res.status(403).json({ error: "forbidden", message: "Only the assignee can mark this issue done." });
      return;
    }
    if (issue.status !== "open" && issue.status !== "in_progress") {
      res.status(400).json({ error: "validation_error", message: "Only an allocated issue can be marked done." });
      return;
    }
    await db.update(photosTable).set({ status: "pending_confirmation", updatedAt: new Date() }).where(eq(photosTable.id, req.params.issueId));
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "site-issues", action: "update", itemType: "photo", itemId: issue.id, metadata: { status: { from: issue.status, to: "pending_confirmation" } }, req });

    const updated = (await db.select().from(photosTable).where(eq(photosTable.id, req.params.issueId)).limit(1))[0];
    res.json(await serializeIssue(updated));
  } catch (err) {
    req.log.error({ err }, "Portal mark issue done error");
    res.status(500).json({ error: "server_error", message: "Failed to update issue" });
  }
});

// GET /api/portal/site-board — FULL parity with the public scanned board, read
// from the SAME source (buildSiteBoardPayload), plus the board's QR token so a
// member can rescan/share it. This is public-parity content, not gated.
router.get("/portal/site-board", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const payload = await buildSiteBoardPayload(pid);
  if (!payload) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
  const qr = (await db.select({ token: qrCodesTable.token }).from(qrCodesTable)
    .where(and(eq(qrCodesTable.projectId, pid), eq(qrCodesTable.category, "site_board"))).limit(1))[0];
  res.json({ ...payload, qrToken: qr?.token ?? null });
});

// GET /api/portal/hs — Health & Safety hub. Safety docs are always visible;
// method statements + permits are GATED to what's shared with the member.
router.get("/portal/hs", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const [docIds, permitIds] = await Promise.all([visibleIds(pid, "document", viewer), visibleIds(pid, "permit", viewer)]);
  const [methodStatements, safety, permits] = await Promise.all([
    docIds.size ? db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, "method_statement"), inArray(documentsTable.id, [...docIds]), inArray(documentsTable.status, ["current", "superseded"]))).orderBy(asc(documentsTable.name)) : Promise.resolve([]),
    db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, "safety"), eq(documentsTable.status, "current"))).orderBy(asc(documentsTable.name)),
    permitIds.size ? db.select().from(permitsTable).where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt), inArray(permitsTable.id, [...permitIds]))).orderBy(asc(permitsTable.expiryDate)) : Promise.resolve([]),
  ]);
  res.json({ methodStatements: methodStatements.map(serializeDoc), safety: safety.map(serializeDoc), permits: permits.map(serializePermit) });
});

// Shared list/detail handlers for document sections keyed by type. GATED: only
// documents shared with this member are returned — EXCEPT `safety`, which is
// always open (safety-critical content must never be hidden by a missed share).
// Shared docs are shown even when superseded (with their status flag).
function docListHandler(type: string) {
  return async (req: import("express").Request, res: import("express").Response) => {
    const pid = req.portalProjectId!;
    if (type === "safety") {
      const rows = await db.select().from(documentsTable)
        .where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, type), eq(documentsTable.status, "current")))
        .orderBy(asc(documentsTable.name));
      const myStatuses = await myDocStatuses(req.user!.id, rows.map(r => r.id));
      res.json(withMyStatus(rows.map(serializeDoc), myStatuses));
      return;
    }
    const viewer = await resolveViewer(req.user!.id, pid);
    const ids = await visibleIds(pid, "document", viewer);
    if (ids.size === 0) { res.json([]); return; }
    const rows = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, type), inArray(documentsTable.id, [...ids]), inArray(documentsTable.status, ["current", "superseded"])))
      .orderBy(asc(documentsTable.name));
    const myStatuses = await myDocStatuses(req.user!.id, rows.map(r => r.id));
    res.json(withMyStatus(rows.map(serializeDoc), myStatuses));
  };
}
function docDetailHandler(type: string) {
  return async (req: import("express").Request, res: import("express").Response) => {
    const pid = req.portalProjectId!;
    const rows = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, req.params.documentId), eq(documentsTable.projectId, pid), eq(documentsTable.type, type)))
      .limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Document not found" }); return; }
    // Gate everything except safety; opening a shared doc records the view.
    if (type !== "safety") {
      const viewer = await resolveViewer(req.user!.id, pid);
      const ids = await visibleIds(pid, "document", viewer);
      if (!ids.has(rows[0].id)) { res.status(404).json({ error: "not_found", message: "Document not found" }); return; }
      await recordDocView(rows[0].id, req.user!.id);
    }
    const myStatuses = await myDocStatuses(req.user!.id, [rows[0].id]);
    const payload: Record<string, unknown> = withMyStatus([serializeDoc(rows[0])], myStatuses)[0];
    // If this doc has been superseded, point the member at its live replacement
    // so they can jump straight to the current version.
    if (rows[0].status === "superseded") {
      const replacement = await resolveReplacement(pid, rows[0].id);
      if (replacement) {
        payload.supersededBy = {
          id: replacement.id, name: replacement.name,
          version: replacement.version, revision: replacement.revision ?? undefined,
        };
      }
    }
    res.json(payload);
  };
}

// GET /api/portal/drawings (+ /:documentId)
router.get("/portal/drawings", ...portalGuards, docListHandler("drawing"));
// GET /api/portal/drawings/download-all — zip every CURRENT drawing the viewer
// can see. Registered before /:documentId so "download-all" isn't swallowed as an id.
router.get("/portal/drawings/download-all", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const ids = await visibleIds(pid, "document", viewer);
  const rows = ids.size
    ? await db.select().from(documentsTable)
        .where(and(
          eq(documentsTable.projectId, pid), eq(documentsTable.type, "drawing"),
          eq(documentsTable.status, "current"), inArray(documentsTable.id, [...ids]),
        ))
        .orderBy(asc(documentsTable.name))
    : [];
  if (rows.length === 0) { res.status(404).json({ error: "not_found", message: "No drawings available to download" }); return; }

  const bucket = getBucket();
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err: Error) => {
    req.log.error({ err }, "Drawings zip error");
    if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to build archive" });
    else res.destroy();
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="drawings.zip"');
  archive.pipe(res);

  const used = new Set<string>();
  for (const doc of rows) {
    const filename = fileUrlToFilename(doc.fileUrl);
    if (!filename) continue;
    let entryName = doc.name.replace(/[/\\]/g, "-");
    if (!/\.[a-z0-9]+$/i.test(entryName)) {
      const ext = filename.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
      entryName += ext;
    }
    let unique = entryName, n = 1;
    while (used.has(unique)) { unique = entryName.replace(/(\.[^.]+)?$/, `-${n++}$1`); }
    used.add(unique);
    archive.append(bucket.file(objectKey(filename)).createReadStream(), { name: unique });
  }
  await archive.finalize();
});

router.get("/portal/drawings/:documentId", ...portalGuards, docDetailHandler("drawing"));

// GET /api/portal/documents/:documentId/download — stream a single doc's file
// as an attachment, gated to what the viewer may see (safety docs are open).
router.get("/portal/documents/:documentId/download", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const rows = await db.select().from(documentsTable)
    .where(and(eq(documentsTable.id, req.params.documentId), eq(documentsTable.projectId, pid)))
    .limit(1);
  if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Document not found" }); return; }
  const doc = rows[0];
  if (doc.type !== "safety") {
    const viewer = await resolveViewer(req.user!.id, pid);
    const ids = await visibleIds(pid, "document", viewer);
    if (!ids.has(doc.id)) { res.status(404).json({ error: "not_found", message: "Document not found" }); return; }
  }
  const filename = fileUrlToFilename(doc.fileUrl);
  if (!filename) { res.status(404).json({ error: "not_found", message: "Document file unavailable" }); return; }

  let downloadName = doc.name.replace(/[/\\"]/g, "-");
  if (!/\.[a-z0-9]+$/i.test(downloadName)) {
    downloadName += filename.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  }
  const stream = getBucket().file(objectKey(filename)).createReadStream();
  stream.on("error", (err) => {
    req.log.error({ err }, "Document download error");
    if (!res.headersSent) res.status(404).json({ error: "not_found", message: "Document file unavailable" });
    else res.destroy();
  });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  stream.pipe(res);
});

// POST /api/portal/documents/:documentId/view — record that this member opened
// a document (pending → viewed). Fired from the client on "Open", separate from
// sign-off: viewing never needs a PIN, only signing off does.
router.post("/portal/documents/:documentId/view", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const rows = await db.select({ id: documentsTable.id, type: documentsTable.type }).from(documentsTable)
    .where(and(eq(documentsTable.id, req.params.documentId), eq(documentsTable.projectId, pid)))
    .limit(1);
  if (!rows[0] || !(await isDocVisibleToViewer(pid, req.user!.id, rows[0]))) {
    res.status(404).json({ error: "not_found", message: "Document not found" });
    return;
  }
  await recordDocView(rows[0].id, req.user!.id);
  res.json({ success: true });
});

// POST /api/portal/documents/:documentId/acknowledge — PIN-confirmed sign-off,
// the portal twin of POST /documents/:documentId/acknowledge (dashboard). A
// portal member's "distribution" is implicit in what's shared with them (no
// separate distribute step), so this upserts the row rather than requiring one
// to already exist — same rate-limited PIN check, same append-only audit row.
router.post("/portal/documents/:documentId/acknowledge", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const { pin } = req.body as { pin?: string };
    const rows = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, req.params.documentId), eq(documentsTable.projectId, pid)))
      .limit(1);
    if (!rows[0] || !(await isDocVisibleToViewer(pid, req.user!.id, rows[0]))) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }
    const doc = rows[0];
    if (!doc.requiresAcknowledgment) {
      res.status(400).json({ error: "validation_error", message: "This document does not require sign-off." });
      return;
    }

    // Safety-critical documents (method statements/RAMS, permits, safety docs)
    // and any document flagged "require PIN sign-off" are PIN-confirmed. All
    // other sign-offs are a single deliberate confirm — still attributed,
    // timestamped, and audit-logged exactly the same, just without PIN entry.
    const pinRequired = pinRequiredForDoc(doc);
    const userRows = await db.select({ pinHash: usersTable.pinHash, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (pinRequired) {
      if (await isPinLockedOut(req.user!.id)) {
        res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
        return;
      }
      const pinHash = userRows[0]?.pinHash ?? null;
      if (!pinHash) {
        res.status(400).json({ error: "pin_not_set", message: "You need to set a sign-off PIN before signing off documents." });
        return;
      }
      if (!pin || !/^\d{4}$/.test(String(pin))) {
        res.status(400).json({ error: "validation_error", message: "A 4-digit PIN is required to sign off this document." });
        return;
      }
      const valid = await bcrypt.compare(String(pin), pinHash);
      if (!valid) {
        const { locked, remaining } = await recordFailedPinAttempt(req.user!.id);
        if (locked) res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
        else res.status(401).json({ error: "invalid_pin", message: "Incorrect PIN", attemptsRemaining: remaining });
        return;
      }
      await clearPinAttempts(req.user!.id);
    }

    const existing = await db.select().from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, doc.id), eq(documentDistributionsTable.userId, req.user!.id)))
      .limit(1);

    await db.transaction(async (tx) => {
      if (existing[0]) {
        await tx.update(documentDistributionsTable)
          .set({ status: "acknowledged", acknowledgedAt: new Date(), viewedAt: existing[0].viewedAt ?? new Date(), signedOffWithPin: pinRequired })
          .where(eq(documentDistributionsTable.id, existing[0].id));
      } else {
        await tx.insert(documentDistributionsTable).values({
          id: generateId(), documentId: doc.id, userId: req.user!.id,
          status: "acknowledged", viewedAt: new Date(), acknowledgedAt: new Date(), signedOffWithPin: pinRequired,
        });
      }
      await tx.insert(acknowledgmentAuditTable).values({
        id: generateId(),
        documentId: doc.id,
        documentVersion: doc.version,
        userId: req.user!.id,
        userName: userRows[0]?.name ?? "Unknown",
        userRole: req.portalMemberRole ?? "portal_member",
        action: "acknowledged",
        signedOffWithPin: pinRequired,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    res.json({ success: true, message: "Document acknowledged" });
  } catch (err) {
    req.log.error({ err }, "Portal acknowledge document error");
    res.status(500).json({ error: "server_error", message: "Failed to sign off document" });
  }
});

// GET /api/portal/method-statements (+ /:documentId)
router.get("/portal/method-statements", ...portalGuards, docListHandler("method_statement"));
router.get("/portal/method-statements/:documentId", ...portalGuards, docDetailHandler("method_statement"));

// GET /api/portal/safety
router.get("/portal/safety", ...portalGuards, docListHandler("safety"));

// GET /api/portal/permits — GATED to shared permits.
router.get("/portal/permits", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const ids = await visibleIds(pid, "permit", viewer);
  if (ids.size === 0) { res.json([]); return; }
  const rows = await db.select().from(permitsTable)
    .where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt), inArray(permitsTable.id, [...ids])))
    .orderBy(asc(permitsTable.expiryDate));
  res.json(rows.map(serializePermit));
});

// ---- Plant & Materials ----
// Fix: this is NOT a shared-documents section — it was wrongly gated behind
// visibleIds/portal_shares (the same mechanism as documents/photos/permits),
// so a member with canUpdatePlantMaterials but no explicit per-item share saw
// an empty "nothing shared with you" list. The permission alone now grants
// the WHOLE project plant list — no separate sharing step.
async function serializePortalPlantItem(item: typeof plantItemsTable.$inferSelect): Promise<Record<string, unknown>> {
  const [updater, supplier, attachments, draftUpdater, submissionNotes] = await Promise.all([
    item.lastUpdatedBy ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, item.lastUpdatedBy)).limit(1) : Promise.resolve([]),
    item.supplierContactId ? db.select({ name: subcontractorsTable.companyName }).from(subcontractorsTable).where(eq(subcontractorsTable.id, item.supplierContactId)).limit(1) : Promise.resolve([]),
    db.select().from(plantItemAttachmentsTable).where(eq(plantItemAttachmentsTable.plantItemId, item.id)),
    item.portalDraftUpdatedBy ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, item.portalDraftUpdatedBy)).limit(1) : Promise.resolve([]),
    notesFor("plant_item", item.id),
  ]);
  const uploaderIds = [...new Set(attachments.map(a => a.uploadedBy))];
  const uploaders = uploaderIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, uploaderIds)) : [];
  const uploaderName = new Map(uploaders.map(u => [u.id, u.name]));
  const hasDraft = !!item.portalDraftUpdatedAt;
  return {
    id: item.id, name: item.name, category: item.category,
    quantity: item.quantity ?? null, unit: item.unit ?? null,
    supplierOwnerText: item.supplierOwnerText ?? null,
    supplierContactName: supplier[0]?.name ?? null,
    location: item.location ?? null, status: item.status, notes: item.notes ?? null,
    onSiteDate: item.onSiteDate ?? null, expectedOffHireDate: item.expectedOffHireDate ?? null,
    lastUpdatedByName: updater[0]?.name ?? null,
    lastUpdatedAt: item.lastUpdatedAt ? item.lastUpdatedAt.toISOString() : null,
    attachments: attachments.map(a => ({
      id: a.id, plantItemId: a.plantItemId, uploadedBy: a.uploadedBy,
      uploaderName: uploaderName.get(a.uploadedBy) ?? "Unknown",
      name: a.name, kind: a.kind, fileUrl: a.fileUrl, fileSize: a.fileSize,
      createdAt: a.createdAt.toISOString(),
    })),
    // Portal save-vs-submit lifecycle (Feature). A pending draft edit — visible
    // so the member can reopen and keep editing before submitting — never
    // touches the live status/location/notes above until submitted.
    lifecycleStatus: hasDraft ? "draft" : "submitted",
    draft: hasDraft ? {
      status: item.portalDraftStatus, location: item.portalDraftLocation, notes: item.portalDraftNotes,
      updatedByName: draftUpdater[0]?.name ?? null,
      updatedAt: item.portalDraftUpdatedAt!.toISOString(),
    } : null,
    submissionNotes,
  };
}

// Portal submission privacy (user rule): a member only sees plant/material
// entries they logged THEMSELVES, plus entries the PM explicitly shared with
// them (plant_item_distributions). The PM's own dashboard log stays private
// to the dashboard until shared — mirrors the Site Issues visibility model.
async function portalVisiblePlantItem(pid: string, itemId: string, userId: string): Promise<typeof plantItemsTable.$inferSelect | null> {
  const rows = await db.select().from(plantItemsTable)
    .where(and(eq(plantItemsTable.id, itemId), eq(plantItemsTable.projectId, pid), isNull(plantItemsTable.archivedAt))).limit(1);
  const item = rows[0];
  if (!item) return null;
  if (item.createdBy === userId) return item;
  const dist = await db.select({ id: plantItemDistributionsTable.id }).from(plantItemDistributionsTable)
    .where(and(eq(plantItemDistributionsTable.plantItemId, itemId), eq(plantItemDistributionsTable.userId, userId))).limit(1);
  return dist[0] ? item : null;
}

// GET /api/portal/plant-materials — only the member's own entries + entries
// the PM has shared with them (see privacy note above).
router.get("/portal/plant-materials", authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity, async (req, res) => {
  const pid = req.portalProjectId!;
  const uid = req.user!.id;
  const rows = await db.select().from(plantItemsTable)
    .where(and(eq(plantItemsTable.projectId, pid), isNull(plantItemsTable.archivedAt)))
    .orderBy(asc(plantItemsTable.name));
  let visible = rows.filter(r => r.createdBy === uid);
  const others = rows.filter(r => r.createdBy !== uid);
  if (others.length > 0) {
    const dists = await db.select({ plantItemId: plantItemDistributionsTable.plantItemId })
      .from(plantItemDistributionsTable)
      .where(and(eq(plantItemDistributionsTable.userId, uid), inArray(plantItemDistributionsTable.plantItemId, others.map(r => r.id))));
    const shared = new Set(dists.map(d => d.plantItemId));
    visible = rows.filter(r => r.createdBy === uid || shared.has(r.id));
  }
  res.json(await Promise.all(visible.map(serializePortalPlantItem)));
});

// GET /api/portal/plant-materials/:itemId
router.get("/portal/plant-materials/:itemId", authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity, async (req, res) => {
  const pid = req.portalProjectId!;
  const item = await portalVisiblePlantItem(pid, req.params.itemId, req.user!.id);
  if (!item) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }
  res.json(await serializePortalPlantItem(item));
});

// POST /api/portal/plant-materials — authorised members can log a NEW plant/
// material item from site (user request: "should be able to be updated/logged
// from the portal by anyone who has authorisation"). Creation is live
// immediately (no draft stage — drafts only make sense for edits to existing
// items) and the project's managers are notified so it lands in their view.
router.post("/portal/plant-materials", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canUpdatePlantMaterials"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const { name, category, quantity, unit, location, status, notes } = req.body as {
      name?: string; category?: string; quantity?: string | null; unit?: string | null;
      location?: string | null; status?: string; notes?: string | null;
    };
    const cleanName = String(name ?? "").trim().slice(0, 200);
    if (!cleanName) { res.status(400).json({ error: "validation_error", message: "A name is required." }); return; }
    if (!["plant_equipment", "materials"].includes(category ?? "")) {
      res.status(400).json({ error: "validation_error", message: "category must be plant_equipment or materials" });
      return;
    }
    const cleanStatus = ["on_site", "on_order", "off_hired", "depleted"].includes(status ?? "") ? status! : "on_site";

    const id = generateId();
    await db.insert(plantItemsTable).values({
      id,
      projectId: pid,
      name: cleanName,
      category: category!,
      quantity: quantity ? String(quantity) : null,
      unit: unit?.trim() || null,
      location: location?.trim() || null,
      status: cleanStatus,
      notes: notes?.trim() || null,
      createdBy: req.user!.id,
      lastUpdatedBy: req.user!.id,
      lastUpdatedAt: new Date(),
    });
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "plant-materials", action: "create", itemType: "plant_item", itemId: id, req });

    // Best-effort: let the company's managers know a member logged an item.
    try {
      const proj = (await db.select({ name: projectsTable.name, companyId: projectsTable.companyId })
        .from(projectsTable).where(eq(projectsTable.id, pid)).limit(1))[0];
      if (proj) {
        const creator = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1))[0];
        const managers = await db.select({ userId: companyMembersTable.userId })
          .from(companyMembersTable)
          .where(and(eq(companyMembersTable.companyId, proj.companyId), inArray(companyMembersTable.role, ["admin", "project_manager"])));
        for (const userId of [...new Set(managers.map(m => m.userId))]) {
          await db.insert(notificationsTable).values({
            id: generateId(), userId, type: "portal_plant_item_logged",
            title: `New plant/material at ${proj.name}`,
            message: `${creator?.name ?? "A member"} logged "${cleanName}" from the portal.`,
            relatedEntityId: pid, relatedEntityType: "project", read: false,
          });
        }
      }
    } catch { /* notifying managers is best-effort */ }

    const created = (await db.select().from(plantItemsTable).where(eq(plantItemsTable.id, id)).limit(1))[0];
    res.status(201).json(await serializePortalPlantItem(created));
  } catch (err) {
    req.log.error({ err }, "Portal create plant item error");
    res.status(500).json({ error: "server_error", message: "Failed to log item" });
  }
});

// PATCH /api/portal/plant-materials/:itemId — SAVE (draft only). Writes to the
// portal_draft_* shadow columns, never the live status/location/notes — the PM
// (and the dashboard's own view) sees nothing change until the member submits.
router.patch("/portal/plant-materials/:itemId", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canUpdatePlantMaterials"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const item = await portalVisiblePlantItem(pid, req.params.itemId, req.user!.id);
    if (!item) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    const { status, location, notes } = req.body as { status?: string; location?: string | null; notes?: string | null };
    await db.update(plantItemsTable).set({
      portalDraftStatus: status !== undefined ? status : (item.portalDraftStatus ?? item.status),
      portalDraftLocation: location !== undefined ? location : (item.portalDraftLocation ?? item.location),
      portalDraftNotes: notes !== undefined ? notes : (item.portalDraftNotes ?? item.notes),
      portalDraftUpdatedBy: req.user!.id,
      portalDraftUpdatedAt: new Date(),
    }).where(eq(plantItemsTable.id, req.params.itemId));

    const updated = await db.select().from(plantItemsTable).where(eq(plantItemsTable.id, req.params.itemId)).limit(1);
    res.json(await serializePortalPlantItem(updated[0]));
  } catch (err) {
    req.log.error({ err }, "Portal save plant item draft error");
    res.status(500).json({ error: "server_error", message: "Failed to save draft" });
  }
});

// POST /api/portal/plant-materials/:itemId/submit — copies the pending draft
// onto the live status/location/notes (what the PM and dashboard actually
// see), stamps lastUpdatedBy/lastUpdatedAt for attribution, and clears the
// draft. 400 if there's nothing staged to submit.
router.post("/portal/plant-materials/:itemId/submit", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canUpdatePlantMaterials"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const item = await portalVisiblePlantItem(pid, req.params.itemId, req.user!.id);
    if (!item) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }
    if (!item.portalDraftUpdatedAt) { res.status(400).json({ error: "validation_error", message: "No draft to submit." }); return; }

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (item.portalDraftStatus !== item.status) diff.status = { from: item.status, to: item.portalDraftStatus };
    if (item.portalDraftLocation !== item.location) diff.location = { from: item.location, to: item.portalDraftLocation };
    if (item.portalDraftNotes !== item.notes) diff.notes = { from: item.notes, to: item.portalDraftNotes };

    await db.update(plantItemsTable).set({
      status: item.portalDraftStatus ?? item.status,
      location: item.portalDraftLocation,
      notes: item.portalDraftNotes,
      lastUpdatedBy: req.user!.id,
      lastUpdatedAt: new Date(),
      portalDraftStatus: null, portalDraftLocation: null, portalDraftNotes: null,
      portalDraftUpdatedBy: null, portalDraftUpdatedAt: null,
    }).where(eq(plantItemsTable.id, req.params.itemId));
    if (Object.keys(diff).length > 0) {
      void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "plant-materials", action: "update", itemType: "plant_item", itemId: req.params.itemId, metadata: diff, req });
    }

    const updated = await db.select().from(plantItemsTable).where(eq(plantItemsTable.id, req.params.itemId)).limit(1);
    res.json(await serializePortalPlantItem(updated[0]));
  } catch (err) {
    req.log.error({ err }, "Portal submit plant item error");
    res.status(500).json({ error: "server_error", message: "Failed to submit" });
  }
});

// POST /api/portal/plant-materials/:itemId/notes — append-only addition,
// independent of the draft/submit flow above (works any time, not gated on a
// prior submit, since a plant item is never "unsubmitted" as a whole — it's a
// persistent PM-owned record members annotate over time).
router.post("/portal/plant-materials/:itemId/notes", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canUpdatePlantMaterials"), async (req, res) => {
  const pid = req.portalProjectId!;
  try {
    const item = await portalVisiblePlantItem(pid, req.params.itemId, req.user!.id);
    if (!item) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) { res.status(400).json({ error: "validation_error", message: "A note body is required." }); return; }

    await addNote({ itemType: "plant_item", itemId: req.params.itemId, projectId: pid, authorId: req.user!.id, body: body.trim() });
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "plant-materials", action: "update", itemType: "plant_item", itemId: req.params.itemId, req });

    const updated = await db.select().from(plantItemsTable).where(eq(plantItemsTable.id, req.params.itemId)).limit(1);
    res.status(201).json(await serializePortalPlantItem(updated[0]));
  } catch (err) {
    req.log.error({ err }, "Portal add plant item note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

// POST /api/portal/plant-materials/:itemId/attachments — add a photo/document
// to a plant item. Gated purely on the canUpdatePlantMaterials permission
// (see the sharing-bug fix note above serializePortalPlantItem).
router.post("/portal/plant-materials/:itemId/attachments", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canUpdatePlantMaterials"), memberUploadSingle("file"), async (req, res) => {
  const pid = req.portalProjectId!;
  if (!req.file) { res.status(400).json({ error: "validation_error", message: "No file provided" }); return; }
  const name = String(req.body?.name ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim() || "other";
  if (!name) { res.status(400).json({ error: "validation_error", message: "A name is required." }); return; }

  try {
    const item = await portalVisiblePlantItem(pid, req.params.itemId, req.user!.id);
    if (!item) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    const { fileUrl, fileSize } = await saveMemberUpload(req.file, req.user!.id, req.user!.companyId);
    const id = generateId();
    await db.insert(plantItemAttachmentsTable).values({ id, plantItemId: req.params.itemId, uploadedBy: req.user!.id, name, kind, fileUrl, fileSize });
    await db.update(plantItemsTable).set({ lastUpdatedBy: req.user!.id, lastUpdatedAt: new Date() }).where(eq(plantItemsTable.id, req.params.itemId));
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "plant-materials", action: "create", itemType: "plant_item_attachment", itemId: id, req });

    const uploaderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    res.status(201).json({
      id, plantItemId: req.params.itemId, uploadedBy: req.user!.id, uploaderName: uploaderRows[0]?.name ?? "Unknown",
      name, kind, fileUrl, fileSize, createdAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Portal plant item attachment upload error");
    res.status(500).json({ error: "server_error", message: "Failed to upload attachment" });
  }
});

// ---- Daily Report — section gated on canEditDailyReport (minimal-portal
// redesign: this flag now doubles as visibility, not just write). Previously
// this was a structural section visible to every portal member like Team/
// Progress; that default was deliberately reversed per a later design pass.
// WRITE additionally requires the lock window: a report locks day-end + 24h
// grace; only the dashboard can amend a locked day. Dashboard and portal
// share upsertManagerReport (lib/daily-reports.ts) so they edit the exact
// same record — no forking. ----

const HISTORY_LIMIT = 14;

// GET /api/portal/daily-report — today's report, section-gated.
router.get("/portal/daily-report", authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const date = londonDateStr(new Date());
    const rows = await db.select().from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.projectId, pid), eq(dailyReportsTable.reportDate, date))).limit(1);
    const report = rows[0];
    const permRow = await db.select({ canEditDailyReport: projectMembersTable.canEditDailyReport })
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.userId, req.user!.id)))
      .limit(1);
    const locked = isReportLocked(date);
    // Submission privacy (user rule): a member only sees a day's report if
    // they contributed to it themselves. The PM's own diary entries stay
    // private to the dashboard — a day the PM started looks blank here, and
    // editing it is blocked (canEdit false) so the member can't blind-
    // overwrite or surface content they aren't meant to see.
    const contributors = report ? await contributorsForReport(report.id) : [];
    const mine = contributors.some(c => c.userId === req.user!.id);
    const hiddenFromMember = !!report && hasManagerContent(report.managerReport) && !mine;
    const submittedAt = !hiddenFromMember ? (report?.submittedAt ?? null) : null;
    res.json({
      reportDate: date,
      managerReport: report && !hiddenFromMember && hasManagerContent(report.managerReport) ? report.managerReport : null,
      contributors: hiddenFromMember ? [] : contributors,
      locked,
      // Once submitted, direct edits are blocked (append-only notes instead) —
      // separate from (and checked in addition to) the date-lock window above.
      canEdit: (permRow[0]?.canEditDailyReport ?? false) && !locked && !submittedAt && !hiddenFromMember,
      submittedAt: submittedAt ? submittedAt.toISOString() : null,
      submittedByName: !hiddenFromMember && report?.submittedBy ? await nameForPortalUser(report.submittedBy) : null,
      lifecycleStatus: submittedAt ? "submitted" : "draft",
      submissionNotes: report && !hiddenFromMember ? await notesFor("daily_report", report.id) : [],
    });
  } catch (err) {
    req.log.error({ err }, "Portal get daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to load report" });
  }
});

// GET /api/portal/daily-report/history — last HISTORY_LIMIT past days that
// have a site diary entry, newest first. Section-gated like the rest of Daily
// Report; always read-only within the section.
router.get("/portal/daily-report/history", authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const today = londonDateStr(new Date());
    const rows = await db.select().from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.projectId, pid), lt(dailyReportsTable.reportDate, today)))
      .orderBy(desc(dailyReportsTable.reportDate))
      .limit(HISTORY_LIMIT);
    const withContent = rows.filter(r => hasManagerContent(r.managerReport));
    // Submission privacy: history only shows days this member contributed to —
    // the PM's own diary days are private to the dashboard until shared.
    const visible: { r: typeof withContent[number]; contributors: { userId: string; name: string }[] }[] = [];
    for (const r of withContent) {
      const contributors = await contributorsForReport(r.id);
      if (contributors.some(c => c.userId === req.user!.id)) visible.push({ r, contributors });
    }
    res.json(await Promise.all(visible.map(async ({ r, contributors }) => ({
      reportDate: r.reportDate,
      managerReport: r.managerReport,
      contributors,
      lifecycleStatus: r.submittedAt ? "submitted" : "draft",
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      submittedByName: r.submittedBy ? await nameForPortalUser(r.submittedBy) : null,
    }))));
  } catch (err) {
    req.log.error({ err }, "Portal daily report history error");
    res.status(500).json({ error: "server_error", message: "Failed to load history" });
  }
});

// PATCH /api/portal/daily-report/:date — SAVE (draft only). Amends today's (or,
// within the grace window, yesterday's) site diary. 403 distinctly for "no
// permission" vs "locked" vs "already submitted" so the frontend can explain
// which applies — once submitted, further changes go through the notes
// endpoint instead of rewriting the original.
router.patch("/portal/daily-report/:date", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canEditDailyReport"), async (req, res) => {
  const pid = req.portalProjectId!;
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "validation_error", message: "date must be YYYY-MM-DD" }); return; }
  if (date > londonDateStr(new Date())) { res.status(400).json({ error: "validation_error", message: "Cannot edit a future date" }); return; }
  if (isReportLocked(date)) { res.status(403).json({ error: "locked", message: "This day's report is locked — ask your project manager to amend it from the dashboard." }); return; }
  try {
    const existing = await db.select({ id: dailyReportsTable.id, submittedAt: dailyReportsTable.submittedAt, managerReport: dailyReportsTable.managerReport }).from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.projectId, pid), eq(dailyReportsTable.reportDate, date))).limit(1);
    if (existing[0]?.submittedAt) { res.status(403).json({ error: "submitted", message: "This report has already been submitted — add a note instead." }); return; }
    // Submission privacy: a member can't edit a day the PM (or someone else)
    // already started unless they contributed to it — prevents both blind
    // overwrites and leaking the PM's private diary content via a save.
    if (existing[0] && hasManagerContent(existing[0].managerReport)) {
      const contributors = await contributorsForReport(existing[0].id);
      if (!contributors.some(c => c.userId === req.user!.id)) {
        res.status(403).json({ error: "forbidden", message: "This day's report was started by your project manager and isn't shared with you." });
        return;
      }
    }
    const result = await upsertManagerReport({ projectId: pid, companyId: req.user!.companyId, date, userId: req.user!.id, patch: req.body, req });
    if ("error" in result) { res.status(400).json({ error: "validation_error", message: "Enter at least one field" }); return; }
    res.json({ reportDate: date, managerReport: result.managerReport, contributors: await contributorsForReport(result.id), lifecycleStatus: "draft", submittedAt: null, submittedByName: null, submissionNotes: await notesFor("daily_report", result.id) });
  } catch (err) {
    req.log.error({ err }, "Portal update daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to save report" });
  }
});

// POST /api/portal/daily-report/:date/submit — locks today's site diary and
// surfaces it in the PM's report view for the first time. Requires actual
// content (an empty report has nothing to submit) and the same lock-window
// check as the PATCH above.
router.post("/portal/daily-report/:date/submit", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canEditDailyReport"), async (req, res) => {
  const pid = req.portalProjectId!;
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "validation_error", message: "date must be YYYY-MM-DD" }); return; }
  if (isReportLocked(date)) { res.status(403).json({ error: "locked", message: "This day's report is locked." }); return; }
  try {
    const rows = await db.select().from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.projectId, pid), eq(dailyReportsTable.reportDate, date))).limit(1);
    const report = rows[0];
    if (!report || !hasManagerContent(report.managerReport)) { res.status(400).json({ error: "validation_error", message: "Add some content before submitting." }); return; }
    if (report.submittedAt) { res.status(403).json({ error: "forbidden", message: "Already submitted." }); return; }
    // Submission privacy: members can only submit a report they contributed to.
    const submitContribs = await contributorsForReport(report.id);
    if (!submitContribs.some(c => c.userId === req.user!.id)) {
      res.status(403).json({ error: "forbidden", message: "This day's report was started by your project manager and isn't shared with you." });
      return;
    }

    await db.update(dailyReportsTable).set({ submittedAt: new Date(), submittedBy: req.user!.id }).where(eq(dailyReportsTable.id, report.id));
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "daily-reports", action: "update", itemType: "daily_report", itemId: report.id, metadata: { submitted: { from: false, to: true } }, req });

    const submittedByName = await nameForPortalUser(req.user!.id);
    res.json({
      reportDate: date, managerReport: report.managerReport, contributors: await contributorsForReport(report.id),
      lifecycleStatus: "submitted", submittedAt: new Date().toISOString(), submittedByName,
      submissionNotes: await notesFor("daily_report", report.id),
    });
  } catch (err) {
    req.log.error({ err }, "Portal submit daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to submit report" });
  }
});

// POST /api/portal/daily-report/:date/notes — append-only addition on a
// submitted report. Available to the reporter/any contributor and the PM;
// never rewrites the original managerReport fields.
router.post("/portal/daily-report/:date/notes", authenticate, requirePortalSession, requirePortalMember, requirePortalPermission("canEditDailyReport"), async (req, res) => {
  const pid = req.portalProjectId!;
  const date = req.params.date;
  try {
    const rows = await db.select().from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.projectId, pid), eq(dailyReportsTable.reportDate, date))).limit(1);
    const report = rows[0];
    if (!report || !report.submittedAt) { res.status(400).json({ error: "validation_error", message: "Submit this report before adding notes." }); return; }
    // Submission privacy: notes only on reports this member contributed to.
    const noteContribs = await contributorsForReport(report.id);
    if (!noteContribs.some(c => c.userId === req.user!.id)) {
      res.status(403).json({ error: "forbidden", message: "This report isn't shared with you." });
      return;
    }
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) { res.status(400).json({ error: "validation_error", message: "A note body is required." }); return; }

    await addNote({ itemType: "daily_report", itemId: report.id, projectId: pid, authorId: req.user!.id, body: body.trim() });
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "daily-reports", action: "update", itemType: "daily_report", itemId: report.id, req });

    res.status(201).json({
      reportDate: date, managerReport: report.managerReport, contributors: await contributorsForReport(report.id),
      lifecycleStatus: "submitted", submittedAt: report.submittedAt.toISOString(), submittedByName: report.submittedBy ? await nameForPortalUser(report.submittedBy) : null,
      submissionNotes: await notesFor("daily_report", report.id),
    });
  } catch (err) {
    req.log.error({ err }, "Portal add daily report note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

// GET /api/portal/general — general documents (GATED) + recent site notes (open).
router.get("/portal/general", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const gIds = await visibleIds(pid, "document", viewer);
  const [docs, notes] = await Promise.all([
    gIds.size ? db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, "general"), inArray(documentsTable.id, [...gIds]), inArray(documentsTable.status, ["current", "superseded"]))).orderBy(asc(documentsTable.name)) : Promise.resolve([]),
    db.select({
      id: dailyNotesTable.id, body: dailyNotesTable.body, noteDate: dailyNotesTable.noteDate,
      photoUrl: dailyNotesTable.photoUrl, authorName: usersTable.name,
    }).from(dailyNotesTable)
      .leftJoin(usersTable, eq(dailyNotesTable.authorId, usersTable.id))
      .where(eq(dailyNotesTable.projectId, pid))
      .orderBy(desc(dailyNotesTable.createdAt)).limit(20),
  ]);
  res.json({
    documents: docs.map(serializeDoc),
    notes: notes.map(n => ({ id: n.id, body: n.body, noteDate: n.noteDate, authorName: n.authorName ?? "Unknown", photoUrl: n.photoUrl ?? undefined })),
  });
});

// ---- My Documents (contractor self-upload with manager approval) ----
function serializeMemberDoc(d: typeof portalMemberDocumentsTable.$inferSelect) {
  return {
    id: d.id, name: d.name, kind: d.kind, fileUrl: d.fileUrl, fileSize: d.fileSize,
    status: d.status, reviewNote: d.reviewNote ?? undefined,
    reviewedAt: iso(d.reviewedAt), createdAt: d.createdAt.toISOString(),
  };
}

// GET /api/portal/my-documents — the signed-in member's own uploads for this
// project, newest first (with their current review status).
router.get("/portal/my-documents", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const rows = await db.select().from(portalMemberDocumentsTable)
    .where(and(eq(portalMemberDocumentsTable.projectId, pid), eq(portalMemberDocumentsTable.userId, req.user!.id)))
    .orderBy(desc(portalMemberDocumentsTable.createdAt));
  res.json(rows.map(serializeMemberDoc));
});

// POST /api/portal/my-documents — upload a document for manager review
// (multipart: file + name + kind). Saved to object storage, row starts pending.
router.post("/portal/my-documents", authenticate, requirePortalSession, requirePortalMember, memberUploadSingle("file"), async (req, res) => {
  const pid = req.portalProjectId!;
  if (!req.file) { res.status(400).json({ error: "validation_error", message: "No file provided" }); return; }
  const name = String(req.body?.name ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim() || "other";
  if (!name) { res.status(400).json({ error: "validation_error", message: "A document name is required." }); return; }

  try {
    const { fileUrl, fileSize } = await saveMemberUpload(req.file, req.user!.id, req.user!.companyId);

    // Resolve the uploader's person link (if any) for the PM-side listing.
    const member = (await db.select({ personId: projectMembersTable.personId }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.userId, req.user!.id))).limit(1))[0];

    const id = generateId();
    await db.insert(portalMemberDocumentsTable).values({
      id, projectId: pid, userId: req.user!.id, personId: member?.personId ?? null,
      name, fileUrl, fileSize, kind, status: "pending",
    });

    // Best-effort: notify the project's managers that a document awaits review.
    try {
      const proj = (await db.select({ name: projectsTable.name, companyId: projectsTable.companyId })
        .from(projectsTable).where(eq(projectsTable.id, pid)).limit(1))[0];
      if (proj) {
        const uploader = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1))[0];
        const managers = await db.select({ userId: companyMembersTable.userId })
          .from(companyMembersTable)
          .where(and(eq(companyMembersTable.companyId, proj.companyId), inArray(companyMembersTable.role, ["admin", "project_manager"])));
        const managerIds = [...new Set(managers.map(m => m.userId))];
        for (const userId of managerIds) {
          await db.insert(notificationsTable).values({
            id: generateId(), userId, type: "member_document_uploaded",
            title: `Document for review at ${proj.name}`,
            message: `${uploader?.name ?? "A member"} uploaded a document for review.`,
            relatedEntityId: pid, relatedEntityType: "project", read: false,
          });
        }
      }
    } catch { /* notifying managers is best-effort */ }

    const created = (await db.select().from(portalMemberDocumentsTable).where(eq(portalMemberDocumentsTable.id, id)).limit(1))[0];
    res.status(201).json(serializeMemberDoc(created));
  } catch (err) {
    req.log.error({ err }, "Portal my-documents upload error");
    res.status(500).json({ error: "server_error", message: "Failed to upload document" });
  }
});

export default router;
