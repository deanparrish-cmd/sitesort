import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, usersTable, documentsTable, documentDistributionsTable, permitsTable, notificationsTable, subcontractorsTable, companiesTable, milestonesTable, photosTable, dailyNotesTable } from "@workspace/db/schema";
import { eq, and, count, sql, asc, desc, isNotNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { isValidTimeZone, isValidCloseTime, safeTz, siteTzLabel } from "../lib/site-clock";
import { isProjectApprover, COMPANY_MANAGER_ROLES } from "../lib/project-authority";
import { allow, COMPANY_MANAGER, INTERNAL_STAFF, projectApprover } from "../lib/authz";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

async function computeProgress(projectId: string): Promise<number> {
  const rows = await db.select({ completedAt: milestonesTable.completedAt })
    .from(milestonesTable).where(eq(milestonesTable.projectId, projectId));
  if (rows.length === 0) return 0;
  const done = rows.filter(r => r.completedAt !== null).length;
  return Math.round((done / rows.length) * 100);
}

// The "N Alerts" badge counts PENDING document-sign-off recipients, not
// distinct documents (matches compliance.ts's pendingAcknowledgments
// semantics). When every pending recipient belongs to the SAME document,
// that document's id is returned so the badge can deep-link straight to it
// instead of just the tab (Bug: badges naming a specific thing must link to
// it — see CLAUDE.md's deep-link rule). Ambiguous (multiple documents) →
// null, and the tab-level link is the correct fallback.
async function docAlertsFor(projectId: string): Promise<{ alertCount: number; alertDocumentId: string | null }> {
  const rows = await db.select({ documentId: documentDistributionsTable.documentId })
    .from(documentDistributionsTable)
    .innerJoin(documentsTable, eq(documentsTable.id, documentDistributionsTable.documentId))
    .where(and(eq(documentsTable.projectId, projectId), eq(documentDistributionsTable.status, "pending")));
  const uniqueDocIds = [...new Set(rows.map(r => r.documentId))];
  return { alertCount: rows.length, alertDocumentId: uniqueDocIds.length === 1 ? uniqueDocIds[0] : null };
}

type ActivityItem = { id: string; type: string; description: string; userId: string | null; userName: string | null; createdAt: string };

async function getRecentActivity(projectId: string, limit = 8): Promise<ActivityItem[]> {
  const [docs, photos, notes, milestones] = await Promise.all([
    db.select({ id: documentsTable.id, name: documentsTable.name, createdAt: documentsTable.createdAt, userId: documentsTable.uploadedBy, userName: usersTable.name })
      .from(documentsTable)
      .innerJoin(usersTable, eq(usersTable.id, documentsTable.uploadedBy))
      .where(eq(documentsTable.projectId, projectId))
      .orderBy(desc(documentsTable.createdAt))
      .limit(limit),
    db.select({ id: photosTable.id, description: photosTable.description, referenceNumber: photosTable.referenceNumber, createdAt: photosTable.takenAt, userId: photosTable.uploadedBy, userName: usersTable.name })
      .from(photosTable)
      .innerJoin(usersTable, eq(usersTable.id, photosTable.uploadedBy))
      .where(and(eq(photosTable.projectId, projectId), isNotNull(photosTable.submittedAt)))
      .orderBy(desc(photosTable.takenAt))
      .limit(limit),
    db.select({ id: dailyNotesTable.id, body: dailyNotesTable.body, createdAt: dailyNotesTable.createdAt, userId: dailyNotesTable.authorId, userName: usersTable.name })
      .from(dailyNotesTable)
      .innerJoin(usersTable, eq(usersTable.id, dailyNotesTable.authorId))
      .where(eq(dailyNotesTable.projectId, projectId))
      .orderBy(desc(dailyNotesTable.createdAt))
      .limit(limit),
    db.select({ id: milestonesTable.id, title: milestonesTable.title, completedAt: milestonesTable.completedAt })
      .from(milestonesTable)
      .where(and(eq(milestonesTable.projectId, projectId), isNotNull(milestonesTable.completedAt)))
      .orderBy(desc(milestonesTable.completedAt))
      .limit(limit),
  ]);

  const items: { id: string; type: string; description: string; userId: string | null; userName: string | null; createdAt: Date }[] = [
    ...docs.map(d => ({ id: `document-${d.id}`, type: "document_uploaded", description: `${d.name} uploaded`, userId: d.userId, userName: d.userName, createdAt: d.createdAt })),
    ...photos.map(p => ({ id: `photo-${p.id}`, type: "photo_logged", description: `Photo logged${p.description ? `: ${p.description}` : ` (${p.referenceNumber})`}`, userId: p.userId, userName: p.userName, createdAt: p.createdAt })),
    ...notes.map(n => ({ id: `note-${n.id}`, type: "note_posted", description: `Site update posted: "${n.body.length > 60 ? `${n.body.slice(0, 60)}…` : n.body}"`, userId: n.userId, userName: n.userName, createdAt: n.createdAt })),
    ...milestones.map(m => ({ id: `milestone-${m.id}`, type: "milestone_completed", description: `Milestone completed: ${m.title}`, userId: null, userName: null, createdAt: m.completedAt! })),
  ];

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit).map(it => ({ ...it, createdAt: it.createdAt.toISOString() }));
}

