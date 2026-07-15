import { Router, type IRouter } from "express";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable, projectsTable, projectMembersTable, projectInvitesTable,
  documentsTable, photosTable, permitsTable, milestonesTable, dailyNotesTable,
  qrBoardPinsTable, calendarEventsTable, subcontractorsTable, peopleTable,
  portalSharesTable, documentDistributionsTable, companiesTable, qrCodesTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, isNotNull, desc, asc, gte, count, max } from "drizzle-orm";
import { buildSiteBoardPayload } from "../lib/site-board";
import { generateId } from "../lib/id";
import { authenticate, generatePortalToken } from "../middlewares/auth";
import { requirePortalMember, requirePortalSession, autoLogPortalActivity } from "../middlewares/portal";
import { createPortalSession, revokePortalSession } from "../lib/portal-sessions";
import { getVapidPublicKey } from "../lib/web-push";
import { pushSubscriptionsTable, activityLogTable } from "@workspace/db/schema";
import { PortalPushSubscribeBody, PortalPushUnsubscribeBody } from "@workspace/api-zod";
import { isLockedOut, recordFailedAttempt, clearAttempts } from "../lib/login-attempts";
import { expiryStatus } from "../lib/expiry";
import { PORTAL_SECTIONS } from "../lib/activity";
import { PortalLoginBody, AcceptPortalInviteBody } from "@workspace/api-zod";

const router: IRouter = Router();

// The middleware chain every read-only member endpoint runs: verify the portal
// token → enforce the server-side session (sliding 30d / 12h inactivity / revoke)
// → re-check membership → auto-log the view. No per-page manual logging anywhere.
const portalGuards = [authenticate, requirePortalSession, requirePortalMember, autoLogPortalActivity];

// Only the token HASH is ever stored, so a DB leak can't be replayed.
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

