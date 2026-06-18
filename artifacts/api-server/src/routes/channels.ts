import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  channelMessagesTable, channelReadsTable,
  channelMessageReactionsTable,
  usersTable, projectsTable, projectMembersTable,
  notificationsTable, documentsTable, photosTable, permitsTable,
} from "@workspace/db/schema";
import { eq, and, gt, lt, sql, desc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendNewMessageEmail } from "../lib/email";

const router: IRouter = Router();

// GET /api/channels — list project channels accessible to the current user, with unread count + last message
router.get("/channels", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const role = req.user!.role;

    // Get accessible projects
    let projects;
    if (role === "admin" || role === "project_manager") {
      projects = await db.select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(and(eq(projectsTable.companyId, companyId), eq(projectsTable.status, "active")));
    } else {
      projects = await db.select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .innerJoin(projectMembersTable, eq(projectMembersTable.projectId, projectsTable.id))
        .where(and(
          eq(projectsTable.companyId, companyId),
          eq(projectsTable.status, "active"),
          eq(projectMembersTable.userId, userId),
        ));
    }

    if (projects.length === 0) { res.json([]); return; }

    const projectIds = projects.map(p => p.id);

    // Last message per project
    const lastMsgs = await db.select()
      .from(channelMessagesTable)
      .where(sql`${channelMessagesTable.projectId} = ANY(${projectIds})`)
      .orderBy(desc(channelMessagesTable.createdAt));

    const lastMsgMap = new Map<string, typeof lastMsgs[0]>();
    for (const m of lastMsgs) {
      if (!lastMsgMap.has(m.projectId)) lastMsgMap.set(m.projectId, m);
    }

    // User's last-read timestamps
    const readRows = await db.select()
      .from(channelReadsTable)
      .where(and(
        sql`${channelReadsTable.projectId} = ANY(${projectIds})`,
        eq(channelReadsTable.userId, userId),
      ));
    const readMap = new Map(readRows.map(r => [r.projectId, r.lastReadAt]));

    // Unread counts
    const unreadRows = await db.select({ projectId: channelMessagesTable.projectId, id: channelMessagesTable.id })
      .from(channelMessagesTable)
      .where(sql`${channelMessagesTable.projectId} = ANY(${projectIds}) AND ${channelMessagesTable.senderId} != ${userId}`);

    const unreadMap = new Map<string, number>();
    for (const row of unreadRows) {
      const lastRead = readMap.get(row.projectId);
      // We need createdAt to compare — fetch it separately or use a different approach
      // For simplicity, count all unread using the lastMsgs we already have
      unreadMap.set(row.projectId, 0);
    }
    // Recompute properly using lastMsgs
    for (const [pid, lastRead] of readMap.entries()) {
      const unread = lastMsgs.filter(m => m.projectId === pid && m.senderId !== userId && m.createdAt > lastRead).length;
      unreadMap.set(pid, unread);
    }
    // Projects never opened get all non-own messages as unread
    for (const pid of projectIds) {
      if (!readMap.has(pid)) {
        unreadMap.set(pid, lastMsgs.filter(m => m.projectId === pid && m.senderId !== userId).length);
      }
    }

    res.json(projects.map(p => {
      const last = lastMsgMap.get(p.id);
      return {
        projectId: p.id,
        projectName: p.name,
        lastMessage: last?.content ?? "",
        lastAt: last?.createdAt.toISOString() ?? null,
        unread: unreadMap.get(p.id) ?? 0,
      };
    }));
  } catch (err) {
    req.log.error({ err }, "List channels error");
    res.status(500).json({ error: "server_error", message: "Failed to list channels" });
  }
});

