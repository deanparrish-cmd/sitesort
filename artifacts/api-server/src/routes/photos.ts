import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { photosTable, usersTable, notificationsTable, projectMembersTable, projectsTable } from "@workspace/db/schema";
import { eq, and, or, count, inArray, isNotNull, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendSafetyAlertEmail } from "../lib/email";
import { isOverdue, issueCategoryFilter } from "../lib/accountability";
import { logActivity } from "../lib/activity";
import { enqueuePushForMembers } from "../lib/push-triggers";
import { notesFor, addNote } from "../lib/portal-submission-notes";

const router: IRouter = Router();

// Resolve a user's display name, or null when unassigned.
async function nameForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const rows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0]?.name ?? null;
}

async function formatPhoto(p: typeof photosTable.$inferSelect, uploaderName: string, projectName?: string, assignedToName?: string | null, archivedByName?: string | null) {
  const submittedByName = await nameForUser(p.submittedBy);
  const notes = await notesFor("site_issue", p.id);
  return {
    id: p.id,
    projectId: p.projectId,
    projectName: projectName ?? null,
    uploadedBy: p.uploadedBy,
    uploaderName,
    // Hidden once the photo has been individually removed (photoRemovedAt
    // set) — the raw URL stays in the DB (retained, not destroyed), this is
    // just what's exposed to normal reads.
    photoUrl: p.photoRemovedAt ? null : p.photoUrl,
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
    // Soft-delete (manager-only). Archived issues are excluded from normal
    // list reads by default — see the `archived=true` query param.
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    archivedByName: archivedByName ?? null,
    archiveReason: p.archiveReason ?? null,
    photoRemovedAt: p.photoRemovedAt ? p.photoRemovedAt.toISOString() : null,
    // Portal save-vs-submit lifecycle (Feature). Dashboard-created photos are
    // always submitted immediately — only portal-reported issues can be drafts.
    submittedAt: p.submittedAt ? p.submittedAt.toISOString() : null,
    submittedByName,
    lifecycleStatus: p.submittedAt ? "submitted" : "draft",
    notes,
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

    const { category, archived } = req.query as { category?: string; archived?: string };
    const conditions = [eq(photosTable.projectId, req.params.projectId)];
    if (category) conditions.push(eq(photosTable.category, category));
    // Default: active only (mirrors people.ts's `?archived=true` convention) —
    // archived issues stay in the DB and out of the normal list/counts.
    conditions.push(archived === "true" ? isNotNull(photosTable.archivedAt) : isNull(photosTable.archivedAt));
    // Portal save-vs-submit lifecycle: a member's un-submitted DRAFT stays with
    // the member. Dashboard viewers only see it once submitted — except the
    // author themselves (an in-house member browsing the dashboard may see
    // their own drafts). Dashboard-created photos are stamped submitted_at at
    // creation, so this only ever hides portal drafts.
    conditions.push(or(isNotNull(photosTable.submittedAt), eq(photosTable.uploadedBy, req.user!.id))!);

    const photos = await db.select().from(photosTable).where(and(...conditions)).orderBy(photosTable.takenAt);
    const result = await Promise.all(photos.map(async (p) => {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.uploadedBy)).limit(1);
      return await formatPhoto(p, userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(p.assignedToUserId), await nameForUser(p.archivedBy));
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
    // A portal member's un-submitted draft stays private to its author.
    if (!photo.submittedAt && photo.uploadedBy !== req.user!.id) {
      res.status(404).json({ error: "not_found", message: "Photo not found" });
      return;
    }
    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.json(await formatPhoto(photo, userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(photo.assignedToUserId), await nameForUser(photo.archivedBy)));
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
    res.json(await formatPhoto(updated[0], userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(updated[0].assignedToUserId), await nameForUser(updated[0].archivedBy)));
  } catch (err) {
    req.log.error({ err }, "Update photo error");
    res.status(500).json({ error: "server_error", message: "Failed to update photo" });
  }
});

// DELETE /api/photos/:photoId — soft-delete (archive) a site issue. Manager-
// only; portal members never reach this route at all (portal.ts has no
// equivalent). Retains the row for audit — see /admin/photos/:photoId in
// admin.ts for the genuine, admin-only hard delete.
router.delete("/photos/:photoId", authenticate, async (req, res) => {
  try {
    if (!MANAGER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can archive an issue." });
      return;
    }
    const rows = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const photo = rows[0];
    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, photo.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(403).json({ error: "forbidden" }); return; }

    const { reason } = req.body as { reason?: string };
    await db.update(photosTable)
      .set({ archivedAt: new Date(), archivedBy: req.user!.id, archiveReason: reason?.trim() || null, updatedAt: new Date() })
      .where(eq(photosTable.id, req.params.photoId));
    void logActivity({ userId: req.user!.id, projectId: photo.projectId, companyId: req.user!.companyId, section: "site-issues", action: "delete", itemType: "photo", itemId: photo.id, metadata: { archiveReason: { from: null, to: reason?.trim() || null } }, req });

    const updated = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.json(await formatPhoto(updated[0], userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(updated[0].assignedToUserId), await nameForUser(updated[0].archivedBy)));
  } catch (err) {
    req.log.error({ err }, "Archive photo error");
    res.status(500).json({ error: "server_error", message: "Failed to archive issue" });
  }
});

