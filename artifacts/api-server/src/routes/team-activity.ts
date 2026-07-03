import { Router, type IRouter } from "express";
import { randomBytes, createHash } from "crypto";
import { db } from "@workspace/db";
import {
  projectsTable, projectInvitesTable, projectMembersTable, usersTable, activityLogTable,
} from "@workspace/db/schema";
import { and, eq, desc, gte, lte, count, max } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendProjectInviteEmail } from "../lib/invite-email";
import { SECTION_LABELS } from "../lib/activity";
import { CreateProjectInviteBody, GetProjectActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Full copyable invite link. APP_URL wins; falls back to the Replit dev domain
// (mirrors the pattern used by the verification/reset emails).
function inviteBaseUrl(): string {
  return process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "www.sitesort.co.uk"}`;
}

async function loadOwnedProject(projectId: string, companyId: string) {
  const rows = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}

function serializeInvite(i: typeof projectInvitesTable.$inferSelect) {
  return {
    id: i.id, projectId: i.projectId, email: i.email, name: i.name, role: i.role, status: i.status,
    expiresAt: i.expiresAt.toISOString(),
    acceptedUserId: i.acceptedUserId ?? undefined,
    acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : undefined,
    revokedAt: i.revokedAt ? i.revokedAt.toISOString() : undefined,
    createdAt: i.createdAt.toISOString(),
  };
}

function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can manage the team." });
    return false;
  }
  return true;
}

// ---- Invites (PM) ----

// POST /api/projects/:projectId/invites — create a single-use, 7-day invite.
// "Sending" is deferred: the response includes the copyable link. Only the token
// hash is stored.
router.post("/projects/:projectId/invites", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const parsed = CreateProjectInviteBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "A name and email are required." }); return; }
    const email = parsed.data.email.trim().toLowerCase();
    const role = parsed.data.role ?? "worker";

    const rawToken = randomBytes(32).toString("hex");
    const id = generateId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(projectInvitesTable).values({
      id, projectId: req.params.projectId, companyId: req.user!.companyId,
      email, name: parsed.data.name.trim(), tokenHash: hashToken(rawToken), role,
      status: "pending", expiresAt, invitedByUserId: req.user!.id,
    });

    const inviteUrl = `${inviteBaseUrl()}/portal/accept/${rawToken}`;
    // Delivery deferred — never blocks the response (PM always has the link).
    void sendProjectInviteEmail({ email, name: parsed.data.name.trim(), projectName: project.name, inviteUrl });

    const rows = await db.select().from(projectInvitesTable).where(eq(projectInvitesTable.id, id)).limit(1);
    res.status(201).json({ invite: serializeInvite(rows[0]), inviteUrl });
  } catch (err) {
    req.log.error({ err }, "Create invite error");
    res.status(500).json({ error: "server_error", message: "Failed to create invite" });
  }
});

// GET /api/projects/:projectId/invites
router.get("/projects/:projectId/invites", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const rows = await db.select().from(projectInvitesTable)
      .where(eq(projectInvitesTable.projectId, req.params.projectId))
      .orderBy(desc(projectInvitesTable.createdAt));
    res.json(rows.map(serializeInvite));
  } catch (err) {
    req.log.error({ err }, "List invites error");
    res.status(500).json({ error: "server_error", message: "Failed to load invites" });
  }
});

// POST /api/projects/:projectId/invites/:inviteId/revoke — cut off access. If the
// invite was already accepted, the member's project_members row is deleted too,
// so requirePortalMember 403s them on the very next request (not just hidden UI).
router.post("/projects/:projectId/invites/:inviteId/revoke", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const rows = await db.select().from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.id, req.params.inviteId), eq(projectInvitesTable.projectId, req.params.projectId))).limit(1);
    const inv = rows[0];
    if (!inv) { res.status(404).json({ error: "not_found", message: "Invite not found" }); return; }

    await db.update(projectInvitesTable).set({ status: "revoked", revokedAt: new Date() }).where(eq(projectInvitesTable.id, inv.id));
    if (inv.acceptedUserId) {
      await db.delete(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, inv.acceptedUserId)));
    }
    res.json({ success: true, message: "Access revoked." });
  } catch (err) {
    req.log.error({ err }, "Revoke invite error");
    res.status(500).json({ error: "server_error", message: "Failed to revoke invite" });
  }
});

// ---- Activity reporting (PM) ----

// GET /api/projects/:projectId/activity — filterable feed of member views.
router.get("/projects/:projectId/activity", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const q = GetProjectActivityQueryParams.safeParse(req.query);
    const params = q.success ? q.data : {};
    const limit = Math.min(Math.max(Number(params.limit ?? 100), 1), 500);

    const conditions = [eq(activityLogTable.projectId, req.params.projectId)];
    if (params.memberId) conditions.push(eq(activityLogTable.userId, String(params.memberId)));
    if (params.section) conditions.push(eq(activityLogTable.section, String(params.section)));
    if (params.from) conditions.push(gte(activityLogTable.createdAt, new Date(`${String(params.from).slice(0, 10)}T00:00:00.000Z`)));
    if (params.to) conditions.push(lte(activityLogTable.createdAt, new Date(`${String(params.to).slice(0, 10)}T23:59:59.999Z`)));
    const where = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      db.select({
        id: activityLogTable.id, userId: activityLogTable.userId, section: activityLogTable.section,
        action: activityLogTable.action, itemType: activityLogTable.itemType, itemId: activityLogTable.itemId,
        createdAt: activityLogTable.createdAt, memberName: usersTable.name,
      }).from(activityLogTable)
        .leftJoin(usersTable, eq(activityLogTable.userId, usersTable.id))
        .where(where).orderBy(desc(activityLogTable.createdAt)).limit(limit),
      db.select({ total: count() }).from(activityLogTable).where(where),
    ]);

    res.json({
      total: Number(totalRows[0]?.total ?? 0),
      entries: rows.map(r => ({
        id: r.id, userId: r.userId, memberName: r.memberName ?? "Unknown",
        section: r.section, sectionLabel: SECTION_LABELS[r.section] ?? r.section,
        action: r.action, itemType: r.itemType ?? undefined, itemId: r.itemId ?? undefined,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get activity error");
    res.status(500).json({ error: "server_error", message: "Failed to load activity" });
  }
});

// GET /api/projects/:projectId/activity/summary — per-member rollup.
router.get("/projects/:projectId/activity/summary", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const pid = req.params.projectId;

    const [members, perSection, lastSeen] = await Promise.all([
      db.select({ userId: projectMembersTable.userId, role: projectMembersTable.role, name: usersTable.name })
        .from(projectMembersTable)
        .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
        .where(eq(projectMembersTable.projectId, pid)),
      db.select({ userId: activityLogTable.userId, section: activityLogTable.section, c: count() })
        .from(activityLogTable)
        .where(and(eq(activityLogTable.projectId, pid), eq(activityLogTable.action, "view")))
        .groupBy(activityLogTable.userId, activityLogTable.section),
      db.select({ userId: activityLogTable.userId, last: max(activityLogTable.createdAt) })
        .from(activityLogTable).where(eq(activityLogTable.projectId, pid)).groupBy(activityLogTable.userId),
    ]);

    const lastByUser = new Map(lastSeen.map(l => [l.userId, l.last]));
    const summaries = members.map(m => {
      const secs = perSection.filter(s => s.userId === m.userId);
      const totalViews = secs.reduce((sum, s) => sum + Number(s.c), 0);
      const topSections = [...secs].sort((a, b) => Number(b.c) - Number(a.c)).slice(0, 3)
        .map(s => ({ section: s.section, sectionLabel: SECTION_LABELS[s.section] ?? s.section, count: Number(s.c) }));
      const last = lastByUser.get(m.userId!);
      return {
        userId: m.userId!, memberName: m.name, role: m.role,
        lastActiveAt: last ? last.toISOString() : undefined,
        totalViews, topSections,
      };
    }).sort((a, b) => {
      // Most-recently-active first; never-active members last.
      if (!a.lastActiveAt && !b.lastActiveAt) return 0;
      if (!a.lastActiveAt) return 1;
      if (!b.lastActiveAt) return -1;
      return a.lastActiveAt < b.lastActiveAt ? 1 : -1;
    });

    res.json(summaries);
  } catch (err) {
    req.log.error({ err }, "Get activity summary error");
    res.status(500).json({ error: "server_error", message: "Failed to load activity summary" });
  }
});

export default router;