// GET /api/channels/search?q= — search channel message content
router.get("/channels/search", authenticate, async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q || q.length < 2) { res.json([]); return; }

    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const role = req.user!.role;

    // Get accessible project IDs
    let accessibleProjectIds: string[];
    if (role === "admin" || role === "project_manager") {
      const projects = await db.select({ id: projectsTable.id }).from(projectsTable)
        .where(eq(projectsTable.companyId, companyId));
      accessibleProjectIds = projects.map(p => p.id);
    } else {
      const memberships = await db.select({ projectId: projectMembersTable.projectId })
        .from(projectMembersTable).where(eq(projectMembersTable.userId, userId));
      accessibleProjectIds = memberships.map(m => m.projectId);
    }

    if (accessibleProjectIds.length === 0) { res.json([]); return; }

    const rows = await db.select()
      .from(channelMessagesTable)
      .where(
        and(
          sql`${channelMessagesTable.projectId} = ANY(${accessibleProjectIds})`,
          sql`${channelMessagesTable.content} ILIKE ${"%" + q + "%"}`
        )
      )
      .orderBy(desc(channelMessagesTable.createdAt))
      .limit(30);

    const senderIds = Array.from(new Set(rows.map(r => r.senderId)));
    const userRows = senderIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable).where(sql`${usersTable.id} = ANY(${senderIds})`)
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u.name]));

    const projectIds = Array.from(new Set(rows.map(r => r.projectId)));
    const projectRows = projectIds.length
      ? await db.select({ id: projectsTable.id, name: projectsTable.name })
          .from(projectsTable).where(sql`${projectsTable.id} = ANY(${projectIds})`)
      : [];
    const projectMap = Object.fromEntries(projectRows.map(p => [p.id, p.name]));

    res.json(rows.map(m => ({
      id: m.id,
      content: m.content,
      senderId: m.senderId,
      senderName: userMap[m.senderId] ?? "Unknown",
      projectId: m.projectId,
      projectName: projectMap[m.projectId] ?? "Unknown",
      createdAt: m.createdAt.toISOString(),
      mine: m.senderId === userId,
    })));
  } catch (err) {
    req.log.error({ err }, "Search channel messages error");
    res.status(500).json({ error: "server_error", message: "Failed to search" });
  }
});