const PLAN_PROJECT_LIMITS: Record<string, number> = {
  free: 1,
  solo: 1,
  team: 5,
  pro: Infinity,
};

function planProjectLimit(tier: string, status: string): number {
  if (status === "cancelled") return 1;
  return PLAN_PROJECT_LIMITS[tier] ?? 1;
}

router.get("/projects", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).where(eq(projectsTable.companyId, req.user!.companyId));

    const result = await Promise.all(projects.map(async (p) => {
      const [memberCount] = await db.select({ count: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, p.id));
      const { alertCount, alertDocumentId } = await docAlertsFor(p.id);

      const progressPercent = await computeProgress(p.id);
      return {
        id: p.id,
        companyId: p.companyId,
        name: p.name,
        address: p.address,
        status: p.status,
        startDate: p.startDate,
        targetEndDate: p.targetEndDate ?? null,
        createdAt: p.createdAt.toISOString(),
        memberCount: Number(memberCount.count),
        alertCount,
        alertDocumentId,
        progressPercent,
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List projects error");
    res.status(500).json({ error: "server_error", message: "Failed to list projects" });
  }
});

router.post("/projects", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    // Creating a project uses the plan's project allowance, so it's for company
    // admins / project managers only (matches the New Project button).
    if (!COMPANY_MANAGER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can create a project" });
      return;
    }
    const { name, address, startDate, targetEndDate } = req.body;
    if (!name || !address || !startDate) {
      res.status(400).json({ error: "validation_error", message: "name, address, startDate required" });
      return;
    }

    const companyRows = await db
      .select({ subscriptionTier: companiesTable.subscriptionTier, subscriptionStatus: companiesTable.subscriptionStatus, betaAccess: companiesTable.betaAccess })
      .from(companiesTable)
      .where(eq(companiesTable.id, req.user!.companyId))
      .limit(1);
    const { subscriptionTier, subscriptionStatus, betaAccess } = companyRows[0] ?? { subscriptionTier: "free", subscriptionStatus: "active", betaAccess: false };
    // Beta companies are off-billing with full access — no plan cap applies.
    const limit = betaAccess ? Infinity : planProjectLimit(subscriptionTier, subscriptionStatus);

    if (limit !== Infinity) {
      const [{ total }] = await db.select({ total: count() }).from(projectsTable)
        .where(eq(projectsTable.companyId, req.user!.companyId));
      if (Number(total) >= limit) {
        res.status(403).json({
          error: "plan_limit",
          message: `Your ${subscriptionTier} plan allows up to ${limit} project${limit === 1 ? "" : "s"}. Upgrade to add more.`,
          limit,
          currentTier: subscriptionTier,
        });
        return;
      }
    }

    const id = generateId();
    await db.insert(projectsTable).values({
      id,
      companyId: req.user!.companyId,
      name,
      address,
      startDate,
      targetEndDate: targetEndDate || null,
      status: "active",
    });

    await db.insert(projectMembersTable).values({
      id: generateId(),
      projectId: id,
      userId: req.user!.id,
      role: "manager",
    });

    res.status(201).json({ id, companyId: req.user!.companyId, name, address, status: "active", startDate, targetEndDate: targetEndDate ?? null, createdAt: new Date().toISOString(), memberCount: 1, alertCount: 0, progressPercent: 0 });
  } catch (err) {
    req.log.error({ err }, "Create project error");
    res.status(500).json({ error: "server_error", message: "Failed to create project" });
  }
});

