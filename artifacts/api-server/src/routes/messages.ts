import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { messagesTable, usersTable, notificationsTable, invoicesTable, documentsTable, photosTable, permitsTable } from "@workspace/db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

// GET /api/messages/conversations — list conversations for current user (or all if admin/pm)
router.get("/messages/conversations", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const role = req.user!.role;
    const viewAll = req.query.all === "true" && (role === "admin" || role === "project_manager");

    // Get all messages in company, grouped into conversations
    let rows;
    if (viewAll) {
      rows = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.companyId, companyId))
        .orderBy(desc(messagesTable.createdAt));
    } else {
      rows = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.companyId, companyId),
            or(eq(messagesTable.senderId, userId), eq(messagesTable.recipientId, userId))
          )
        )
        .orderBy(desc(messagesTable.createdAt));
    }

    // Get all unique user ids involved
    const userIds = Array.from(new Set(rows.flatMap(r => [r.senderId, r.recipientId])));
    const userRows = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(${userIds})`)
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u]));

    // Group into conversations
    const convMap = new Map<string, {
      otherId: string; otherName: string; otherRole: string;
      lastMessage: string; lastAt: string; unread: number;
    }>();

    for (const msg of rows) {
      const otherId = viewAll
        ? `${msg.senderId}:${msg.recipientId}`  // unique pair key for all-view
        : msg.senderId === userId ? msg.recipientId : msg.senderId;

      const convKey = viewAll
        ? [msg.senderId, msg.recipientId].sort().join(":")
        : otherId as string;

      if (!convMap.has(convKey)) {
        const otherUserId = viewAll ? msg.senderId : otherId as string;
        const sender = userMap[msg.senderId];
        const recipient = userMap[msg.recipientId];
        convMap.set(convKey, {
          otherId: convKey,
          otherName: viewAll
            ? `${sender?.name ?? "Unknown"} → ${recipient?.name ?? "Unknown"}`
            : userMap[otherId as string]?.name ?? "Unknown",
          otherRole: viewAll ? "" : userMap[otherId as string]?.role ?? "",
          lastMessage: msg.content,
          lastAt: msg.createdAt.toISOString(),
          unread: (!viewAll && msg.recipientId === userId && !msg.readAt) ? 1 : 0,
        });
      } else if (!viewAll && msg.recipientId === userId && !msg.readAt) {
        const conv = convMap.get(convKey)!;
        conv.unread += 1;
      }
    }

    res.json(Array.from(convMap.values()));
  } catch (err) {
    req.log.error({ err }, "List conversations error");
    res.status(500).json({ error: "server_error", message: "Failed to list conversations" });
  }
});

// GET /api/messages/thread/:userId — messages between current user and given user
router.get("/messages/thread/:userId", authenticate, async (req, res) => {
  try {
    const me = req.user!.id;
    const other = req.params.userId;
    const companyId = req.user!.companyId;
    const role = req.user!.role;
    const canViewAll = role === "admin" || role === "project_manager";

    let rows;
    if (canViewAll && req.query.all === "true") {
      // Manager viewing a conversation between two other users
      const [a, b] = other.split(":");
      rows = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.companyId, companyId),
            or(
              and(eq(messagesTable.senderId, a), eq(messagesTable.recipientId, b)),
              and(eq(messagesTable.senderId, b), eq(messagesTable.recipientId, a))
            )
          )
        )
        .orderBy(messagesTable.createdAt);
    } else {
      rows = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.companyId, companyId),
            or(
              and(eq(messagesTable.senderId, me), eq(messagesTable.recipientId, other)),
              and(eq(messagesTable.senderId, other), eq(messagesTable.recipientId, me))
            )
          )
        )
        .orderBy(messagesTable.createdAt);

      // Mark unread messages as read
      const unreadIds = rows.filter(r => r.recipientId === me && !r.readAt).map(r => r.id);
      if (unreadIds.length) {
        for (const id of unreadIds) {
          await db.update(messagesTable).set({ readAt: new Date() }).where(eq(messagesTable.id, id));
        }
      }
    }

    // Fetch sender names
    const userIds = Array.from(new Set(rows.flatMap(r => [r.senderId, r.recipientId])));
    const userRows = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(${userIds})`)
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u.name]));

    // Fetch invoice data for messages that have one
    const invoiceIds = Array.from(new Set(rows.map(r => r.invoiceId).filter(Boolean))) as string[];
    const invoiceRows = invoiceIds.length
      ? await db.select({
          id: invoicesTable.id,
          counterpartyName: invoicesTable.counterpartyName,
          amount: invoicesTable.amount,
          currency: invoicesTable.currency,
          dueDate: invoicesTable.dueDate,
          status: invoicesTable.status,
          reference: invoicesTable.reference,
          attachmentUrl: invoicesTable.attachmentUrl,
          direction: invoicesTable.direction,
        }).from(invoicesTable).where(sql`${invoicesTable.id} = ANY(${invoiceIds})`)
      : [];
    const invoiceMap = Object.fromEntries(invoiceRows.map(inv => [inv.id, inv]));

    // Fetch document/photo/permit attachments
    const docIds = rows.filter(r => r.attachmentType === "document" && r.attachmentId).map(r => r.attachmentId as string);
    const photoIds = rows.filter(r => r.attachmentType === "photo" && r.attachmentId).map(r => r.attachmentId as string);
    const permitIds = rows.filter(r => r.attachmentType === "permit" && r.attachmentId).map(r => r.attachmentId as string);

    const docRows = docIds.length
      ? await db.select({ id: documentsTable.id, name: documentsTable.name, type: documentsTable.type, fileUrl: documentsTable.fileUrl, status: documentsTable.status, version: documentsTable.version })
          .from(documentsTable).where(sql`${documentsTable.id} = ANY(${docIds})`)
      : [];
    const photoRows = photoIds.length
      ? await db.select({ id: photosTable.id, photoUrl: photosTable.photoUrl, category: photosTable.category, description: photosTable.description, referenceNumber: photosTable.referenceNumber, zone: photosTable.zone })
          .from(photosTable).where(sql`${photosTable.id} = ANY(${photoIds})`)
      : [];
    const permitRows = permitIds.length
      ? await db.select({ id: permitsTable.id, type: permitsTable.type, description: permitsTable.description, expiryDate: permitsTable.expiryDate, documentUrl: permitsTable.documentUrl })
          .from(permitsTable).where(sql`${permitsTable.id} = ANY(${permitIds})`)
      : [];

    const docMap = Object.fromEntries(docRows.map(d => [d.id, d]));
    const photoMap = Object.fromEntries(photoRows.map(p => [p.id, p]));
    const permitMap = Object.fromEntries(permitRows.map(p => [p.id, p]));

    res.json(rows.map(m => ({
      id: m.id,
      senderId: m.senderId,
      senderName: userMap[m.senderId] ?? "Unknown",
      recipientId: m.recipientId,
      content: m.content,
      invoiceId: m.invoiceId ?? null,
      invoice: m.invoiceId ? (invoiceMap[m.invoiceId] ?? null) : null,
      attachmentType: m.attachmentType ?? null,
      attachmentId: m.attachmentId ?? null,
      attachment: m.attachmentType === "document" && m.attachmentId ? (docMap[m.attachmentId] ?? null)
        : m.attachmentType === "photo" && m.attachmentId ? (photoMap[m.attachmentId] ?? null)
        : m.attachmentType === "permit" && m.attachmentId ? (permitMap[m.attachmentId] ?? null)
        : null,
      readAt: m.readAt?.toISOString() ?? null,
      editedAt: m.editedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      mine: m.senderId === me,
    })));
  } catch (err) {
    req.log.error({ err }, "Get thread error");
    res.status(500).json({ error: "server_error", message: "Failed to get thread" });
  }
});

