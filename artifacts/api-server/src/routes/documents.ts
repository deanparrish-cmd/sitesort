import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { documentsTable, documentDistributionsTable, usersTable, notificationsTable, projectsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendDocumentNotificationEmail } from "../lib/email";
import { isPinLockedOut, recordFailedPinAttempt, clearPinAttempts } from "../lib/pin-attempts";

// Document types that require a PIN to sign off (critical compliance documents).
const PIN_REQUIRED_TYPES = ["drawing", "method_statement", "safety"];

const router: IRouter = Router();

function getDistSummary(dists: Array<{ status: string }>) {
  const total = dists.length;
  const pending = dists.filter(d => d.status === "pending").length;
  const viewed = dists.filter(d => d.status === "viewed").length;
  const acknowledged = dists.filter(d => d.status === "acknowledged").length;
  return { total, pending, viewed, acknowledged };
}

router.get("/projects/:projectId/documents", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { type, status } = req.query as { type?: string; status?: string };
    let conditions = [eq(documentsTable.projectId, req.params.projectId)];
    if (type) conditions.push(eq(documentsTable.type, type));
    if (status) conditions.push(eq(documentsTable.status, status));

    const docs = await db.select().from(documentsTable).where(and(...conditions)).orderBy(documentsTable.createdAt);

    const result = await Promise.all(docs.map(async (d) => {
      const dists = await db.select({ userId: documentDistributionsTable.userId, status: documentDistributionsTable.status }).from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, d.id));
      const uploaderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, d.uploadedBy)).limit(1);
      const myDist = dists.find(dist => dist.userId === req.user!.id);
      return {
        id: d.id,
        projectId: d.projectId,
        uploadedBy: d.uploadedBy,
        uploaderName: uploaderRows[0]?.name ?? "Unknown",
        name: d.name,
        type: d.type,
        version: d.version,
        fileUrl: d.fileUrl,
        fileSize: d.fileSize,
        previousVersionId: d.previousVersionId ?? null,
        status: d.status,
        requiresAcknowledgment: d.requiresAcknowledgment,
        publicAccess: d.publicAccess,
        createdAt: d.createdAt.toISOString(),
        distributionSummary: getDistSummary(dists),
        myDistributionStatus: myDist?.status ?? null,
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List documents error");
    res.status(500).json({ error: "server_error", message: "Failed to list documents" });
  }
});

