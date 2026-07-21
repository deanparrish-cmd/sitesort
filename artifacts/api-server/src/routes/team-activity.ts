import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  projectsTable, projectInvitesTable, projectMembersTable, usersTable, activityLogTable,
} from "@workspace/db/schema";
import { and, eq, desc, gte, lte, count, max } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { revokePortalSessionsForMember } from "../lib/portal-sessions";
import { removedFromProjectUserIds } from "../lib/project-membership";
import { SECTION_LABELS } from "../lib/activity";
import { GetProjectActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

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
// NOTE: invites are CREATED per-individual-person via the single invite path in
// `routes/people.ts` (POST /projects/:projectId/portal-invites). This router now
// only READS/manages them (list, revoke) + activity reporting — one source of
// truth, no duplicate create path (the old name+email form was removed).

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
    // Cut portal access immediately by removing the membership row. Prefer the
    // person link (the portal membership this invite created); fall back to the
    // accepted user for legacy invites that predate person_id.
    if (inv.personId) {
      const mem = (await db.select({ id: projectMembersTable.id, userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.personId, inv.personId))).limit(1))[0];
      if (mem) {
        if (!mem.userId) {
          // Still pending — never accepted, so there's no session to kill and no
          // account to detach. This row is their project team membership (the
          // person-first add flow creates it independently of any invite), so
          // keep it; just reset any section permissions a PM pre-set for this
          // invite, since they no longer apply once it's cancelled.
          await db.update(projectMembersTable).set({ canLogIssues: false, canUpdatePlantMaterials: false, canEditDailyReport: false }).where(eq(projectMembersTable.id, mem.id));
        } else {
          // Accepted. For a portalOnly account there's no team role to keep, so
          // remove the row entirely; for a dashboard (in-house) account, keep
          // the row + team role and just drop the portal grant.
          const portalOnly = (await db.select({ p: usersTable.portalOnly }).from(usersTable).where(eq(usersTable.id, mem.userId)).limit(1))[0]?.p === true;
          if (portalOnly) await db.delete(projectMembersTable).where(eq(projectMembersTable.id, mem.id));
          else await db.update(projectMembersTable).set({ personId: null }).where(eq(projectMembersTable.id, mem.id));
          // Kill any live portal session immediately (the membership re-check would
          // also 403 them, but this ends the session cleanly + server-side at once).
          await revokePortalSessionsForMember(mem.userId, req.params.projectId);
        }
      }
    } else if (inv.acceptedUserId) {
      await db.delete(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, inv.acceptedUserId)));
      await revokePortalSessionsForMember(inv.acceptedUserId, req.params.projectId);
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

    const removedIds = await removedFromProjectUserIds(req.params.projectId, rows.map(r => r.userId));
    res.json({
      total: Number(totalRows[0]?.total ?? 0),
      entries: rows.map(r => ({
        id: r.id, userId: r.userId, memberName: r.memberName ?? "Unknown",
        section: r.section, sectionLabel: SECTION_LABELS[r.section] ?? r.section,
        action: r.action, itemType: r.itemType ?? undefined, itemId: r.itemId ?? undefined,
        removedFromProject: removedIds.has(r.userId),
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
