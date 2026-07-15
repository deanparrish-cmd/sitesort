import { Router, type IRouter } from "express";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable, projectsTable, projectMembersTable, projectInvitesTable,
  documentsTable, photosTable, permitsTable, milestonesTable, dailyNotesTable,
  qrBoardPinsTable, calendarEventsTable, subcontractorsTable, peopleTable,
  portalSharesTable, documentDistributionsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, isNotNull, desc, asc, gte, count } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate, generatePortalToken } from "../middlewares/auth";
import { requirePortalMember, autoLogPortalActivity } from "../middlewares/portal";
import { isLockedOut, recordFailedAttempt, clearAttempts } from "../lib/login-attempts";
import { expiryStatus } from "../lib/expiry";
import { PORTAL_SECTIONS } from "../lib/activity";
import { PortalLoginBody, AcceptPortalInviteBody } from "@workspace/api-zod";

const router: IRouter = Router();

// The three-middleware chain every read-only member endpoint runs: verify the
// portal token → re-check membership → auto-log the view. No per-page manual
// logging anywhere.
const portalGuards = [authenticate, requirePortalMember, autoLogPortalActivity];

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
    const token = generatePortalToken({ id: user.id, email: user.email, companyId: user.companyId, projectId: target.projectId, role: target.role });
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
    const token = generatePortalToken({ id: userId, email, companyId: userCompanyId, projectId: inv.projectId, role: inv.role });
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

// GET /api/portal/overview
router.get("/portal/overview", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const proj = await loadProject(pid);
  if (!proj) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
  const [issues, milestonesRows, permitsRows, teamRows, notes] = await Promise.all([
    db.select({ total: count() }).from(photosTable).where(and(
      eq(photosTable.projectId, pid),
      inArray(photosTable.category, ["snag", "safety_concern"]),
      inArray(photosTable.status, ["open", "in_progress"]),
    )),
    db.select({ completedAt: milestonesTable.completedAt }).from(milestonesTable).where(eq(milestonesTable.projectId, pid)),
    db.select({ total: count() }).from(permitsTable).where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt))),
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
  res.json({
    project: serializeProject(proj, progressPercent),
    stats: {
      openIssues: Number(issues[0]?.total ?? 0),
      upcomingMilestones: milestonesRows.filter(m => m.completedAt === null).length,
      activePermits: Number(permitsRows[0]?.total ?? 0),
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
  const [docIds, photoIds, permitIds] = await Promise.all([
    visibleIds(pid, "document", viewer),
    visibleIds(pid, "photo", viewer),
    visibleIds(pid, "permit", viewer),
  ]);
  const [docs, photos, permits] = await Promise.all([
    docIds.size ? db.select().from(documentsTable).where(and(eq(documentsTable.projectId, pid), inArray(documentsTable.id, [...docIds]), inArray(documentsTable.status, ["current", "superseded"]))).orderBy(asc(documentsTable.name)) : Promise.resolve([]),
    photoIds.size ? db.select().from(photosTable).where(and(eq(photosTable.projectId, pid), inArray(photosTable.id, [...photoIds]))).orderBy(desc(photosTable.takenAt)) : Promise.resolve([]),
    permitIds.size ? db.select().from(permitsTable).where(and(eq(permitsTable.projectId, pid), isNull(permitsTable.archivedAt), inArray(permitsTable.id, [...permitIds]))).orderBy(asc(permitsTable.expiryDate)) : Promise.resolve([]),
  ]);
  res.json({ documents: docs.map(serializeDoc), photos: photos.map(serializeIssue), permits: permits.map(serializePermit) });
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

// GET /api/portal/team
router.get("/portal/team", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const userMembers = await db.select({
    role: projectMembersTable.role, name: usersTable.name, phone: usersTable.phone, avatarUrl: usersTable.avatarUrl,
  }).from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, pid));
  const subMembers = await db.select({
    contactName: subcontractorsTable.contactName, companyName: subcontractorsTable.companyName,
    phone: subcontractorsTable.contactPhone, avatarUrl: subcontractorsTable.avatarUrl, trades: subcontractorsTable.trades,
  }).from(projectMembersTable)
    .innerJoin(subcontractorsTable, eq(projectMembersTable.subcontractorId, subcontractorsTable.id))
    .where(eq(projectMembersTable.projectId, pid));
  res.json([
    ...userMembers.map(m => ({ name: m.name, role: m.role, type: "user", phone: m.phone ?? undefined, avatarUrl: m.avatarUrl ?? undefined })),
    ...subMembers.map(s => ({ name: `${s.contactName} · ${s.companyName}`, role: "subcontractor", type: "subcontractor", phone: s.phone ?? undefined, avatarUrl: s.avatarUrl ?? undefined, trades: s.trades ?? [] })),
  ]);
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

// GET /api/portal/site-board — pinned items + upcoming events.
router.get("/portal/site-board", ...portalGuards, async (req, res) => {
  const pid = req.portalProjectId!;
  const proj = await loadProject(pid);
  if (!proj) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
  const pins = await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, pid));
  const docIds = pins.filter(p => p.itemType === "document").map(p => p.itemId);
  const photoIds = pins.filter(p => p.itemType === "photo").map(p => p.itemId);
  const permitIds = pins.filter(p => p.itemType === "permit").map(p => p.itemId);

  const [docs, photos, permits, events] = await Promise.all([
    docIds.length ? db.select().from(documentsTable).where(inArray(documentsTable.id, docIds)) : Promise.resolve([]),
    photoIds.length ? db.select().from(photosTable).where(inArray(photosTable.id, photoIds)) : Promise.resolve([]),
    permitIds.length ? db.select().from(permitsTable).where(and(inArray(permitsTable.id, permitIds), isNull(permitsTable.archivedAt))) : Promise.resolve([]),
    db.select().from(calendarEventsTable).where(and(
      eq(calendarEventsTable.companyId, proj.companyId),
      gte(calendarEventsTable.eventDate, new Date().toISOString().slice(0, 10)),
    )).orderBy(asc(calendarEventsTable.eventDate)).limit(20),
  ]);
  res.json({
    documents: docs.map(serializeDoc),
    photos: photos.map(serializeIssue),
    permits: permits.map(serializePermit),
    upcomingEvents: events
      .filter(e => e.projectId === null || e.projectId === pid)
      .map(e => ({ id: e.id, title: e.title, eventDate: e.eventDate, note: e.note ?? undefined, scope: e.projectId ? "project" : "company" })),
  });
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