// GET /api/channels/:projectId/messages — fetch thread + mark read
// Supports ?before=<id> (load older page), ?after=<id> (poll for new), default = last 50
router.get("/channels/:projectId/messages", authenticate, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const before = req.query.before as string | undefined;
    const after = req.query.after as string | undefined;
    const PAGE_SIZE = 50;

    // Verify project belongs to company
    const project = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    // Resolve pivot date for cursor
    let pivotDate: Date | undefined;
    if (before || after) {
      const pivot = await db.select({ createdAt: channelMessagesTable.createdAt })
        .from(channelMessagesTable).where(eq(channelMessagesTable.id, (before ?? after)!)).limit(1);
      pivotDate = pivot[0]?.createdAt;
    }

    let rows: (typeof channelMessagesTable.$inferSelect)[];
    let hasMore = false;

    if (after && pivotDate) {
      rows = await db.select().from(channelMessagesTable)
        .where(and(eq(channelMessagesTable.projectId, projectId), gt(channelMessagesTable.createdAt, pivotDate)))
        .orderBy(channelMessagesTable.createdAt).limit(100);
    } else if (before && pivotDate) {
      const fetched = await db.select().from(channelMessagesTable)
        .where(and(eq(channelMessagesTable.projectId, projectId), lt(channelMessagesTable.createdAt, pivotDate)))
        .orderBy(desc(channelMessagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    } else {
      const fetched = await db.select().from(channelMessagesTable)
        .where(eq(channelMessagesTable.projectId, projectId))
        .orderBy(desc(channelMessagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    }

    // Sender names
    const senderIds = Array.from(new Set(rows.map(r => r.senderId)));
    const userRows = senderIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
          .from(usersTable).where(sql`${usersTable.id} = ANY(${senderIds})`)
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u]));

    // Attachment data
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

    // Fetch reactions
    const msgIds = rows.map(r => r.id);
    const reactionRows = msgIds.length
      ? await db.select().from(channelMessageReactionsTable).where(sql`${channelMessageReactionsTable.channelMessageId} = ANY(${msgIds})`)
      : [];
    const reactionMap = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of reactionRows) {
      if (!reactionMap.has(r.channelMessageId)) reactionMap.set(r.channelMessageId, new Map());
      const emojiMap = reactionMap.get(r.channelMessageId)!;
      const existing = emojiMap.get(r.emoji) ?? { count: 0, mine: false };
      emojiMap.set(r.emoji, { count: existing.count + 1, mine: existing.mine || r.userId === userId });
    }
    const reactionsFor = (id: string) =>
      Array.from(reactionMap.get(id)?.entries() ?? []).map(([emoji, v]) => ({ emoji, ...v }));

    // Fetch quoted messages
    const replyIds = Array.from(new Set(rows.map(r => r.replyToId).filter(Boolean))) as string[];
    const replyRows = replyIds.length
      ? await db.select({ id: channelMessagesTable.id, senderId: channelMessagesTable.senderId, content: channelMessagesTable.content, attachmentType: channelMessagesTable.attachmentType })
          .from(channelMessagesTable).where(sql`${channelMessagesTable.id} = ANY(${replyIds})`)
      : [];
    const replyMap = Object.fromEntries(replyRows.map(r => [r.id, r]));

    // Mark as read (initial load and polls only; skip for "load older")
    if (!before) {
      const now = new Date();
      const existing = await db.select().from(channelReadsTable)
        .where(and(eq(channelReadsTable.projectId, projectId), eq(channelReadsTable.userId, userId)))
        .limit(1);
      if (existing[0]) {
        await db.update(channelReadsTable).set({ lastReadAt: now })
          .where(and(eq(channelReadsTable.projectId, projectId), eq(channelReadsTable.userId, userId)));
      } else {
        await db.insert(channelReadsTable).values({ projectId, userId, lastReadAt: now });
      }
    }

    res.json({
      hasMore,
      messages: rows.map(m => ({
        id: m.id,
        projectId: m.projectId,
        senderId: m.senderId,
        senderName: userMap[m.senderId]?.name ?? "Unknown",
        senderRole: userMap[m.senderId]?.role ?? "",
        content: m.content,
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
          return { id: q.id, senderName: userMap[q.senderId]?.name ?? "Unknown", content: q.content, attachmentType: q.attachmentType ?? null };
        })() : null,
        editedAt: m.editedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        mine: m.senderId === userId,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get channel messages error");
    res.status(500).json({ error: "server_error", message: "Failed to get channel messages" });
  }
});

// POST /api/channels/:projectId/messages — send a channel message
router.post("/channels/:projectId/messages", authenticate, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { content, attachmentType, attachmentId, replyToId } = req.body;
    const userId = req.user!.id;
    const companyId = req.user!.companyId;

    if (!content?.trim() && !attachmentId) {
      res.status(400).json({ error: "validation_error", message: "content or attachment is required" });
      return;
    }

    const project = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const id = generateId();
    await db.insert(channelMessagesTable).values({
      id,
      projectId,
      companyId,
      senderId: userId,
      content: content?.trim() || "",
      ...(attachmentType && attachmentId ? { attachmentType, attachmentId } : {}),
      ...(replyToId ? { replyToId } : {}),
    });

    // Notify other project members
    const senderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const senderName = senderRows[0]?.name ?? "Someone";
    const preview = (content?.trim() ?? "").length > 80 ? content.trim().slice(0, 77) + "…" : (content?.trim() ?? (attachmentType ?? "Attachment"));

    const members = await db.select({ userId: projectMembersTable.userId })
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), sql`${projectMembersTable.userId} != ${userId} AND ${projectMembersTable.userId} IS NOT NULL`));

    // Fetch member email prefs in one batch
    const memberIds = members.map(m => m.userId).filter(Boolean) as string[];
    const memberUsers = memberIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, emailNotifications: usersTable.emailNotifications })
          .from(usersTable).where(sql`${usersTable.id} = ANY(${memberIds})`)
      : [];
    const memberMap = new Map(memberUsers.map(u => [u.id, u]));

    for (const m of members) {
      if (!m.userId) continue;
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId: m.userId,
        type: "new_message",
        title: `${senderName} in #${project[0].name}`,
        message: preview,
        relatedEntityId: projectId,
        relatedEntityType: "project",
      });
      const mu = memberMap.get(m.userId);
      if (mu?.emailNotifications) {
        sendNewMessageEmail(mu.email, mu.name, senderName, preview, true, project[0].name).catch(() => {});
      }
    }

    res.status(201).json({
      id, projectId, senderId: userId, senderName, senderRole: req.user!.role,
      content: content?.trim() || "",
      attachmentType: attachmentType ?? null, attachmentId: attachmentId ?? null, attachment: null,
      editedAt: null, createdAt: new Date().toISOString(), mine: true,
    });
  } catch (err) {
    req.log.error({ err }, "Send channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to send message" });
  }
});