// POST /api/messages — send a message
router.post("/messages", authenticate, async (req, res) => {
  try {
    const { recipientId, content, invoiceId, attachmentType, attachmentId } = req.body;
    if (!recipientId || (!content?.trim() && !invoiceId && !attachmentId)) {
      res.status(400).json({ error: "validation_error", message: "recipientId and content, invoiceId, or attachment are required" });
      return;
    }

    // Verify recipient is in same company
    const recipient = await db.select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.id, recipientId), eq(usersTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!recipient[0]) {
      res.status(404).json({ error: "not_found", message: "Recipient not found" });
      return;
    }

    const id = generateId();
    await db.insert(messagesTable).values({
      id,
      companyId: req.user!.companyId,
      senderId: req.user!.id,
      recipientId,
      content: content?.trim() || "",
      ...(invoiceId ? { invoiceId } : {}),
      ...(attachmentType && attachmentId ? { attachmentType, attachmentId } : {}),
    });

    // Fetch sender name for the notification
    const senderRows = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const senderName = senderRows[0]?.name ?? "Someone";
    const preview = content.trim().length > 80 ? content.trim().slice(0, 77) + "…" : content.trim();

    await db.insert(notificationsTable).values({
      id: generateId(),
      userId: recipientId,
      type: "new_message",
      title: `New message from ${senderName}`,
      message: preview,
      relatedEntityId: req.user!.id,
      relatedEntityType: "user",
    });

    res.status(201).json({ id, recipientId, content: content?.trim() || "", invoiceId: invoiceId ?? null, invoice: null, attachmentType: attachmentType ?? null, attachmentId: attachmentId ?? null, attachment: null, createdAt: new Date().toISOString(), mine: true });
  } catch (err) {
    req.log.error({ err }, "Send message error");
    res.status(500).json({ error: "server_error", message: "Failed to send message" });
  }
});