router.get("/projects/:projectId", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);

    if (projects.length === 0) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const p = projects[0];
    const [memberCount] = await db.select({ count: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, p.id));
    const { alertCount, alertDocumentId } = await docAlertsFor(p.id);

    const progressPercent = await computeProgress(p.id);
    const recentActivity = await getRecentActivity(p.id);
    const siteManagerName = p.siteManagerId
      ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.siteManagerId)).limit(1))[0]?.name ?? null
      : null;
    res.json({
      id: p.id,
      companyId: p.companyId,
      name: p.name,
      address: p.address,
      status: p.status,
      startDate: p.startDate,
      targetEndDate: p.targetEndDate ?? null,
      createdAt: p.createdAt.toISOString(),
      memberCount: Number(memberCount.count),
      alertCount,
      alertDocumentId,
      progressPercent,
      trades: p.trades ?? [],
      recentActivity,
      siteManagerId: p.siteManagerId ?? null,
      siteManagerName,
      siteTimeZone: safeTz(p.siteTimeZone),
      siteTzLabel: siteTzLabel(p.siteTimeZone),
      siteCloseTime: p.siteCloseTime,
    });
  } catch (err) {
    req.log.error({ err }, "Get project error");
    res.status(500).json({ error: "server_error", message: "Failed to get project" });
  }
});

router.patch("/projects/:projectId", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const { name, address, status, targetEndDate, siteManagerId, siteTimeZone, siteCloseTime } = req.body;
    const updates: Record<string, unknown> = {};

    // Every project field is approver-only (company admin / PM, per-project PM
    // cover, or platform admin), matching the Edit Details button. Before this
    // any logged-in company user could, via the API, rename a project, change
    // the address on the public board, make themselves site manager (and so
    // receive every check-in alert) or change its status.
    const current = (await db.select({ status: projectsTable.status, siteManagerId: projectsTable.siteManagerId }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1))[0];
    if (!current) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!(await isProjectApprover(req.user!, req.params.projectId))) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can edit this project" });
      return;
    }
    if (status !== undefined) {
      if (!["active", "on_hold", "complete"].includes(status)) {
        res.status(400).json({ error: "validation_error", message: "status must be active, on_hold or complete" });
        return;
      }
      // Completing goes through the PIN-confirmed close-out, which also keeps
      // the handover record. It can't be set here.
      if (status === "complete" && current.status !== "complete") {
        res.status(400).json({ error: "use_closeout", message: "To complete a project, use Close-Out on the project. It needs your PIN and keeps the handover record." });
        return;
      }
    }
    if (siteTimeZone !== undefined || siteCloseTime !== undefined) {
      if (siteTimeZone !== undefined) {
        if (!isValidTimeZone(siteTimeZone)) { res.status(400).json({ error: "validation_error", message: "siteTimeZone must be a valid timezone, for example Europe/London" }); return; }
        updates.siteTimeZone = siteTimeZone;
      }
      if (siteCloseTime !== undefined) {
        if (!isValidCloseTime(siteCloseTime)) { res.status(400).json({ error: "validation_error", message: "siteCloseTime must be a time like 20:00" }); return; }
        updates.siteCloseTime = siteCloseTime;
      }
    }
    if (name) updates.name = name;
    if (address) updates.address = address;
    if (status && status !== current.status) updates.status = status;
    if (targetEndDate !== undefined) updates.targetEndDate = targetEndDate;
    if (siteManagerId !== undefined) {
      if (siteManagerId === null) {
        updates.siteManagerId = null;
      } else {
        const memberRows = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
          .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, siteManagerId)))
          .limit(1);
        if (memberRows.length === 0) {
          res.status(400).json({ error: "validation_error", message: "siteManagerId must be a current member of this project" });
          return;
        }
        updates.siteManagerId = siteManagerId;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(projectsTable).set(updates).where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)));
      // Recorded (who, when, from, to): status changes (pause, reopen after
      // close-out) and the site manager, who receives every check-in alert
      // with names and photos, so it's treated as access to personal data.
      const changes: Record<string, unknown> = {};
      if (updates.status) changes.status = { from: current.status, to: updates.status };
      if ("siteManagerId" in updates && (updates.siteManagerId ?? null) !== (current.siteManagerId ?? null)) {
        changes.siteManager = { from: current.siteManagerId ?? null, to: updates.siteManagerId ?? null };
      }
      if (Object.keys(changes).length > 0) {
        void logActivity({ userId: req.user!.id, projectId: req.params.projectId, companyId: req.user!.companyId, section: "project", action: "update", itemType: "project", itemId: req.params.projectId, metadata: changes, req });
      }
    }

    const projects = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (projects.length === 0) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }
    const p = projects[0];
    const siteManagerName = p.siteManagerId
      ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.siteManagerId)).limit(1))[0]?.name ?? null
      : null;
    res.json({ id: p.id, companyId: p.companyId, name: p.name, address: p.address, status: p.status, startDate: p.startDate, targetEndDate: p.targetEndDate ?? null, createdAt: p.createdAt.toISOString(), memberCount: 0, alertCount: 0, progressPercent: 0, siteManagerId: p.siteManagerId ?? null, siteManagerName, siteTimeZone: safeTz(p.siteTimeZone), siteTzLabel: siteTzLabel(p.siteTimeZone), siteCloseTime: p.siteCloseTime });
  } catch (err) {
    req.log.error({ err }, "Update project error");
    res.status(500).json({ error: "server_error", message: "Failed to update project" });
  }
});