router.post("/projects/:projectId/documents", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { name, type, fileUrl, fileSize, requiresAcknowledgment, publicAccess, distributeToUserIds, supersededDocumentId } = req.body;
    if (!name || !type || !fileUrl) {
      res.status(400).json({ error: "validation_error", message: "name, type, fileUrl required" });
      return;
    }

    let previousVersionId: string | null = null;
    let newVersion = 1;

    if (supersededDocumentId) {
      const toSupersede = await db.select().from(documentsTable)
        .where(and(
          eq(documentsTable.id, supersededDocumentId),
          eq(documentsTable.projectId, req.params.projectId),
          eq(documentsTable.status, "current")
        ))
        .limit(1);
      if (toSupersede.length > 0) {
        previousVersionId = toSupersede[0].id;
        newVersion = toSupersede[0].version + 1;
        await db.update(documentsTable).set({ status: "superseded" }).where(eq(documentsTable.id, toSupersede[0].id));
      }
    } else {
      const existing = await db.select().from(documentsTable)
        .where(and(eq(documentsTable.projectId, req.params.projectId), eq(documentsTable.name, name), eq(documentsTable.status, "current")))
        .limit(1);
      if (existing.length > 0) {
        const prev = existing[0];
        previousVersionId = prev.id;
        newVersion = prev.version + 1;
        await db.update(documentsTable).set({ status: "superseded" }).where(eq(documentsTable.id, prev.id));
      }
    }

    const docId = generateId();
    await db.insert(documentsTable).values({
      id: docId,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      name,
      type,
      version: newVersion,
      fileUrl,
      fileSize: fileSize ?? 0,
      previousVersionId,
      status: "current",
      requiresAcknowledgment: requiresAcknowledgment ?? false,
      publicAccess: publicAccess ?? false,
    });

    // Look up project name once for all notifications
    const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1);
    const projectName = projectRows[0]?.name ?? "your project";

    if (distributeToUserIds && Array.isArray(distributeToUserIds)) {
      for (const userId of distributeToUserIds) {
        await db.insert(documentDistributionsTable).values({
          id: generateId(),
          documentId: docId,
          userId,
          status: "pending",
        });

        await db.insert(notificationsTable).values({
          id: generateId(),
          userId,
          type: "document_uploaded",
          title: `New document: ${name}`,
          message: `${name} (v${newVersion}) has been uploaded and requires your attention.`,
          relatedEntityId: docId,
          relatedEntityType: "document",
          read: false,
        });

        // Send email notification (fire-and-forget)
        const recipientRows = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (recipientRows[0]) {
          const { email: recipientEmail, name: recipientName } = recipientRows[0];
          sendDocumentNotificationEmail(recipientEmail, recipientName, name, newVersion, projectName, requiresAcknowledgment ?? false).catch(err =>
            req.log.error({ err }, "Failed to send document notification email"),
          );
        }
      }
    }

    const uploaderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const dists = await db.select({ status: documentDistributionsTable.status }).from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, docId));

    res.status(201).json({
      id: docId,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      uploaderName: uploaderRows[0]?.name ?? "Unknown",
      name,
      type,
      version: newVersion,
      fileUrl,
      fileSize: fileSize ?? 0,
      previousVersionId,
      status: "current",
      requiresAcknowledgment: requiresAcknowledgment ?? false,
      publicAccess: publicAccess ?? false,
      createdAt: new Date().toISOString(),
      distributionSummary: getDistSummary(dists),
    });
  } catch (err) {
    req.log.error({ err }, "Upload document error");
    res.status(500).json({ error: "server_error", message: "Failed to upload document" });
  }
});

router.get("/documents/:documentId", authenticate, async (req, res) => {
  try {
    const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (docs.length === 0) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const d = docs[0];

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, d.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const distRecord = await db.select().from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, d.id), eq(documentDistributionsTable.userId, req.user!.id)))
      .limit(1);

    if (distRecord.length > 0 && distRecord[0].status === "pending") {
      await db.update(documentDistributionsTable)
        .set({ status: "viewed", viewedAt: new Date() })
        .where(eq(documentDistributionsTable.id, distRecord[0].id));
    }

    const dists = await db.select({
      id: documentDistributionsTable.id,
      documentId: documentDistributionsTable.documentId,
      userId: documentDistributionsTable.userId,
      status: documentDistributionsTable.status,
      distributedAt: documentDistributionsTable.distributedAt,
      viewedAt: documentDistributionsTable.viewedAt,
      acknowledgedAt: documentDistributionsTable.acknowledgedAt,
    }).from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, d.id));

    const distsWithUsers = await Promise.all(dists.map(async (dist) => {
      const userRows = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, dist.userId)).limit(1);
      return {
        ...dist,
        userName: userRows[0]?.name ?? "Unknown",
        userRole: userRows[0]?.role ?? "site_worker",
        distributedAt: dist.distributedAt.toISOString(),
        viewedAt: dist.viewedAt?.toISOString() ?? null,
        acknowledgedAt: dist.acknowledgedAt?.toISOString() ?? null,
      };
    }));

    const uploaderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, d.uploadedBy)).limit(1);

    res.json({
      id: d.id,
      projectId: d.projectId,
      uploadedBy: d.uploadedBy,
      uploaderName: uploaderRows[0]?.name ?? "Unknown",
      name: d.name,
      type: d.type,
      version: d.version,
      fileUrl: d.fileUrl,
      fileSize: d.fileSize,
      previousVersionId: d.previousVersionId ?? null,
      status: d.status,
      requiresAcknowledgment: d.requiresAcknowledgment,
      publicAccess: d.publicAccess,
      createdAt: d.createdAt.toISOString(),
      distributionSummary: getDistSummary(distsWithUsers),
      distributions: distsWithUsers,
    });
  } catch (err) {
    req.log.error({ err }, "Get document error");
    res.status(500).json({ error: "server_error", message: "Failed to get document" });
  }
});