// POST /api/messages/broadcast — send same message to multiple recipients
router.post("/messages/broadcast", authenticate, async (req, res) => {
  try {
    const { recipientIds, content } = req.body;
    if (!Array.isArray(recipientIds) || recipientIds.length === 0 || !content?.trim()) {
      res.status(400).json({ error: "validation_error", message: "recipientIds and content are required" });
      return;
    }

    const recipients = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(sql`${usersTable.id} = ANY(${recipientIds})`, eq(usersTable.companyId, req.user!.companyId)));

    const senderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const senderName = senderRows[0]?.name ?? "Someone";
    const preview = content.trim().length > 80 ? content.trim().slice(0, 77) + "…" : content.trim();

    let sent = 0;
    for (const recipient of recipients) {
      if (recipient.id === req.user!.id) continue;
      await db.insert(messagesTable).values({
        id: generateId(),
        companyId: req.user!.companyId,
        senderId: req.user!.id,
        recipientId: recipient.id,
        content: content.trim(),
      });
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId: recipient.id,
        type: "new_message",
        title: `New message from ${senderName}`,
        message: preview,
        relatedEntityId: req.user!.id,
        relatedEntityType: "user",
      });
      sent++;
    }

    res.json({ sent });
  } catch (err) {
    req.log.error({ err }, "Broadcast message error");
    res.status(500).json({ error: "server_error", message: "Failed to send broadcast" });
  }
});

// PATCH /api/messages/:id — edit own message
router.patch("/messages/:id", authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ error: "validation_error", message: "content is required" });
      return;
    }
    const rows = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.id, req.params.id), eq(messagesTable.senderId, req.user!.id)))
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "not_found", message: "Message not found or not yours" });
      return;
    }
    const now = new Date();
    await db.update(messagesTable)
      .set({ content: content.trim(), editedAt: now })
      .where(eq(messagesTable.id, req.params.id));
    res.json({ id: req.params.id, content: content.trim(), editedAt: now.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Edit message error");
    res.status(500).json({ error: "server_error", message: "Failed to edit message" });
  }
});

// DELETE /api/messages/:id — delete own message
router.delete("/messages/:id", authenticate, async (req, res) => {
  try {
    const rows = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.id, req.params.id), eq(messagesTable.senderId, req.user!.id)))
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "not_found", message: "Message not found or not yours" });
      return;
    }
    await db.delete(messagesTable).where(eq(messagesTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete message error");
    res.status(500).json({ error: "server_error", message: "Failed to delete message" });
  }
});

// GET /api/messages/users — list company users to start new conversations with
router.get("/messages/users", authenticate, async (req, res) => {
  try {
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.companyId, req.user!.companyId));

    res.json(users.filter(u => u.id !== req.user!.id));
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ error: "server_error", message: "Failed to list users" });
  }
});

// GET /api/messages/unread-count — total unread for current user
router.get("/messages/unread-count", authenticate, async (req, res) => {
  try {
    const rows = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.recipientId, req.user!.id),
          sql`${messagesTable.readAt} IS NULL`
        )
      );
    res.json({ count: rows.length });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to get unread count" });
  }
});

export default router;
