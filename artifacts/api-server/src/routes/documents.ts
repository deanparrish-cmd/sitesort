import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { documentsTable, documentDistributionsTable, usersTable, projectsTable, acknowledgmentAuditTable, portalSharesTable } from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { allow, COMPANY_MANAGER, INTERNAL_STAFF, projectApprover, projectApproverFor } from "../lib/authz";
import { enqueuePushForMembers, acceptedPortalMemberUserIds } from "../lib/push-triggers";
import { removedFromProjectUserIds } from "../lib/project-membership";
import { isPinLockedOut, recordFailedPinAttempt, clearPinAttempts } from "../lib/pin-attempts";
import { pinRequiredForDoc, signOffRequiredOnUpload, SUPERSEDED_SIGNOFF_MESSAGE } from "../lib/signoff";
import { distributeDocumentToUser } from "../lib/document-distribution";
import { isProjectApprover } from "../lib/project-authority";
import { applyPortalShare, type Audience } from "./portal-shares";

const router: IRouter = Router();

// Editing a document (status, version, revision, PIN sign-off policy) is for
// the document's project approvers (company admin / PM, per-project PM cover).
const DOC_APPROVER = projectApproverFor("document", async (req) => {
  const row = (await db.select({ projectId: documentsTable.projectId }).from(documentsTable)
    .innerJoin(projectsTable, eq(projectsTable.id, documentsTable.projectId))
    .where(and(eq(documentsTable.id, req.params.documentId), eq(projectsTable.companyId, req.user!.companyId))).limit(1))[0];
  return row?.projectId ?? null;
});

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

// Emailed distribution links (`?d=<distribution id>`) from before 2026-10-20.
// They used to redirect anyone holding the email straight to the file for 30
// days, with no login, and mark the recipient "viewed" whoever clicked (Dean,
// 2026-10-20: a forwarded email gave the document away). Now a valid link
// opens the document in the Team Portal, which needs a sign-in; the portal
// records the real recipient's view itself. No file is served here any more.
// Without a valid `?d=` it lands on the document in SiteSort, as before.
router.get("/documents/:documentId/open", async (req, res) => {
  try {
    const docs = await db.select({ id: documentsTable.id, projectId: documentsTable.projectId }).from(documentsTable)
      .where(eq(documentsTable.id, req.params.documentId)).limit(1);
    if (docs.length === 0) {
      res.status(404).send("Document not found");
      return;
    }
    const d = docs[0];
    const distId = typeof req.query.d === "string" ? req.query.d : null;
    const dist = distId
      ? (await db.select({ id: documentDistributionsTable.id }).from(documentDistributionsTable)
          .where(and(eq(documentDistributionsTable.id, distId), eq(documentDistributionsTable.documentId, d.id)))
          .limit(1))[0]
      : undefined;
    res.redirect(302, dist ? `/portal/shared?doc=${d.id}` : `/projects/${d.projectId}?tab=documents&document=${d.id}`);
  } catch (err) {
    req.log.error({ err }, "Tracked document open error");
    res.status(500).send("Could not open document");
  }
});

