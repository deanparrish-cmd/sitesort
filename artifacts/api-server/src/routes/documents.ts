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

const APP_URL = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "www.sitesort.co.uk"}`;

// A per-distribution tracked open link. When the recipient clicks it from their
// email it hits GET /documents/:id/open, which records the open (pending→viewed)
// and 302-redirects to the file — so the eye-icon view count moves on a real open.
function trackedOpenUrl(documentId: string, distributionId: string): string {
  return `${APP_URL}/api/documents/${documentId}/open?d=${distributionId}`;
}

const router: IRouter = Router();

function getDistSummary(dists: Array<{ status: string }>) {
  const total = dists.length;
  const pending = dists.filter(d => d.status === "pending").length;
  const viewed = dists.filter(d => d.status === "viewed").length;
  const acknowledged = dists.filter(d => d.status === "acknowledged").length;
  return { total, pending, viewed, acknowledged };
}

// Alphabetical revision label from a 1-based version (F3): 1→A … 26→Z, 27→AA…
// (bijective base-26, like spreadsheet columns). Used as the default drawing
// revision; a user can override it to match the title block (e.g. C, P01).
function versionToRevision(version: number): string {
  let n = Math.max(1, Math.floor(version));
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

// Public tracked-open endpoint for emailed distribution links. Records the open
// against the recipient's distribution (pending→viewed) then redirects to the
// file. Unauthenticated by design — the distribution id in `?d=` is the
// unguessable capability token tying the open to that recipient. The file itself
// is already statically served, so this adds tracking without new exposure.
router.get("/documents/:documentId/open", async (req, res) => {
  try {
    const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (docs.length === 0) {
      res.status(404).send("Document not found");
      return;
    }
    const d = docs[0];

    const distId = typeof req.query.d === "string" ? req.query.d : null;
    if (distId) {
      const distRows = await db.select().from(documentDistributionsTable)
        .where(and(eq(documentDistributionsTable.id, distId), eq(documentDistributionsTable.documentId, d.id)))
        .limit(1);
      // Only the first open flips pending→viewed; an already-viewed/acknowledged
      // record is left as-is so re-opens don't churn the timestamp.
      if (distRows.length > 0 && distRows[0].status === "pending") {
        await db.update(documentDistributionsTable)
          .set({ status: "viewed", viewedAt: new Date() })
          .where(eq(documentDistributionsTable.id, distId));
      }
    }

    const target = d.fileUrl.replace(/^\/uploads\//, "/api/uploads/");
    res.redirect(302, target);
  } catch (err) {
    req.log.error({ err }, "Tracked document open error");
    res.status(500).send("Could not open document");
  }
});

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
        revision: d.revision ?? null,
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

    const { name, type, fileUrl, fileSize, requiresAcknowledgment, publicAccess, distributeToUserIds, supersededDocumentId, revision } = req.body;
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

    // Revision (F3): drawings get an alphabetical label — an explicit value (the
    // architect's actual rev) wins, otherwise default to the letter for this
    // version. Non-drawings only carry a revision if one was explicitly supplied.
    const trimmedRevision = typeof revision === "string" && revision.trim() ? revision.trim() : null;
    const docRevision = trimmedRevision ?? (type === "drawing" ? versionToRevision(newVersion) : null);

    const docId = generateId();
    await db.insert(documentsTable).values({
      id: docId,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      name,
      type,
      version: newVersion,
      revision: docRevision,
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
        const distId = generateId();
        await db.insert(documentDistributionsTable).values({
          id: distId,
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

        // Send email notification (fire-and-forget) with a tracked open link so
        // the recipient's view is recorded when they open it from the email.
        const recipientRows = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (recipientRows[0]) {
          const { email: recipientEmail, name: recipientName } = recipientRows[0];
          sendDocumentNotificationEmail(recipientEmail, recipientName, name, newVersion, projectName, requiresAcknowledgment ?? false, trackedOpenUrl(docId, distId)).catch(err =>
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
      revision: docRevision,
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
      revision: d.revision ?? null,
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
        const distId = generateId();
        await db.insert(documentDistributionsTable).values({
          id: distId,
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

        // Email the recipient a tracked open link so their view is recorded.
        const recipientRows = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (recipientRows[0]) {
          sendDocumentNotificationEmail(
            recipientRows[0].email,
            recipientRows[0].name,
            docs[0].name,
            docs[0].version,
            project[0].name,
            docs[0].requiresAcknowledgment,
            trackedOpenUrl(req.params.documentId, distId),
          ).catch(err => req.log.error({ err }, "Failed to send distribution email"));
        }
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

    const { status, version, revision } = req.body;
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
    // Revision (F3): empty string clears it back to null; a value sets it.
    if (revision !== undefined) {
      updates.revision = typeof revision === "string" && revision.trim() ? revision.trim() : null;
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
      name: d.name, type: d.type, version: d.version, revision: d.revision ?? null, fileUrl: d.fileUrl,
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

// GET /documents/:documentId/revisions — the revision history for a document,
// walking the supersede chain (previousVersionId) from the requested doc back
// through its ancestors. Newest first. Tenant-scoped. (F3)
router.get("/documents/:documentId/revisions", authenticate, async (req, res) => {
  try {
    const start = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (!start[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, start[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Document not found" });
      return;
    }

    const chain: typeof start = [];
    let current: typeof start[number] | undefined = start[0];
    const seen = new Set<string>();
    // Safety cap guards against a cyclic previousVersionId ever looping forever.
    while (current && !seen.has(current.id) && chain.length < 100) {
      seen.add(current.id);
      chain.push(current);
      if (!current.previousVersionId) break;
      const prev = await db.select().from(documentsTable).where(eq(documentsTable.id, current.previousVersionId)).limit(1);
      current = prev[0];
    }

    const result = await Promise.all(chain.map(async (d) => {
      const uploaderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, d.uploadedBy)).limit(1);
      return {
        id: d.id,
        version: d.version,
        revision: d.revision ?? null,
        status: d.status,
        fileUrl: d.fileUrl,
        uploaderName: uploaderRows[0]?.name ?? "Unknown",
        createdAt: d.createdAt.toISOString(),
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List document revisions error");
    res.status(500).json({ error: "server_error", message: "Failed to load revision history" });
  }
});

export default router;