router.post("/projects/:projectId/trades", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const { trade } = req.body;
    if (!trade?.trim()) { res.status(400).json({ error: "validation_error", message: "trade is required" }); return; }
    const rows = await db.select({ trades: projectsTable.trades }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!rows.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const existing = rows[0].trades ?? [];
    const normalised = trade.trim().toLowerCase();
    if (!existing.map((t: string) => t.toLowerCase()).includes(normalised)) {
      await db.update(projectsTable).set({ trades: [...existing, trade.trim()] })
        .where(eq(projectsTable.id, req.params.projectId));
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Add trade error");
    res.status(500).json({ error: "server_error", message: "Failed to add trade" });
  }
});

// Adding a contact to a project lets them check in there: approvers only (#118).
router.post("/projects/:projectId/members/link", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const { subcontractorId } = req.body;
    if (!subcontractorId) {
      res.status(400).json({ error: "validation_error", message: "subcontractorId required" });
      return;
    }

    const sub = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    const proj = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!proj[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const existing = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.subcontractorId, subcontractorId)))
      .limit(1);
    if (existing[0]) {
      res.status(409).json({ error: "conflict", message: "Subcontractor is already on this project" });
      return;
    }

    const memberId = generateId();
    await db.insert(projectMembersTable).values({
      id: memberId,
      projectId: req.params.projectId,
      subcontractorId,
      role: "subcontractor",
    });

    res.status(201).json({ success: true, memberId });
  } catch (err) {
    req.log.error({ err }, "Link subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to link subcontractor" });
  }
});