// PATCH /api/photos/:photoId/restore — un-archive (manager-only).
router.patch("/photos/:photoId/restore", authenticate, async (req, res) => {
  try {
    if (!MANAGER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can restore an issue." });
      return;
    }
    const rows = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const photo = rows[0];
    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, photo.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(403).json({ error: "forbidden" }); return; }

    await db.update(photosTable)
      .set({ archivedAt: null, archivedBy: null, archiveReason: null, updatedAt: new Date() })
      .where(eq(photosTable.id, req.params.photoId));
    void logActivity({ userId: req.user!.id, projectId: photo.projectId, companyId: req.user!.companyId, section: "site-issues", action: "restore", itemType: "photo", itemId: photo.id, req });

    const updated = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.json(await formatPhoto(updated[0], userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(updated[0].assignedToUserId), await nameForUser(updated[0].archivedBy)));
  } catch (err) {
    req.log.error({ err }, "Restore photo error");
    res.status(500).json({ error: "server_error", message: "Failed to restore issue" });
  }
});

// DELETE /api/photos/:photoId/photo — remove just the attached image, manager-
// only. Soft: photoUrl is left in the DB untouched, only hidden from reads
// (formatPhoto), so it can't corrupt the issue's own history.
router.delete("/photos/:photoId/photo", authenticate, async (req, res) => {
  try {
    if (!MANAGER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can remove a photo." });
      return;
    }
    const rows = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const photo = rows[0];
    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, photo.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(403).json({ error: "forbidden" }); return; }
    if (!photo.photoUrl || photo.photoRemovedAt) { res.status(400).json({ error: "validation_error", message: "No photo to remove." }); return; }

    await db.update(photosTable)
      .set({ photoRemovedAt: new Date(), photoRemovedBy: req.user!.id, updatedAt: new Date() })
      .where(eq(photosTable.id, req.params.photoId));
    void logActivity({ userId: req.user!.id, projectId: photo.projectId, companyId: req.user!.companyId, section: "site-issues", action: "delete", itemType: "photo_attachment", itemId: photo.id, req });

    const updated = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.json(await formatPhoto(updated[0], userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(updated[0].assignedToUserId), await nameForUser(updated[0].archivedBy)));
  } catch (err) {
    req.log.error({ err }, "Remove photo error");
    res.status(500).json({ error: "server_error", message: "Failed to remove photo" });
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

    const { archived } = req.query as { archived?: string };
    const photos = await db.select().from(photosTable)
      .where(and(
        inArray(photosTable.projectId, projectIds),
        issueCategoryFilter(),
        archived === "true" ? isNotNull(photosTable.archivedAt) : isNull(photosTable.archivedAt),
        // A portal member's draft (not yet submitted) never appears in the PM
        // triage queue — this is the whole point of save-vs-submit.
        isNotNull(photosTable.submittedAt),
      ))
      .orderBy(photosTable.takenAt);

    const result = await Promise.all(photos.map(async (p) => {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.uploadedBy)).limit(1);
      return await formatPhoto(p, userRows[0]?.name ?? "Unknown", projectNameMap[p.projectId], await nameForUser(p.assignedToUserId), await nameForUser(p.archivedBy));
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
      // Dashboard-created photos have always been immediately visible to the
      // PM (they ARE the PM) — no draft step, unlike a portal-reported issue.
      submittedAt: new Date(),
      submittedBy: req.user!.id,
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
    res.status(201).json(await formatPhoto(
      { id, projectId: req.params.projectId, uploadedBy: req.user!.id, photoUrl: photoUrl ?? null, category, description: description ?? null, zone: zone ?? null, referenceNumber: refNum, latitude: latitude ?? null, longitude: longitude ?? null, takenAt: new Date(), status: isIssue ? "open" : null, resolvedAt: null, assignedToUserId: assignedToUserId || null, dueDate: dueDate || null, closureReason: null, closureNote: null, updatedAt: null, archivedAt: null, archivedBy: null, archiveReason: null, photoRemovedAt: null, photoRemovedBy: null, submittedAt: new Date(), submittedBy: req.user!.id },
      userRows[0]?.name ?? "Unknown",
      project[0].name,
      await nameForUser(assignedToUserId),
      null,
    ));
  } catch (err) {
    req.log.error({ err }, "Log photo error");
    res.status(500).json({ error: "server_error", message: "Failed to log photo" });
  }
});

// POST /api/photos/:photoId/notes — PM-side append-only note (the dashboard
// counterpart of the portal's POST /portal/site-issues/:issueId/notes).
// Requires the issue to already be submitted — same rule as the portal side.
router.post("/photos/:photoId/notes", authenticate, async (req, res) => {
  try {
    const rows = await db.select().from(photosTable).where(eq(photosTable.id, req.params.photoId)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Photo not found" }); return; }
    const photo = rows[0];
    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, photo.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(403).json({ error: "forbidden" }); return; }
    if (!photo.submittedAt) { res.status(400).json({ error: "validation_error", message: "This issue hasn't been submitted yet." }); return; }
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) { res.status(400).json({ error: "validation_error", message: "A note body is required." }); return; }

    await addNote({ itemType: "site_issue", itemId: photo.id, projectId: photo.projectId, authorId: req.user!.id, body: body.trim() });

    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, photo.uploadedBy)).limit(1);
    res.status(201).json(await formatPhoto(photo, userRows[0]?.name ?? "Unknown", project[0].name, await nameForUser(photo.assignedToUserId), await nameForUser(photo.archivedBy)));
  } catch (err) {
    req.log.error({ err }, "Add issue note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

export default router;
