import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  channelMessagesTable, channelReadsTable,
  channelMessageReactionsTable,
  usersTable, projectsTable, projectMembersTable,
  notificationsTable, documentsTable, photosTable, permitsTable,
  companyMembersTable,
} from "@workspace/db/schema";
import { eq, and, gt, lt, sql, desc, inArray, ne } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { sendChannelMessage, toggleChannelMessageReaction, isAllowedReactionEmoji } from "../lib/messaging";

const router: IRouter = Router();

// Channel-list preview: message text, or a typed label for attachment-only posts.
function channelPreview(m: { content: string | null; attachmentType?: string | null }): string {
  if (m.content && m.content.trim()) return m.content;
  if (m.attachmentType === "document") return "📄 Document";
  if (m.attachmentType === "photo") return "📷 Photo";
  if (m.attachmentType === "permit") return "📋 Permit";
  return m.content ?? "";
}

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
      .where(inArray(channelMessagesTable.projectId, projectIds))
      .orderBy(desc(channelMessagesTable.createdAt));

    const lastMsgMap = new Map<string, typeof lastMsgs[0]>();
    for (const m of lastMsgs) {
      if (!lastMsgMap.has(m.projectId)) lastMsgMap.set(m.projectId, m);
    }

    // User's last-read timestamps
    const readRows = await db.select()
      .from(channelReadsTable)
      .where(and(
        inArray(channelReadsTable.projectId, projectIds),
        eq(channelReadsTable.userId, userId),
      ));
    const readMap = new Map(readRows.map(r => [r.projectId, r.lastReadAt]));

    // Unread counts
    const unreadRows = await db.select({ projectId: channelMessagesTable.projectId, id: channelMessagesTable.id })
      .from(channelMessagesTable)
      .where(and(inArray(channelMessagesTable.projectId, projectIds), ne(channelMessagesTable.senderId, userId)));

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
        lastMessage: last ? channelPreview(last) : "",
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
          inArray(channelMessagesTable.projectId, accessibleProjectIds),
          sql`${channelMessagesTable.content} ILIKE ${"%" + q + "%"}`
        )
      )
      .orderBy(desc(channelMessagesTable.createdAt))
      .limit(30);

    const senderIds = Array.from(new Set(rows.map(r => r.senderId)));
    const userRows = senderIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable).where(inArray(usersTable.id, senderIds))
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u.name]));

    const projectIds = Array.from(new Set(rows.map(r => r.projectId)));
    const projectRows = projectIds.length
      ? await db.select({ id: projectsTable.id, name: projectsTable.name })
          .from(projectsTable).where(inArray(projectsTable.id, projectIds))
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

    // Sender names + their role in THIS company (membership role, not home role).
    const senderIds = Array.from(new Set(rows.map(r => r.senderId)));
    const userRows = senderIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name, role: companyMembersTable.role })
          .from(usersTable)
          .leftJoin(companyMembersTable, and(eq(companyMembersTable.userId, usersTable.id), eq(companyMembersTable.companyId, companyId)))
          .where(inArray(usersTable.id, senderIds))
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, { id: u.id, name: u.name, role: u.role ?? "" }]));

    // Attachment data
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
      ? await db.select().from(channelMessageReactionsTable).where(inArray(channelMessageReactionsTable.channelMessageId, msgIds))
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
          .from(channelMessagesTable).where(inArray(channelMessagesTable.id, replyIds))
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

    const sent = await sendChannelMessage({
      projectId, companyId, senderId: userId, content: content?.trim() || "",
      attachmentType, attachmentId, replyToId,
    });

    res.status(201).json({
      id: sent.id, projectId, senderId: userId, senderName: sent.senderName, senderRole: req.user!.role,
      content: sent.content,
      attachmentType: attachmentType ?? null, attachmentId: attachmentId ?? null, attachment: null,
      editedAt: null, createdAt: sent.createdAt.toISOString(), mine: true,
    });
  } catch (err) {
    req.log.error({ err }, "Send channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to send message" });
  }
});

// Channel messages are permanent — no PATCH/DELETE. Once a message is posted
// to a project channel it's part of the record every member (including the
// Team Portal) reads; a PM editing/deleting their own post after the fact
// would undermine that. (Deliberate removal — this channel used to support
// edit/delete like DMs; the Team Portal now reading this same channel changed
// that trade-off.)

// POST /api/channel-messages/:id/react — toggle a reaction. Tenant-scoped: the
// message must belong to the caller's active company before it can be reacted
// to, otherwise any authenticated user could react to another company's
// messages (and read their reaction counts) by guessing ids.
router.post("/channel-messages/:id/react", authenticate, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji || !isAllowedReactionEmoji(emoji)) {
      res.status(400).json({ error: "validation_error", message: "Invalid emoji" });
      return;
    }
    const msg = await db.select({ id: channelMessagesTable.id }).from(channelMessagesTable)
      .where(and(eq(channelMessagesTable.id, req.params.id), eq(channelMessagesTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!msg[0]) { res.status(404).json({ error: "not_found", message: "Message not found" }); return; }
    res.json(await toggleChannelMessageReaction(req.params.id, req.user!.id, emoji));
  } catch (err) {
    req.log.error({ err }, "React to channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to react" });
  }
});

export default router;