router.get("/projects/:projectId/documents", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
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

    // Two queries for the whole list (it was two per document, all at once,
    // against a pool of 10: slow on big projects and a likely cause of the
    // list failing to load).
    const docIds = docs.map(d => d.id);
    const uploaderIds = [...new Set(docs.map(d => d.uploadedBy))];
    const ruleItemIds = [...new Set([...docIds, ...docs.map(d => d.previousVersionId).filter((x): x is string => !!x)])];
    const [allDists, uploaders, ruleRows] = docIds.length === 0 ? [[], [], []] : await Promise.all([
      db.select({ documentId: documentDistributionsTable.documentId, userId: documentDistributionsTable.userId, status: documentDistributionsTable.status })
        .from(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docIds)),
      db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, uploaderIds)),
      db.select({ itemId: portalSharesTable.itemId }).from(portalSharesTable)
        .where(and(eq(portalSharesTable.itemType, "document"), inArray(portalSharesTable.itemId, ruleItemIds))),
    ]);
    // A current revision with no portal shares while the one it replaced had
    // some has reached nobody on the portal: the documents tab flags it.
    const sharedOnPortal = new Set(ruleRows.map(r => r.itemId));
    const distsByDoc = new Map<string, { userId: string; status: string }[]>();
    for (const r of allDists) {
      const list = distsByDoc.get(r.documentId) ?? [];
      list.push(r);
      distsByDoc.set(r.documentId, list);
    }
    const uploaderName = new Map(uploaders.map(u => [u.id, u.name]));

    const result = docs.map((d) => {
      const dists = distsByDoc.get(d.id) ?? [];
      const myDist = dists.find(dist => dist.userId === req.user!.id);
      return {
        id: d.id,
        projectId: d.projectId,
        uploadedBy: d.uploadedBy,
        uploaderName: uploaderName.get(d.uploadedBy) ?? "Unknown",
        name: d.name,
        type: d.type,
        version: d.version,
        revision: d.revision ?? null,
        fileUrl: d.fileUrl,
        fileSize: d.fileSize,
        previousVersionId: d.previousVersionId ?? null,
        status: d.status,
        requiresAcknowledgment: d.requiresAcknowledgment,
        requirePinSignoff: d.requirePinSignoff,
        pinRequired: pinRequiredForDoc(d),
        publicAccess: d.publicAccess,
        createdAt: d.createdAt.toISOString(),
        distributionSummary: getDistSummary(dists),
        myDistributionStatus: myDist?.status ?? null,
        newRevisionNotShared: d.status === "current" && d.type !== "safety" && !sharedOnPortal.has(d.id)
          && !!d.previousVersionId && sharedOnPortal.has(d.previousVersionId),
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List documents error");
    res.status(500).json({ error: "server_error", message: "Failed to list documents" });
  }
});

