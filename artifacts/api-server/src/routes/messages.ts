import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { messagesTable, usersTable, notificationsTable, invoicesTable, documentsTable, photosTable, permitsTable, messageReactionsTable } from "@workspace/db/schema";
import { eq, and, or, desc, lt, gt, sql, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendNewMessageEmail } from "../lib/email";

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
          .where(inArray(usersTable.id, userIds))
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
// Supports ?before=<id> (load older page), ?after=<id> (poll for new), default = last 50
router.get("/messages/thread/:userId", authenticate, async (req, res) => {
  try {
    const me = req.user!.id;
    const other = req.params.userId as string;
    const companyId = req.user!.companyId;
    const role = req.user!.role;
    const canViewAll = role === "admin" || role === "project_manager";
    const isViewAll = canViewAll && req.query.all === "true";
    const before = req.query.before as string | undefined;
    const after = req.query.after as string | undefined;
    const PAGE_SIZE = 50;

    // Build base conversation filter
    const convFilter = isViewAll
      ? (() => {
          const [a, b] = other.split(":");
          return and(
            eq(messagesTable.companyId, companyId),
            or(
              and(eq(messagesTable.senderId, a), eq(messagesTable.recipientId, b)),
              and(eq(messagesTable.senderId, b), eq(messagesTable.recipientId, a))
            )
          );
        })()
      : and(
          eq(messagesTable.companyId, companyId),
          or(
            and(eq(messagesTable.senderId, me), eq(messagesTable.recipientId, other)),
            and(eq(messagesTable.senderId, other), eq(messagesTable.recipientId, me))
          )
        );

    // Resolve pivot date for cursor
    let pivotDate: Date | undefined;
    if (before || after) {
      const pivot = await db.select({ createdAt: messagesTable.createdAt })
        .from(messagesTable).where(eq(messagesTable.id, (before ?? after)!)).limit(1);
      pivotDate = pivot[0]?.createdAt;
    }

    let rows: (typeof messagesTable.$inferSelect)[];
    let hasMore = false;
    let readUpdates: { id: string; readAt: string }[] = [];

    if (after && pivotDate) {
      // Poll: new messages since pivot, ascending, capped at 100
      rows = await db.select().from(messagesTable)
        .where(and(convFilter, gt(messagesTable.createdAt, pivotDate)))
        .orderBy(messagesTable.createdAt).limit(100);

      // Also return read receipts for sent messages so the sender's UI can update
      if (!isViewAll) {
        const readRows = await db.select({ id: messagesTable.id, readAt: messagesTable.readAt })
          .from(messagesTable)
          .where(and(convFilter, eq(messagesTable.senderId, me), sql`${messagesTable.readAt} IS NOT NULL`));
        readUpdates = readRows.map(r => ({ id: r.id, readAt: r.readAt!.toISOString() }));
      }
    } else if (before && pivotDate) {
      // Load older page: messages before pivot, descending then reversed
      const fetched = await db.select().from(messagesTable)
        .where(and(convFilter, lt(messagesTable.createdAt, pivotDate)))
        .orderBy(desc(messagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    } else {
      // Initial load: last PAGE_SIZE messages
      const fetched = await db.select().from(messagesTable)
        .where(convFilter)
        .orderBy(desc(messagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    }

    // Mark unread as read
    if (!isViewAll && !before) {
      if (after) {
        // Poll: mark only the newly fetched messages
        const unreadIds = rows.filter(r => r.recipientId === me && !r.readAt).map(r => r.id);
        if (unreadIds.length) {
          await db.update(messagesTable).set({ readAt: new Date() })
            .where(inArray(messagesTable.id, unreadIds));
        }
      } else {
        // Initial load: mark all unread in this conversation (including older pages)
        await db.update(messagesTable).set({ readAt: new Date() })
          .where(and(convFilter, eq(messagesTable.recipientId, me), sql`${messagesTable.readAt} IS NULL`));
      }
    }

    // Fetch sender names
    const userIds = Array.from(new Set(rows.flatMap(r => [r.senderId, r.recipientId])));
    const userRows = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
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
        }).from(invoicesTable).where(inArray(invoicesTable.id, invoiceIds))
      : [];
    const invoiceMap = Object.fromEntries(invoiceRows.map(inv => [inv.id, inv]));

    // Fetch document/photo/permit attachments
    const docIds = rows.filter(r => r.attachmentType === "document" && r.attachmentId).map(r => r.attachmentId as string);
    const photoIds = rows.filter(r => r.attachmentType === "photo" && r.attachmentId).map(r => r.attachmentId as string);
    const permitIds = rows.filter(r => r.attachmentType === "permit" && r.attachmentId).map(r => r.attachmentId as string);

    const docRows = docIds.length
      ? await db.select({ id: documentsTable.id, name: documentsTable.name, type: documentsTable.type, fileUrl: documentsTable.fileUrl, status: documentsTable.status, version: documentsTable.version })
          .from(documentsTable).where(inArray(documentsTable.id, docIds))
      : [];
    const photoRows = photoIds.length
      ? await db.select({ id: photosTable.id, photoUrl: photosTable.photoUrl, category: photosTable.category, description: photosTable.description, referenceNumber: photosTable.referenceNumber, zone: photosTable.zone })
          .from(photosTable).where(inArray(photosTable.id, photoIds))
      : [];
    const permitRows = permitIds.length
      ? await db.select({ id: permitsTable.id, type: permitsTable.type, description: permitsTable.description, expiryDate: permitsTable.expiryDate, documentUrl: permitsTable.documentUrl })
          .from(permitsTable).where(inArray(permitsTable.id, permitIds))
      : [];

    const docMap = Object.fromEntries(docRows.map(d => [d.id, d]));
    const photoMap = Object.fromEntries(photoRows.map(p => [p.id, p]));
    const permitMap = Object.fromEntries(permitRows.map(p => [p.id, p]));

    // Fetch reactions
    const msgIds = rows.map(r => r.id);
    const reactionRows = msgIds.length
      ? await db.select().from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, msgIds))
      : [];
    const reactionMap = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of reactionRows) {
      if (!reactionMap.has(r.messageId)) reactionMap.set(r.messageId, new Map());
      const emojiMap = reactionMap.get(r.messageId)!;
      const existing = emojiMap.get(r.emoji) ?? { count: 0, mine: false };
      emojiMap.set(r.emoji, { count: existing.count + 1, mine: existing.mine || r.userId === me });
    }
    const reactionsFor = (id: string) =>
      Array.from(reactionMap.get(id)?.entries() ?? []).map(([emoji, v]) => ({ emoji, ...v }));

    // Fetch quoted messages
    const replyIds = Array.from(new Set(rows.map(r => r.replyToId).filter(Boolean))) as string[];
    const replyRows = replyIds.length
      ? await db.select({ id: messagesTable.id, senderId: messagesTable.senderId, content: messagesTable.content, attachmentType: messagesTable.attachmentType })
          .from(messagesTable).where(inArray(messagesTable.id, replyIds))
      : [];
    const replyMap = Object.fromEntries(replyRows.map(r => [r.id, r]));

    res.json({
      hasMore,
      readUpdates,
      messages: rows.map(m => ({
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
        reactions: reactionsFor(m.id),
        replyToId: m.replyToId ?? null,
        replyTo: m.replyToId ? (() => {
          const q = replyMap[m.replyToId!];
          if (!q) return null;
          return { id: q.id, senderName: userMap[q.senderId] ?? "Unknown", content: q.content, attachmentType: q.attachmentType ?? null };
        })() : null,
        readAt: m.readAt?.toISOString() ?? null,
        editedAt: m.editedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        mine: m.senderId === me,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get thread error");
    res.status(500).json({ error: "server_error", message: "Failed to get thread" });
  }
});

// POST /api/messages — send a message
router.post("/messages", authenticate, async (req, res) => {
  try {
    const { recipientId, content, invoiceId, attachmentType, attachmentId, replyToId } = req.body;
    if (!recipientId || (!content?.trim() && !invoiceId && !attachmentId)) {
      res.status(400).json({ error: "validation_error", message: "recipientId and content, invoiceId, or attachment are required" });
      return;
    }

    // Verify recipient is in same company and fetch email prefs
    const recipient = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, emailNotifications: usersTable.emailNotifications })
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
      ...(replyToId ? { replyToId } : {}),
    });

    // Fetch sender name for the notification
    const senderRows = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const senderName = senderRows[0]?.name ?? "Someone";
    const preview = content?.trim().length > 80 ? content.trim().slice(0, 77) + "…" : content?.trim() ?? "";

    await db.insert(notificationsTable).values({
      id: generateId(),
      userId: recipientId,
      type: "new_message",
      title: `New message from ${senderName}`,
      message: preview,
      relatedEntityId: req.user!.id,
      relatedEntityType: "user",
    });

    // Email notification if opted in
    if (recipient[0].emailNotifications) {
      sendNewMessageEmail(recipient[0].email, recipient[0].name, senderName, preview, false, "").catch(() => {});
    }

    res.status(201).json({ id, recipientId, content: content?.trim() || "", invoiceId: invoiceId ?? null, invoice: null, attachmentType: attachmentType ?? null, attachmentId: attachmentId ?? null, attachment: null, readAt: null, createdAt: new Date().toISOString(), mine: true });
  } catch (err) {
    req.log.error({ err }, "Send message error");
    res.status(500).json({ error: "server_error", message: "Failed to send message" });
  }
});

