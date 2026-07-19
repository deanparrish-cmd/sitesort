import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { photosTable, usersTable, notificationsTable, projectMembersTable, projectsTable } from "@workspace/db/schema";
import { eq, and, count, inArray, isNotNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendSafetyAlertEmail } from "../lib/email";
import { isOverdue, issueCategoryFilter } from "../lib/accountability";
import { logActivity } from "../lib/activity";
import { enqueuePushForMembers } from "../lib/push-triggers";

const router: IRouter = Router();

// Resolve a user's display name, or null when unassigned.
async function nameForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const rows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0]?.name ?? null;
}

function formatPhoto(p: typeof photosTable.$inferSelect, uploaderName: string, projectName?: string, assignedToName?: string | null) {
  return {
    id: p.id,
    projectId: p.projectId,
    projectName: projectName ?? null,
    uploadedBy: p.uploadedBy,
    uploaderName,
    photoUrl: p.photoUrl,
    category: p.category,
    description: p.description ?? null,
    zone: p.zone ?? null,
    referenceNumber: p.referenceNumber,
    latitude: p.latitude ? Number(p.latitude) : null,
    longitude: p.longitude ? Number(p.longitude) : null,
    takenAt: p.takenAt.toISOString(),
    status: p.status ?? null,
    resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
    // Assignment & accountability (F1). overdue is derived: a due date in the
    // past on an issue that isn't resolved.
    assignedToUserId: p.assignedToUserId ?? null,
    assignedToName: assignedToName ?? null,
    dueDate: p.dueDate ?? null,
    overdue: isOverdue(p.dueDate, p.status === "resolved"),
    closureReason: p.closureReason ?? null,
    closureNote: p.closureNote ?? null,
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,
  };
}

router.get("/projects/:projectId/photos", authenticate, async (req, res) => {
  try {
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { category } = req.query as { category?: string };
    const conditions = [eq(photosTable.projectId, req.params.projectId)];
    if (category) conditions.push(eq(photosTable.category, category));

    const photos = await db.select().from(photosTable).where(and(...conditions)).orderBy(photosTable.takenAt);
    const result = await Promise.all(photos.map(async (p) => {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.uploadedBy)).limit(1);
      return formatPhoto(p, userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(p.assignedToUserId));
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List photos error");
    res.status(500).json({ error: "server_error", message: "Failed to list photos" });
  }
});

router.get("/photos/:photoId", authenticate, async (req, res) => {
  try {
    const rows = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const photo = rows[0];
    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, photo.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.json(formatPhoto(photo, userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(photo.assignedToUserId)));
  } catch (err) {
    req.log.error({ err }, "Get photo error");
    res.status(500).json({ error: "server_error", message: "Failed to get photo" });
  }
});

const MANAGER_ROLES = ["admin", "project_manager"];

router.patch("/photos/:photoId", authenticate, async (req, res) => {
  try {
    const rows = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const photo = rows[0];
    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, photo.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(403).json({ error: "forbidden" }); return; }

    const { status, assignedToUserId, dueDate, closureReason, closureNote } = req.body as {
      status?: string; assignedToUserId?: string | null; dueDate?: string | null;
      closureReason?: string | null; closureNote?: string | null;
    };

    // "Close as invalid/duplicate" is PM-only, and requires a reason note —
    // this is the concrete server-side enforcement (the endpoint had no role
    // gate at all before this).
    if (closureReason === "invalid" || closureReason === "duplicate") {
      if (!MANAGER_ROLES.includes(req.user!.role)) {
        res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can close an issue as invalid/duplicate." });
        return;
      }
      if (!closureNote || !closureNote.trim()) {
        res.status(400).json({ error: "validation_error", message: "A reason is required to close as invalid/duplicate." });
        return;
      }
    }

    const updates: Partial<typeof photosTable.$inferInsert> = {};
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    let effectiveStatus = status;
    // Allocating a freshly-logged portal issue (assignedToUserId newly set,
    // status not explicitly sent) auto-transitions it out of "new" — the
    // triage step is "allocate", not a separate manual status change.
    if (effectiveStatus === undefined && assignedToUserId !== undefined && assignedToUserId && photo.status === "new") {
      effectiveStatus = "open";
    }
    if (effectiveStatus !== undefined && effectiveStatus !== photo.status) {
      updates.status = effectiveStatus;
      diff.status = { from: photo.status, to: effectiveStatus };
      if (effectiveStatus === "resolved") updates.resolvedAt = new Date();
      else updates.resolvedAt = null;
    }
    // null clears the assignment / due date; a value sets it. undefined leaves as-is.
    if (assignedToUserId !== undefined && (assignedToUserId || null) !== photo.assignedToUserId) {
      updates.assignedToUserId = assignedToUserId || null;
      diff.assignedToUserId = { from: photo.assignedToUserId, to: assignedToUserId || null };
    }
    if (dueDate !== undefined) updates.dueDate = dueDate || null;
    if (closureReason !== undefined) updates.closureReason = closureReason || null;
    if (closureNote !== undefined) updates.closureNote = closureNote || null;

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(photosTable).set(updates).where(eq(photosTable.id, req.params.photoId));
      void logActivity({ userId: req.user!.id, projectId: photo.projectId, companyId: req.user!.companyId, section: "site-issues", action: "update", itemType: "photo", itemId: photo.id, metadata: diff, req });

      // Notify + push a newly-assigned portal member (portal→push is fully
      // wired; dashboard staff have no push channel, so this only ever
      // reaches a portal-only assignee).
      const newAssignee = updates.assignedToUserId;
      if (newAssignee && newAssignee !== photo.assignedToUserId) {
        const isPortalMember = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
          .where(and(eq(projectMembersTable.projectId, photo.projectId), eq(projectMembersTable.userId, newAssignee), isNotNull(projectMembersTable.personId)))
          .limit(1);
        if (isPortalMember.length > 0) {
          void enqueuePushForMembers([newAssignee], photo.projectId, {
            kind: "site_issue_assigned", itemType: "photo", itemId: photo.id,
            title: `Issue assigned to you: ${photo.referenceNumber}`, projectName: project[0].name, deepLink: "/portal/site-issues",
          });
        }
      }
    }

    const updated = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.json(formatPhoto(updated[0], userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(updated[0].assignedToUserId)));
  } catch (err) {
    req.log.error({ err }, "Update photo error");
    res.status(500).json({ error: "server_error", message: "Failed to update photo" });
  }
});