// ---- serializers (shape-match the OpenAPI Portal* schemas) ----
function serializeDoc(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id, name: d.name, type: d.type, version: d.version,
    revision: d.revision ?? undefined, fileUrl: d.fileUrl, fileSize: d.fileSize,
    status: d.status, createdAt: d.createdAt.toISOString(),
  };
}
function serializePermit(p: typeof permitsTable.$inferSelect) {
  return {
    id: p.id, type: p.type, description: p.description,
    startDate: p.startDate, expiryDate: p.expiryDate,
    status: expiryStatus(p.expiryDate), documentUrl: p.documentUrl ?? undefined,
  };
}
function serializeIssue(p: typeof photosTable.$inferSelect) {
  return {
    id: p.id, category: p.category, description: p.description ?? undefined,
    zone: p.zone ?? undefined, referenceNumber: p.referenceNumber,
    status: p.status ?? undefined, photoUrl: p.photoUrl ?? undefined,
    takenAt: p.takenAt.toISOString(),
    latitude: p.latitude ?? undefined, longitude: p.longitude ?? undefined,
  };
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
  const [docMap, photoMap, permitMap, lastView] = await Promise.all([
    visibleShareMap(projectId, "document", viewer),
    visibleShareMap(projectId, "photo", viewer),
    visibleShareMap(projectId, "permit", viewer),
    lastViewedBySection(userId, projectId),
  ]);
  const lv = (s: string) => lastView.get(s);
  const counts: Record<string, number> = {};
  const bump = (s: string, n = 1) => { if (n) counts[s] = (counts[s] ?? 0) + n; };

  // Gated documents, by type → their section; plus the aggregate "shared".
  const docIds = [...docMap.keys()];
  const docs = docIds.length
    ? await db.select({ id: documentsTable.id, type: documentsTable.type }).from(documentsTable)
        .where(and(eq(documentsTable.projectId, projectId), inArray(documentsTable.id, docIds), inArray(documentsTable.status, ["current", "superseded"])))
    : [];
  const sectionForType = (t: string) => t === "drawing" ? "drawings" : t === "method_statement" ? "method-statements" : t === "general" ? "general" : null;
  let sharedCount = 0;
  for (const d of docs) {
    const at = docMap.get(d.id);
    if (isAfter(at, lv("shared"))) sharedCount++;
    const sec = sectionForType(d.type);
    if (sec && isAfter(at, lv(sec))) bump(sec);
  }
  for (const at of photoMap.values()) { if (isAfter(at, lv("shared"))) sharedCount++; if (isAfter(at, lv("site-issues"))) bump("site-issues"); }
  for (const at of permitMap.values()) { if (isAfter(at, lv("shared"))) sharedCount++; if (isAfter(at, lv("permits"))) bump("permits"); }
  bump("shared", sharedCount);

  // Safety docs are always visible (never gated) → new ones are unseen too.
  const safetyDocs = await db.select({ createdAt: documentsTable.createdAt }).from(documentsTable)
    .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.type, "safety"), eq(documentsTable.status, "current")));
  for (const s of safetyDocs) if (isAfter(s.createdAt, lv("safety"))) bump("safety");

  // Site updates (daily notes) drive Overview + General badges.
  const notes = await db.select({ createdAt: dailyNotesTable.createdAt }).from(dailyNotesTable).where(eq(dailyNotesTable.projectId, projectId));
  for (const n of notes) { if (isAfter(n.createdAt, lv("overview"))) bump("overview"); if (isAfter(n.createdAt, lv("general"))) bump("general"); }

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

    // Membership (user ↔ project) carrying the person link. If a membership row
    // already exists for this user+project, set person_id on it; else insert one.
    const existingMember = (await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, inv.projectId), eq(projectMembersTable.userId, userId))).limit(1))[0];
    if (existingMember) {
      await db.update(projectMembersTable).set({ personId: inv.personId ?? null }).where(eq(projectMembersTable.id, existingMember.id));
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
  const urow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  res.json({
    project: serializeProject(proj, await computeProgress(pid)),
    member: { name: urow[0]?.name ?? "", role: req.portalMemberRole ?? "worker", email: req.user!.email },
    sections: PORTAL_SECTIONS,
  });
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
  const viewer = await resolveViewer(req.user!.id, pid);
  const [photoVisible, permitVisible] = await Promise.all([visibleIds(pid, "photo", viewer), visibleIds(pid, "permit", viewer)]);
  const [openIssueRows, permitRows, milestonesRows, teamRows, notes] = await Promise.all([
    photoVisible.size ? db.select({ id: photosTable.id }).from(photosTable).where(and(
      eq(photosTable.projectId, pid),
      inArray(photosTable.category, ["snag", "safety_concern"]),
      inArray(photosTable.status, ["open", "in_progress"]),
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
      .orderBy(desc(dailyNotesTable.createdAt)).limit(5),
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
// (the "Shared with me" landing). Safety docs are included as always-available.
router.get("/portal/shared", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const [docMap, photoMap, permitMap, lastView] = await Promise.all([
    visibleShareMap(pid, "document", viewer),
    visibleShareMap(pid, "photo", viewer),
    visibleShareMap(pid, "permit", viewer),
    lastViewedBySection(req.user!.id, pid),
  ]);
  const seenBefore = lastView.get("shared");
  const docIds = [...docMap.keys()], photoIds = [...photoMap.keys()], permitIds = [...permitMap.keys()];
  const [docs, photos, permits] = await Promise.all([
    docIds.length ? db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), inArray(documentsTable.id, docIds), inArray(documentsTable.status, ["current", "superseded"]))) : Promise.resolve([]),
    photoIds.length ? db.select().from(photosTable).where(and(eq(photosTable.projectId, pid), inArray(photosTable.id, photoIds))) : Promise.resolve([]),
    permitIds.length ? db.select().from(permitsTable).where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt), inArray(permitsTable.id, permitIds))) : Promise.resolve([]),
  ]);
  // Annotate each item with when it was shared + whether it's unseen, and order
  // NEWEST-shared first so fresh content is at the top with the unseen highlight.
  const annotate = <T extends { id: string }>(rows: T[], serialize: (r: T) => any, map: Map<string, Date>) =>
    rows
      .map(r => { const at = map.get(r.id); return { ...serialize(r), sharedAt: at?.toISOString(), _at: at?.getTime() ?? 0, unseen: isAfter(at, seenBefore) }; })
      .sort((a, b) => b._at - a._at)
      .map(({ _at, ...rest }) => rest);
  res.json({
    documents: annotate(docs, serializeDoc, docMap),
    photos: annotate(photos, serializeIssue, photoMap),
    permits: annotate(permits, serializePermit, permitMap),
  });
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
  const [people, users] = await Promise.all([
    personIds.length ? db.select().from(peopleTable).where(inArray(peopleTable.id, personIds)) : Promise.resolve([]),
    userIds.length ? db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds)) : Promise.resolve([]),
  ]);
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

  const result = members.map(m => {
    // A portal member (person link) carries the richest info: name + firm + job title.
    const person = m.personId ? personById.get(m.personId) : undefined;
    if (person) {
      const sub = person.subcontractorId ? subById.get(person.subcontractorId) : undefined;
      const user = m.userId ? userById.get(m.userId) : undefined;
      const contact = showsContact(person.showContactInPortal, m.role);
      return {
        name: person.name,
        company: sub ? sub.companyName : ourCompany,
        jobTitle: person.roleTitle ?? undefined,
        role: m.role,
        trades: sub?.trades ?? [],
        ...(contact ? { email: person.email ?? undefined, phone: (person.phone ?? user?.phone) ?? undefined } : {}),
      };
    }
    const sub = m.subcontractorId ? subById.get(m.subcontractorId) : undefined;
    if (sub) {
      const contact = showsContact(null, "subcontractor");
      return { name: sub.contactName, company: sub.companyName, jobTitle: undefined, role: "subcontractor", trades: sub.trades ?? [], ...(contact ? { email: sub.contactEmail ?? undefined, phone: sub.contactPhone ?? undefined } : {}) };
    }
    const user = m.userId ? userById.get(m.userId) : undefined;
    const contact = showsContact(null, m.role);
    return { name: user?.name ?? "Unknown", company: ourCompany, jobTitle: undefined, role: m.role, trades: [], ...(contact ? { email: user?.email ?? undefined, phone: user?.phone ?? undefined } : {}) };
  });
  res.json(result);
});