// POST /api/messages/broadcast — send same message to multiple recipients
router.post("/messages/broadcast", authenticate, async (req, res) => {
  try {
    const { recipientIds, content, attachmentType, attachmentId } = req.body;
    if (!Array.isArray(recipientIds) || recipientIds.length === 0 || (!content?.trim() && !attachmentId)) {
      res.status(400).json({ error: "validation_error", message: "recipientIds and content or attachmentId are required" });
      return;
    }

    const recipients = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(inArray(usersTable.id, recipientIds), eq(usersTable.companyId, req.user!.companyId)));

    const senderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const senderName = senderRows[0]?.name ?? "Someone";
    const msgContent = content?.trim() ?? "";
    const preview = msgContent.length > 80 ? msgContent.slice(0, 77) + "…" : (msgContent || "Shared a file");

    let sent = 0;
    for (const recipient of recipients) {
      if (recipient.id === req.user!.id) continue;
      await db.insert(messagesTable).values({
        id: generateId(),
        companyId: req.user!.companyId,
        senderId: req.user!.id,
        recipientId: recipient.id,
        content: msgContent,
        ...(attachmentType && attachmentId ? { attachmentType, attachmentId } : {}),
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

// POST /api/messages/:id/react — toggle a reaction (add if absent, remove if present)
router.post("/messages/:id/react", authenticate, async (req, res) => {
  try {
    const { emoji } = req.body;
    const ALLOWED = ["👍", "✅", "👀", "❤️", "😂"];
    if (!emoji || !ALLOWED.includes(emoji)) {
      res.status(400).json({ error: "validation_error", message: "Invalid emoji" });
      return;
    }
    const userId = req.user!.id;
    const messageId = req.params.id;

    const existing = await db.select().from(messageReactionsTable)
      .where(and(eq(messageReactionsTable.messageId, messageId), eq(messageReactionsTable.userId, userId), eq(messageReactionsTable.emoji, emoji)))
      .limit(1);

    if (existing[0]) {
      await db.delete(messageReactionsTable)
        .where(and(eq(messageReactionsTable.messageId, messageId), eq(messageReactionsTable.userId, userId), eq(messageReactionsTable.emoji, emoji)));
    } else {
      await db.insert(messageReactionsTable).values({ id: generateId(), messageId, userId, emoji });
    }

    const all = await db.select().from(messageReactionsTable).where(eq(messageReactionsTable.messageId, messageId));
    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of all) {
      const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
      grouped.set(r.emoji, { count: g.count + 1, mine: g.mine || r.userId === userId });
    }
    res.json(Array.from(grouped.entries()).map(([e, v]) => ({ emoji: e, ...v })));
  } catch (err) {
    req.log.error({ err }, "React to message error");
    res.status(500).json({ error: "server_error", message: "Failed to react" });
  }
});

// GET /api/messages/search?q= — search DM message content
router.get("/messages/search", authenticate, async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q || q.length < 2) { res.json([]); return; }

    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const role = req.user!.role;
    const canViewAll = role === "admin" || role === "project_manager";

    const rows = await db.select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.companyId, companyId),
          canViewAll
            ? sql`true`
            : or(eq(messagesTable.senderId, userId), eq(messagesTable.recipientId, userId)),
          sql`${messagesTable.content} ILIKE ${"%" + q + "%"}`
        )
      )
      .orderBy(desc(messagesTable.createdAt))
      .limit(30);

    const userIds = Array.from(new Set(rows.flatMap(r => [r.senderId, r.recipientId])));
    const userRows = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u.name]));

    res.json(rows.map(m => ({
      id: m.id,
      content: m.content,
      senderId: m.senderId,
      senderName: userMap[m.senderId] ?? "Unknown",
      recipientId: m.recipientId,
      recipientName: userMap[m.recipientId] ?? "Unknown",
      otherId: m.senderId === userId ? m.recipientId : m.senderId,
      otherName: m.senderId === userId ? (userMap[m.recipientId] ?? "Unknown") : (userMap[m.senderId] ?? "Unknown"),
      createdAt: m.createdAt.toISOString(),
      mine: m.senderId === userId,
    })));
  } catch (err) {
    req.log.error({ err }, "Search messages error");
    res.status(500).json({ error: "server_error", message: "Failed to search" });
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