// Company-wide snags & safety concerns
router.get("/issues", authenticate, async (req, res) => {
  try {
    const companyProjects = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.companyId, req.user!.companyId));

    if (companyProjects.length === 0) { res.json([]); return; }

    const projectIds = companyProjects.map(p => p.id);
    const projectNameMap: Record<string, string> = {};
    for (const p of companyProjects) projectNameMap[p.id] = p.name;

    const photos = await db.select().from(photosTable)
      .where(and(
        inArray(photosTable.projectId, projectIds),
        issueCategoryFilter(),
      ))
      .orderBy(photosTable.takenAt);

    const result = await Promise.all(photos.map(async (p) => {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.uploadedBy)).limit(1);
      return formatPhoto(p, userRows[0]?.name ?? "Unknown", projectNameMap[p.projectId], await nameForUser(p.assignedToUserId));
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List issues error");
    res.status(500).json({ error: "server_error", message: "Failed to list issues" });
  }
});

const INTERNAL_ROLES = ["admin", "project_manager", "site_worker"];

router.post("/projects/:projectId/photos", authenticate, async (req, res) => {
  try {
    if (!INTERNAL_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to log photos" });
      return;
    }

    const { photoUrl, category, description, zone, latitude, longitude, assignedToUserId, dueDate } = req.body;
    if (!category) {
      res.status(400).json({ error: "validation_error", message: "category required" });
      return;
    }

    const project = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const [{ total }] = await db.select({ total: count() }).from(photosTable);
    const refNum = `PHOTO-${String(total + 1).padStart(4, "0")}`;
    const id = generateId();
    const isIssue = category === "safety_concern" || category === "snag";
    await db.insert(photosTable).values({
      id,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      photoUrl: photoUrl ?? null,
      category,
      description: description ?? null,
      zone: zone ?? null,
      referenceNumber: refNum,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      status: isIssue ? "open" : null,
      assignedToUserId: assignedToUserId || null,
      dueDate: dueDate || null,
    });

    if (isIssue) {
      const managers = await db.select({ userId: projectMembersTable.userId }).from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.role, "manager")));

      for (const m of managers) {
        if (m.userId) {
          await db.insert(notificationsTable).values({
            id: generateId(),
            userId: m.userId,
            type: "safety_concern",
            title: `⚠️ ${category === "safety_concern" ? "Safety Concern" : "Snag"} logged`,
            message: `A ${category.replace("_", " ")} has been logged on your project. Reference: ${refNum}`,
            relatedEntityId: id,
            relatedEntityType: "photo",
            read: false,
          });

          const managerRows = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.userId)).limit(1);
          if (managerRows[0]) {
            const { email: managerEmail, name: managerName } = managerRows[0];
            sendSafetyAlertEmail(managerEmail, managerName, category, refNum, project[0].name).catch(err =>
              req.log.error({ err }, "Failed to send safety alert email"),
            );
          }
        }
      }
    }

    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    res.status(201).json(formatPhoto(
      { id, projectId: req.params.projectId, uploadedBy: req.user!.id, photoUrl: photoUrl ?? null, category, description: description ?? null, zone: zone ?? null, referenceNumber: refNum, latitude: latitude ?? null, longitude: longitude ?? null, takenAt: new Date(), status: isIssue ? "open" : null, resolvedAt: null, assignedToUserId: assignedToUserId || null, dueDate: dueDate || null, closureReason: null, closureNote: null, updatedAt: null },
      userRows[0]?.name ?? "Unknown",
      project[0].name,
      await nameForUser(assignedToUserId),
    ));
  } catch (err) {
    req.log.error({ err }, "Log photo error");
    res.status(500).json({ error: "server_error", message: "Failed to log photo" });
  }
});

export default router;