// GET /api/portal/site-issues — GATED to shared photos.
router.get("/portal/site-issues", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const viewer = await resolveViewer(req.user!.id, pid);
  const ids = await visibleIds(pid, "photo", viewer);
  if (ids.size === 0) { res.json([]); return; }
  const rows = await db.select().from(photosTable)
    .where(and(eq(photosTable.projectId, pid), inArray(photosTable.category, ["snag", "safety_concern"]), inArray(photosTable.id, [...ids])))
    .orderBy(desc(photosTable.takenAt));
  res.json(rows.map(serializeIssue));
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
      res.json(rows.map(serializeDoc));
      return;
    }
    const viewer = await resolveViewer(req.user!.id, pid);
    const ids = await visibleIds(pid, "document", viewer);
    if (ids.size === 0) { res.json([]); return; }
    const rows = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.projectId, pid), eq(documentsTable.type, type), inArray(documentsTable.id, [...ids]), inArray(documentsTable.status, ["current", "superseded"])))
      .orderBy(asc(documentsTable.name));
    res.json(rows.map(serializeDoc));
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
    res.json(serializeDoc(rows[0]));
  };
}

// GET /api/portal/drawings (+ /:documentId)
router.get("/portal/drawings", ...portalGuards, docListHandler("drawing"));
router.get("/portal/drawings/:documentId", ...portalGuards, docDetailHandler("drawing"));

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

export default router;
