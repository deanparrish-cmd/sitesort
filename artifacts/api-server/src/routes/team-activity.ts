import { Router, type IRouter } from "express";
import { lastOldLinkRefusals } from "./people";
import { db } from "@workspace/db";
import {
  projectsTable, projectInvitesTable, projectMembersTable, usersTable, activityLogTable, portalSessionsTable,
} from "@workspace/db/schema";
import { and, eq, desc, gte, lte, count, max, inArray, isNull, isNotNull } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { allow, COMPANY_MANAGER } from "../lib/authz";
import { revokePortalSessionsForMember } from "../lib/portal-sessions";
import { revokeAcceptedInvitesOfLogin } from "../lib/card-removal";
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

function serializeInvite(i: typeof projectInvitesTable.$inferSelect, refusedAt?: Date) {
  const outdated = i.status === "pending" && !i.emailOnly;
  return {
    ...(outdated ? { linkOutdated: true, oldLinkRefusedAt: refusedAt?.toISOString() } : {}),
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
router.get("/projects/:projectId/invites", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const rows = await db.select().from(projectInvitesTable)
      .where(eq(projectInvitesTable.projectId, req.params.projectId))
      .orderBy(desc(projectInvitesTable.createdAt));
    const refused = await lastOldLinkRefusals(rows.filter(r => r.status === "pending" && !r.emailOnly).map(r => r.id));
    res.json(rows.map(r => serializeInvite(r, refused.get(r.id))));
  } catch (err) {
    req.log.error({ err }, "List invites error");
    res.status(500).json({ error: "server_error", message: "Failed to load invites" });
  }
});

// POST /api/projects/:projectId/invites/:inviteId/revoke — cut off access. If the
// invite was already accepted, the member's project_members row is deleted too,
// so requirePortalMember 403s them on the very next request (not just hidden UI).
router.post("/projects/:projectId/invites/:inviteId/revoke", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const rows = await db.select().from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.id, req.params.inviteId), eq(projectInvitesTable.projectId, req.params.projectId))).limit(1);
    const inv = rows[0];
    if (!inv) { res.status(404).json({ error: "not_found", message: "Invite not found" }); return; }

    await db.update(projectInvitesTable).set({ status: "revoked", revokedAt: new Date() }).where(eq(projectInvitesTable.id, inv.id));
    // Revoke is a safety action, so it acts on EVERY membership row of this
    // card, never one picked by .limit(1): a card can carry a stale duplicate
    // row (Amy, 2026-10-20), and picking it used to reset that row, leave the
    // real row and the live session alone, and still answer "Access revoked."
    const logins = new Set<string>();
    if (inv.personId) {
      // The card's other live invites go too: the boot repair recreates a row
      // for any accepted invite whose login has no row.
      await db.update(projectInvitesTable).set({ status: "revoked", revokedAt: new Date() })
        .where(and(
          eq(projectInvitesTable.projectId, req.params.projectId),
          eq(projectInvitesTable.personId, inv.personId),
          inArray(projectInvitesTable.status, ["pending", "accepted"]),
        ));
      const mems = await db.select({ id: projectMembersTable.id, userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.personId, inv.personId)));
      for (const mem of mems) {
        if (!mem.userId) {
          // No login on this row (never accepted, or a stale duplicate). It is
          // their project team membership, so keep it; just reset the section
          // permissions, which no longer apply once the invite is cancelled.
          await db.update(projectMembersTable).set({ canLogIssues: false, canUpdatePlantMaterials: false, canEditDailyReport: false }).where(eq(projectMembersTable.id, mem.id));
        } else {
          // Accepted. A portalOnly account has no team role to keep, so the row
          // goes; a dashboard (in-house) account keeps the row and team role and
          // just loses the portal grant.
          const portalOnly = (await db.select({ p: usersTable.portalOnly }).from(usersTable).where(eq(usersTable.id, mem.userId)).limit(1))[0]?.p === true;
          if (portalOnly) await db.delete(projectMembersTable).where(eq(projectMembersTable.id, mem.id));
          else await db.update(projectMembersTable).set({ personId: null, canLogIssues: false, canUpdatePlantMaterials: false, canEditDailyReport: false }).where(eq(projectMembersTable.id, mem.id));
          logins.add(mem.userId);
        }
      }
    } else if (inv.acceptedUserId) {
      await db.delete(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, inv.acceptedUserId)));
      logins.add(inv.acceptedUserId);
    }
    if (inv.acceptedUserId) logins.add(inv.acceptedUserId);
    for (const login of logins) {
      // Whole-login revoke: no invite this login accepted here may survive, or
      // the boot repair would re-attach it to another of its cards' rows.
      await revokeAcceptedInvitesOfLogin(login, req.params.projectId);
      await revokePortalSessionsForMember(login, req.params.projectId);
    }

    // Never confirm a safety action that didn't happen: every login this
    // revoke touched must have no portal row and no live session left here.
    const remaining: string[] = [];
    for (const login of logins) {
      const row = (await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, login), isNotNull(projectMembersTable.personId))).limit(1))[0];
      const live = (await db.select({ id: portalSessionsTable.id }).from(portalSessionsTable)
        .where(and(eq(portalSessionsTable.projectId, req.params.projectId), eq(portalSessionsTable.userId, login), isNull(portalSessionsTable.revokedAt))).limit(1))[0];
      if (row || live) remaining.push(login);
    }
    if (remaining.length) {
      req.log.error({ inviteId: inv.id, remaining }, "Revoke left portal access in place");
      res.status(500).json({ error: "revoke_incomplete", message: "Portal access could not be fully removed. Try again, or remove them from the project." });
      return;
    }
    res.json({ success: true, message: "Access revoked." });
  } catch (err) {
    req.log.error({ err }, "Revoke invite error");
    res.status(500).json({ error: "server_error", message: "Failed to revoke invite" });
  }
});

// ---- Activity reporting (PM) ----

// GET /api/projects/:projectId/activity — filterable feed of member views.
router.get("/projects/:projectId/activity", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
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
router.get("/projects/:projectId/activity/summary", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
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