router.post("/projects/:projectId/documents", authenticate, allow(projectApprover()), async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { name, type, fileUrl, fileSize, requiresAcknowledgment, requirePinSignoff, publicAccess, distributeToUserIds, supersededDocumentId, revision, carryShareIds } = req.body;
    if (!name || !type || !fileUrl) {
      res.status(400).json({ error: "validation_error", message: "name, type, fileUrl required" });
      return;
    }

    let previousVersionId: string | null = null;
    let newVersion = 1;
    // The revision this upload replaces, and how it was picked: "choice" = the
    // uploader chose it in the Supersedes list, "name" = same name as a current
    // document (automatic). Decides whether its portal shares carry forward.
    let previous: typeof documentsTable.$inferSelect | null = null;
    let supersededBy: "choice" | "name" | null = null;

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
        previous = toSupersede[0];
        supersededBy = "choice";
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
        previous = prev;
        supersededBy = "name";
        await db.update(documentsTable).set({ status: "superseded" }).where(eq(documentsTable.id, prev.id));
      }
    }

    // Revision (F3): drawings get an alphabetical label — an explicit value (the
    // architect's actual rev) wins, otherwise default to the letter for this
    // version. Non-drawings only carry a revision if one was explicitly supplied.
    const trimmedRevision = typeof revision === "string" && revision.trim() ? revision.trim() : null;
    const docRevision = trimmedRevision ?? (type === "drawing" ? versionToRevision(newVersion) : null);

    // RAMS, permits and safety documents always require sign-off (#149), and a
    // new revision keeps the requirement of the one it replaces (#148): it can
    // add a requirement, never drop one.
    const needsAck = signOffRequiredOnUpload(type, requiresAcknowledgment) || (previous?.requiresAcknowledgment ?? false);
    const needsPin = Boolean(requirePinSignoff) || (previous?.requirePinSignoff ?? false);

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
      requiresAcknowledgment: needsAck,
      requirePinSignoff: needsPin,
      publicAccess: publicAccess ?? false,
    });

    // Look up project name once for all notifications
    const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1);
    const projectName = projectRows[0]?.name ?? "your project";

    // Safety notices are always visible to every portal member (never gated), so
    // a new one notifies the whole project. Other doc types notify only when
    // explicitly shared to the portal (handled in portal-shares).
    if (type === "safety") {
      try {
        const members = await acceptedPortalMemberUserIds(req.params.projectId);
        await enqueuePushForMembers(members, req.params.projectId, {
          kind: "site_update", itemType: "safety", itemId: docId,
          title: `New safety notice: ${name}`,
          projectName,
          deepLink: `/portal/shared?doc=${docId}`,
        });
      } catch (e) { req.log.warn({ e }, "safety-notice push enqueue failed"); }
    }

    // Revision carry-forward (Dean, 2026-10-21): the new revision reaches the
    // people the old one was shared with. Chosen in the Supersedes list: every
    // rule of the old revision carries unless `carryShareIds` narrows it (the
    // upload dialog sends the rules left ticked). Replaced only because the
    // name matched: NOTHING carries unless the uploader confirmed the list
    // (`carryShareIds` sent), because a wrong file auto-replacing an unrelated
    // document must never inherit its audience silently. Safety documents are
    // visible to every member anyway.
    let portalCarryForward: { previousRules: number; carried: number; recipientCount: number; notCarriedReason?: "name_match" | "declined" } | null = null;
    if (previous && type !== "safety") {
      const rules = await db.select().from(portalSharesTable).where(and(
        eq(portalSharesTable.projectId, req.params.projectId),
        eq(portalSharesTable.itemType, "document"),
        eq(portalSharesTable.itemId, previous.id),
      ));
      if (rules.length > 0) {
        const confirmed = Array.isArray(carryShareIds) ? new Set((carryShareIds as unknown[]).filter((x): x is string => typeof x === "string")) : null;
        const chosen = confirmed ? rules.filter(r => confirmed.has(r.id)) : supersededBy === "choice" ? rules : [];
        let recipientCount = 0;
        if (chosen.length > 0) {
          ({ recipientCount } = await applyPortalShare({
            projectId: req.params.projectId, itemType: "document", itemId: docId,
            audiences: chosen.map(r => ({ type: r.audienceType as Audience["type"], trade: r.trade ?? undefined, personId: r.personId ?? undefined })),
            sharedByUserId: req.user!.id, sendEmail: false,
            log: err => req.log.error({ err }, "Carry-forward notification failed"),
            notice: { title: `New revision: ${name}${docRevision ? ` Rev ${docRevision}` : ` v${newVersion}`}` },
          }));
        }
        portalCarryForward = {
          previousRules: rules.length, carried: chosen.length, recipientCount,
          ...(chosen.length === 0 ? { notCarriedReason: supersededBy === "name" && !confirmed ? "name_match" as const : "declined" as const } : {}),
        };
      }
    }

    if (distributeToUserIds && Array.isArray(distributeToUserIds)) {
      const doc = { id: docId, name, version: newVersion, requiresAcknowledgment: needsAck };
      for (const userId of distributeToUserIds) {
        // Tracking + in-app notification only; email goes only on an explicit
        // "Also email them" from the share dialog (Dean, 2026-10-20).
        await distributeDocumentToUser(doc, projectName, userId, `New document: ${name}`, err =>
          req.log.error({ err }, "Failed to send document notification email"),
        );
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
      requiresAcknowledgment: needsAck,
      requirePinSignoff: needsPin,
      pinRequired: pinRequiredForDoc({ type, requirePinSignoff: needsPin }),
      publicAccess: publicAccess ?? false,
      createdAt: new Date().toISOString(),
      distributionSummary: getDistSummary(dists),
      portalCarryForward,
    });
  } catch (err) {
    req.log.error({ err }, "Upload document error");
    res.status(500).json({ error: "server_error", message: "Failed to upload document" });
  }
});