// PATCH /api/channel-messages/:id — edit own message
router.patch("/channel-messages/:id", authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ error: "validation_error", message: "content is required" });
      return;
    }
    const rows = await db.select().from(channelMessagesTable)
      .where(and(eq(channelMessagesTable.id, req.params.id), eq(channelMessagesTable.senderId, req.user!.id)))
      .limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Message not found or not yours" }); return; }
    const now = new Date();
    await db.update(channelMessagesTable)
      .set({ content: content.trim(), editedAt: now })
      .where(eq(channelMessagesTable.id, req.params.id));
    res.json({ id: req.params.id, content: content.trim(), editedAt: now.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Edit channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to edit message" });
  }
});

// POST /api/channel-messages/:id/react — toggle a reaction
router.post("/channel-messages/:id/react", authenticate, async (req, res) => {
  try {
    const { emoji } = req.body;
    const ALLOWED = ["👍", "✅", "👀", "❤️", "😂"];
    if (!emoji || !ALLOWED.includes(emoji)) {
      res.status(400).json({ error: "validation_error", message: "Invalid emoji" });
      return;
    }
    const userId = req.user!.id;
    const channelMessageId = req.params.id;

    const existing = await db.select().from(channelMessageReactionsTable)
      .where(and(eq(channelMessageReactionsTable.channelMessageId, channelMessageId), eq(channelMessageReactionsTable.userId, userId), eq(channelMessageReactionsTable.emoji, emoji)))
      .limit(1);

    if (existing[0]) {
      await db.delete(channelMessageReactionsTable)
        .where(and(eq(channelMessageReactionsTable.channelMessageId, channelMessageId), eq(channelMessageReactionsTable.userId, userId), eq(channelMessageReactionsTable.emoji, emoji)));
    } else {
      await db.insert(channelMessageReactionsTable).values({ id: generateId(), channelMessageId, userId, emoji });
    }

    const all = await db.select().from(channelMessageReactionsTable).where(eq(channelMessageReactionsTable.channelMessageId, channelMessageId));
    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of all) {
      const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
      grouped.set(r.emoji, { count: g.count + 1, mine: g.mine || r.userId === userId });
    }
    res.json(Array.from(grouped.entries()).map(([e, v]) => ({ emoji: e, ...v })));
  } catch (err) {
    req.log.error({ err }, "React to channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to react" });
  }
});

// DELETE /api/channel-messages/:id — delete own message
router.delete("/channel-messages/:id", authenticate, async (req, res) => {
  try {
    const rows = await db.select().from(channelMessagesTable)
      .where(and(eq(channelMessagesTable.id, req.params.id), eq(channelMessagesTable.senderId, req.user!.id)))
      .limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Message not found or not yours" }); return; }
    await db.delete(channelMessagesTable).where(eq(channelMessagesTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to delete message" });
  }
});

export default router;