router.post("/projects/:projectId/tradespeople", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    // Tenant scoping: the project must belong to the caller's company.
    const owned = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!owned.length) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { trade, companyName, contactName, contactEmail, contactPhone } = req.body;
    if (!trade || !companyName || !contactName) {
      res.status(400).json({ error: "validation_error", message: "trade, companyName and contactName are required" }); return;
    }

    // Dedupe: don't add the same contact (company + contact name) to this project
    // twice — a double submit or re-add would otherwise create duplicate members.
    const nameLower = contactName.trim().toLowerCase();
    const companyLower = companyName.trim().toLowerCase();
    const existingContacts = await db.select({
      companyName: subcontractorsTable.companyName, contactName: subcontractorsTable.contactName,
    }).from(projectMembersTable)
      .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
      .where(eq(projectMembersTable.projectId, req.params.projectId));
    if (existingContacts.some(c => c.contactName.trim().toLowerCase() === nameLower && c.companyName.trim().toLowerCase() === companyLower)) {
      res.status(409).json({ error: "conflict", message: "This person is already on this project" });
      return;
    }

    const subId = generateId();
    await db.insert(subcontractorsTable).values({
      id: subId,
      companyId: req.user!.companyId,
      companyName,
      contactName,
      contactEmail: contactEmail || "",
      contactPhone: contactPhone || null,
      trades: [trade],
    });
    const memberId = generateId();
    await db.insert(projectMembersTable).values({
      id: memberId,
      projectId: req.params.projectId,
      subcontractorId: subId,
      role: "subcontractor",
    });
    // Also ensure the trade exists on the project
    const rows = await db.select({ trades: projectsTable.trades }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1);
    const existing = rows[0]?.trades ?? [];
    if (!existing.map((t: string) => t.toLowerCase()).includes(trade.toLowerCase())) {
      await db.update(projectsTable).set({ trades: [...existing, trade] }).where(eq(projectsTable.id, req.params.projectId));
    }
    res.status(201).json({ success: true, memberId });
  } catch (err) {
    req.log.error({ err }, "Add tradesperson error");
    res.status(500).json({ error: "server_error", message: "Failed to add tradesperson" });
  }
});

// ── Milestones ──────────────────────────────────────────────────────────────

router.get("/projects/:projectId/milestones", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const rows = await db.select().from(milestonesTable)
      .where(eq(milestonesTable.projectId, req.params.projectId))
      .orderBy(asc(milestonesTable.order), asc(milestonesTable.dueDate));

    res.json(rows.map(m => ({
      id: m.id, projectId: m.projectId, title: m.title, dueDate: m.dueDate,
      completedAt: m.completedAt ? m.completedAt.toISOString() : null, order: m.order,
    })));
  } catch (err) {
    req.log.error({ err }, "List milestones error");
    res.status(500).json({ error: "server_error", message: "Failed to list milestones" });
  }
});

router.post("/projects/:projectId/milestones", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const { title, dueDate } = req.body;
    if (!title?.trim() || !dueDate) { res.status(400).json({ error: "validation_error", message: "title and dueDate required" }); return; }

    const [{ maxOrder }] = await db.select({ maxOrder: sql<number>`coalesce(max("order"), -1)` })
      .from(milestonesTable).where(eq(milestonesTable.projectId, req.params.projectId));

    const id = generateId();
    await db.insert(milestonesTable).values({ id, projectId: req.params.projectId, title: title.trim(), dueDate, order: Number(maxOrder) + 1 });
    res.status(201).json({ id, projectId: req.params.projectId, title: title.trim(), dueDate, completedAt: null, order: Number(maxOrder) + 1 });
  } catch (err) {
    req.log.error({ err }, "Create milestone error");
    res.status(500).json({ error: "server_error", message: "Failed to create milestone" });
  }
});

router.patch("/projects/:projectId/milestones/:milestoneId", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const { title, dueDate, completed } = req.body;
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title.trim();
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (completed === true) updates.completedAt = new Date();
    if (completed === false) updates.completedAt = null;

    await db.update(milestonesTable).set(updates)
      .where(and(eq(milestonesTable.id, req.params.milestoneId), eq(milestonesTable.projectId, req.params.projectId)));

    const rows = await db.select().from(milestonesTable)
      .where(eq(milestonesTable.id, req.params.milestoneId)).limit(1);
    if (!rows.length) { res.status(404).json({ error: "not_found", message: "Milestone not found" }); return; }
    const m = rows[0];
    res.json({ id: m.id, projectId: m.projectId, title: m.title, dueDate: m.dueDate, completedAt: m.completedAt ? m.completedAt.toISOString() : null, order: m.order });
  } catch (err) {
    req.log.error({ err }, "Update milestone error");
    res.status(500).json({ error: "server_error", message: "Failed to update milestone" });
  }
});

router.delete("/projects/:projectId/milestones/:milestoneId", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    await db.delete(milestonesTable)
      .where(and(eq(milestonesTable.id, req.params.milestoneId), eq(milestonesTable.projectId, req.params.projectId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete milestone error");
    res.status(500).json({ error: "server_error", message: "Failed to delete milestone" });
  }
});

export default router;