router.get("/documents/:documentId", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
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

    const removedIds = await removedFromProjectUserIds(d.projectId, dists.map(dist => dist.userId));
    const distsWithUsers = await Promise.all(dists.map(async (dist) => {
      const userRows = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, dist.userId)).limit(1);
      return {
        ...dist,
        userName: userRows[0]?.name ?? "Unknown",
        userRole: userRows[0]?.role ?? "site_worker",
        removedFromProject: removedIds.has(dist.userId),
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
      requirePinSignoff: d.requirePinSignoff,
      pinRequired: pinRequiredForDoc(d),
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

router.post("/documents/:documentId/acknowledge", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const { pin } = req.body ?? {};

    // Load the document and verify tenant access.
    const docs = await db.select({ id: documentsTable.id, type: documentsTable.type, projectId: documentsTable.projectId, version: documentsTable.version, requirePinSignoff: documentsTable.requirePinSignoff, status: documentsTable.status })
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

    // Only the latest revision can be signed off: a sign-off of a replaced
    // method statement is a sign-off of the wrong document.
    if (docs[0].status !== "current") {
      res.status(409).json({ error: "superseded", message: SUPERSEDED_SIGNOFF_MESSAGE });
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

    // Safety-critical documents (method statements/RAMS, permits, safety docs)
    // and any document flagged "require PIN sign-off" are PIN-confirmed. All
    // other sign-offs are a single deliberate confirm — still attributed,
    // timestamped, and audit-logged exactly the same, just without PIN entry.
    // PIN checks are rate-limited per user (5 wrong attempts locks out 15 min).
    const pinRequired = pinRequiredForDoc(docs[0]);
    if (pinRequired) {
      if (await isPinLockedOut(req.user!.id)) {
        res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
        return;
      }

      const users = await db.select({ pinHash: usersTable.pinHash }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
      const pinHash = users[0]?.pinHash ?? null;
      if (!pinHash) {
        res.status(400).json({ error: "pin_not_set", message: "You need to set a sign-off PIN before signing off documents." });
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
        .set({ status: "acknowledged", acknowledgedAt: new Date(), viewedAt: distRecord[0].viewedAt ?? new Date(), signedOffWithPin: pinRequired })
        .where(eq(documentDistributionsTable.id, distRecord[0].id));

      await tx.insert(acknowledgmentAuditTable).values({
        id: generateId(),
        documentId: req.params.documentId,
        documentVersion: docs[0].version,
        userId: req.user!.id,
        userName: actorRows[0]?.name ?? "Unknown",
        userRole: actorRows[0]?.role ?? req.user!.role,
        action: "acknowledged",
        signedOffWithPin: pinRequired,
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

router.get("/documents/:documentId/distributions", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
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
router.get("/documents/:documentId/audit-log", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
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

    const removedIds = await removedFromProjectUserIds(docs[0].projectId, entries.map(e => e.userId));
    res.json(entries.map(e => ({
      id: e.id,
      documentId: e.documentId,
      documentVersion: e.documentVersion,
      userId: e.userId,
      userName: e.userName,
      userRole: e.userRole,
      action: e.action,
      signedOffWithPin: e.signedOffWithPin,
      removedFromProject: removedIds.has(e.userId),
      ipAddress: e.ipAddress ?? null,
      userAgent: e.userAgent ?? null,
      createdAt: e.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Get audit log error");
    res.status(500).json({ error: "server_error", message: "Failed to get audit log" });
  }
});

router.patch("/documents/:documentId", authenticate, allow(DOC_APPROVER), async (req, res) => {
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
    // Document edits (status/version/revision and the PIN sign-off policy toggle)
    // require approver authority on THIS project — company admin/PM, a member
    // granted per-project PM cover, or a platform admin. Checked server-side so a
    // non-approver always gets 403 regardless of what the UI shows.
    if (!(await isProjectApprover(req.user!, docs[0].projectId))) {
      res.status(403).json({ error: "forbidden", message: "Only a project approver can edit documents." });
      return;
    }

    const { status, version, revision, requirePinSignoff } = req.body;
    const updates: Record<string, unknown> = {};
    // Per-document "require PIN sign-off" toggle a PM can flip after upload.
    if (requirePinSignoff !== undefined) {
      updates.requirePinSignoff = Boolean(requirePinSignoff);
    }
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
      requirePinSignoff: d.requirePinSignoff, pinRequired: pinRequiredForDoc(d),
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
router.get("/documents/:documentId/revisions", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
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