router.post("/documents/:documentId/acknowledge", authenticate, async (req, res) => {
  try {
    const { pin } = req.body ?? {};

    // Load the document (and verify tenant access) to determine whether it is a
    // critical type that requires PIN-confirmed sign-off.
    const docs = await db.select({ id: documentsTable.id, type: documentsTable.type, projectId: documentsTable.projectId, version: documentsTable.version })
      .from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (!docs[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, docs[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    // The user must actually be a distribution recipient of this document to sign it off.
    const distRecord = await db.select().from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, req.params.documentId), eq(documentDistributionsTable.userId, req.user!.id)))
      .limit(1);
    if (!distRecord[0]) {
      res.status(403).json({ error: "not_distributed", message: "This document has not been shared with you to sign off." });
      return;
    }

    const requiresPin = PIN_REQUIRED_TYPES.includes(docs[0].type);

    if (requiresPin) {
      // Rate-limit PIN attempts per user.
      if (await isPinLockedOut(req.user!.id)) {
        res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
        return;
      }

      const users = await db.select({ pinHash: usersTable.pinHash }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
      const pinHash = users[0]?.pinHash ?? null;
      if (!pinHash) {
        res.status(400).json({ error: "pin_not_set", message: "You need to set a sign-off PIN before signing off critical documents." });
        return;
      }

      if (!pin || !/^\d{4}$/.test(String(pin))) {
        res.status(400).json({ error: "validation_error", message: "A 4-digit PIN is required to sign off this document." });
        return;
      }

      const valid = await bcrypt.compare(String(pin), pinHash);
      if (!valid) {
        const { locked, remaining } = await recordFailedPinAttempt(req.user!.id);
        if (locked) {
          res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
        } else {
          res.status(401).json({ error: "invalid_pin", message: "Incorrect PIN", attemptsRemaining: remaining });
        }
        return;
      }

      await clearPinAttempts(req.user!.id);
    }

    // Snapshot the actor's name/role so the audit record survives later user changes.
    const actorRows = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);

    // Atomically update the distribution and write the immutable audit entry:
    // either both the sign-off and its append-only audit record persist, or neither does.
    await db.transaction(async (tx) => {
      await tx.update(documentDistributionsTable)
        .set({ status: "acknowledged", acknowledgedAt: new Date(), viewedAt: distRecord[0].viewedAt ?? new Date(), signedOffWithPin: requiresPin })
        .where(eq(documentDistributionsTable.id, distRecord[0].id));

      await tx.insert(acknowledgmentAuditTable).values({
        id: generateId(),
        documentId: req.params.documentId,
        documentVersion: docs[0].version,
        userId: req.user!.id,
        userName: actorRows[0]?.name ?? "Unknown",
        userRole: actorRows[0]?.role ?? req.user!.role,
        action: "acknowledged",
        signedOffWithPin: requiresPin,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    res.json({ success: true, message: "Document acknowledged" });
  } catch (err) {
    req.log.error({ err }, "Acknowledge document error");
    res.status(500).json({ error: "server_error", message: "Failed to acknowledge document" });
  }
});

router.post("/documents/:documentId/distribute", authenticate, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) {
      res.status(400).json({ error: "validation_error", message: "userIds array required" });
      return;
    }

    const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (docs.length === 0) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, docs[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    for (const userId of userIds) {
      const existing = await db.select().from(documentDistributionsTable)
        .where(and(eq(documentDistributionsTable.documentId, req.params.documentId), eq(documentDistributionsTable.userId, userId)))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(documentDistributionsTable).values({
          id: generateId(),
          documentId: req.params.documentId,
          userId,
          status: "pending",
        });

        await db.insert(notificationsTable).values({
          id: generateId(),
          userId,
          type: "document_uploaded",
          title: `Document distributed: ${docs[0].name}`,
          message: `${docs[0].name} has been shared with you.`,
          relatedEntityId: req.params.documentId,
          relatedEntityType: "document",
          read: false,
        });
      }
    }

    res.json({ success: true, message: "Document distributed" });
  } catch (err) {
    req.log.error({ err }, "Distribute document error");
    res.status(500).json({ error: "server_error", message: "Failed to distribute document" });
  }
});

router.get("/documents/:documentId/distributions", authenticate, async (req, res) => {
  try {
    const docs = await db.select({ projectId: documentsTable.projectId }).from(documentsTable)
      .where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (!docs[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, docs[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const dists = await db.select().from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, req.params.documentId));
    const result = await Promise.all(dists.map(async (dist) => {
      const userRows = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, dist.userId)).limit(1);
      return {
        id: dist.id,
        documentId: dist.documentId,
        userId: dist.userId,
        userName: userRows[0]?.name ?? "Unknown",
        userRole: userRows[0]?.role ?? "site_worker",
        status: dist.status,
        distributedAt: dist.distributedAt.toISOString(),
        viewedAt: dist.viewedAt?.toISOString() ?? null,
        acknowledgedAt: dist.acknowledgedAt?.toISOString() ?? null,
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get distributions error");
    res.status(500).json({ error: "server_error", message: "Failed to get distributions" });
  }
});

// Read-only, append-only audit trail for a document's sign-offs.
// Restricted to admins and project managers (compliance oversight roles).
router.get("/documents/:documentId/audit-log", authenticate, async (req, res) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "project_manager") {
      res.status(403).json({ error: "forbidden", message: "Only admins and project managers can view the audit log." });
      return;
    }

    const docs = await db.select({ projectId: documentsTable.projectId }).from(documentsTable)
      .where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (!docs[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, docs[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const entries = await db.select().from(acknowledgmentAuditTable)
      .where(eq(acknowledgmentAuditTable.documentId, req.params.documentId))
      .orderBy(desc(acknowledgmentAuditTable.createdAt));

    res.json(entries.map(e => ({
      id: e.id,
      documentId: e.documentId,
      documentVersion: e.documentVersion,
      userId: e.userId,
      userName: e.userName,
      userRole: e.userRole,
      action: e.action,
      signedOffWithPin: e.signedOffWithPin,
      ipAddress: e.ipAddress ?? null,
      userAgent: e.userAgent ?? null,
      createdAt: e.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Get audit log error");
    res.status(500).json({ error: "server_error", message: "Failed to get audit log" });
  }
});

router.patch("/documents/:documentId", authenticate, async (req, res) => {
  try {
    const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (!docs[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, docs[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const { status, version } = req.body;
    const updates: Record<string, unknown> = {};
    if (status !== undefined) {
      if (!["current", "superseded"].includes(status)) {
        res.status(400).json({ error: "validation_error", message: "status must be current or superseded" });
        return;
      }
      updates.status = status;
    }
    if (version !== undefined) {
      const v = parseInt(version, 10);
      if (isNaN(v) || v < 1) {
        res.status(400).json({ error: "validation_error", message: "version must be a positive integer" });
        return;
      }
      updates.version = v;
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "validation_error", message: "No fields to update" });
      return;
    }

    await db.update(documentsTable).set(updates).where(eq(documentsTable.id, req.params.documentId));
    const updated = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    const d = updated[0];
    const dists = await db.select({ status: documentDistributionsTable.status }).from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, d.id));
    const uploaderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, d.uploadedBy)).limit(1);
    res.json({
      id: d.id, projectId: d.projectId, uploadedBy: d.uploadedBy,
      uploaderName: uploaderRows[0]?.name ?? "Unknown",
      name: d.name, type: d.type, version: d.version, fileUrl: d.fileUrl,
      fileSize: d.fileSize, previousVersionId: d.previousVersionId ?? null,
      status: d.status, requiresAcknowledgment: d.requiresAcknowledgment,
      publicAccess: d.publicAccess, createdAt: d.createdAt.toISOString(),
      distributionSummary: getDistSummary(dists),
    });
  } catch (err) {
    req.log.error({ err }, "Update document error");
    res.status(500).json({ error: "server_error", message: "Failed to update document" });
  }
});

export default router;
