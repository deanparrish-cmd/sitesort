import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  messagesTable, channelMessagesTable, channelReadsTable, messageReactionsTable, channelMessageReactionsTable,
  projectMembersTable, peopleTable, subcontractorsTable, usersTable, projectsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, gt, lt, inArray, ne } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { requirePortalSession, requirePortalMember } from "../middlewares/portal";
import { portalGuards } from "./portal";
import { logActivity } from "../lib/activity";
import { removedFromProjectUserIds } from "../lib/project-membership";
import { sendDirectMessage, sendChannelMessage, toggleMessageReaction, toggleChannelMessageReaction, isAllowedReactionEmoji } from "../lib/messaging";

// Team Portal Messages — reuses the SAME messages/channel_messages tables and
// send/react logic as the dashboard (lib/messaging.ts), scoped to the calling
// member's project. A structural section (like Team/Progress/Daily Report) —
// every member sees it, not portal_shares-gated. v1 composer scope: plain
// text + reactions + read receipts only (no attachments/invoice/reply-to/
// quick-replies — see the plan for this feature).

const router: IRouter = Router();
const PAGE_SIZE = 50;

// "Self-employed" / "In-house" / the firm's name — same rule as team-tab.tsx's
// companyLabel(), computed server-side so the picker never needs to reimplement it.
function companyLabel(contactType: string | null, companyName: string | null): string {
  if (contactType === "self_employed") return "Self-employed";
  if (!companyName) return "In-house";
  return companyName;
}

// GET /api/portal/messages/participants — everyone on this project a member
// can message. No email/phone, ever — messaging is by person, not address.
router.get("/portal/messages/participants", ...portalGuards, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const rows = await db.select({
      userId: projectMembersTable.userId, personId: projectMembersTable.personId, role: projectMembersTable.role,
    }).from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, pid), ne(projectMembersTable.userId, req.user!.id)));

    const withUser = rows.filter((r): r is typeof r & { userId: string } => !!r.userId);
    const personIds = withUser.map(r => r.personId).filter((x): x is string => !!x);
    const personRows = personIds.length
      ? await db.select({
          id: peopleTable.id, name: peopleTable.name, contactType: subcontractorsTable.contactType, companyName: subcontractorsTable.companyName,
        }).from(peopleTable)
          .leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
          .where(inArray(peopleTable.id, personIds))
      : [];
    const personMap = new Map(personRows.map(p => [p.id, p]));

    const legacyUserIds = withUser.filter(r => !r.personId).map(r => r.userId);
    const legacyUserRows = legacyUserIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, legacyUserIds))
      : [];
    const legacyUserMap = new Map(legacyUserRows.map(u => [u.id, u]));

    const out = withUser.map(r => {
      const p = r.personId ? personMap.get(r.personId) : undefined;
      if (p) return { userId: r.userId, name: p.name, companyLabel: companyLabel(p.contactType, p.companyName), role: r.role };
      const u = legacyUserMap.get(r.userId);
      return { userId: r.userId, name: u?.name ?? "Unknown", companyLabel: "In-house", role: r.role };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Portal list message participants error");
    res.status(500).json({ error: "server_error", message: "Failed to load participants" });
  }
});

// GET /api/portal/messages — channel summary + this member's DM conversations.
router.get("/portal/messages", ...portalGuards, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const me = req.user!.id;

    const lastChannelMsg = await db.select().from(channelMessagesTable)
      .where(eq(channelMessagesTable.projectId, pid)).orderBy(desc(channelMessagesTable.createdAt)).limit(1);
    const channelRead = await db.select({ lastReadAt: channelReadsTable.lastReadAt }).from(channelReadsTable)
      .where(and(eq(channelReadsTable.projectId, pid), eq(channelReadsTable.userId, me))).limit(1);
    const since = channelRead[0]?.lastReadAt;
    const channelUnread = since
      ? (await db.select({ id: channelMessagesTable.id }).from(channelMessagesTable)
          .where(and(eq(channelMessagesTable.projectId, pid), gt(channelMessagesTable.createdAt, since), ne(channelMessagesTable.senderId, me)))).length
      : (await db.select({ id: channelMessagesTable.id }).from(channelMessagesTable)
          .where(and(eq(channelMessagesTable.projectId, pid), ne(channelMessagesTable.senderId, me)))).length;

    const dmRows = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.projectId, pid), or(eq(messagesTable.senderId, me), eq(messagesTable.recipientId, me))))
      .orderBy(desc(messagesTable.createdAt));

    const otherIds = Array.from(new Set(dmRows.map(m => m.senderId === me ? m.recipientId : m.senderId)));
    const removed = await removedFromProjectUserIds(pid, otherIds);
    const userRows = otherIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, otherIds)) : [];
    const userMap = new Map(userRows.map(u => [u.id, u.name]));

    const participantRows = otherIds.length
      ? await db.select({ userId: projectMembersTable.userId, personId: projectMembersTable.personId })
          .from(projectMembersTable).where(and(eq(projectMembersTable.projectId, pid), inArray(projectMembersTable.userId, otherIds)))
      : [];
    const personIds = participantRows.map(r => r.personId).filter((x): x is string => !!x);
    const personRows = personIds.length
      ? await db.select({ id: peopleTable.id, contactType: subcontractorsTable.contactType, companyName: subcontractorsTable.companyName })
          .from(peopleTable).leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
          .where(inArray(peopleTable.id, personIds))
      : [];
    const personMap = new Map(personRows.map(p => [p.id, p]));
    const companyLabelFor = (otherId: string) => {
      const pm = participantRows.find(r => r.userId === otherId);
      const p = pm?.personId ? personMap.get(pm.personId) : undefined;
      return p ? companyLabel(p.contactType, p.companyName) : "In-house";
    };

    const convMap = new Map<string, { otherUserId: string; name: string; companyLabel: string; removedFromProject: boolean; lastMessage: string; lastAt: string; unread: number }>();
    for (const m of dmRows) {
      const otherId = m.senderId === me ? m.recipientId : m.senderId;
      if (!convMap.has(otherId)) {
        convMap.set(otherId, {
          otherUserId: otherId, name: userMap.get(otherId) ?? "Unknown", companyLabel: companyLabelFor(otherId),
          removedFromProject: removed.has(otherId),
          lastMessage: m.content || "", lastAt: m.createdAt.toISOString(),
          unread: (m.recipientId === me && !m.readAt) ? 1 : 0,
        });
      } else if (m.recipientId === me && !m.readAt) {
        convMap.get(otherId)!.unread += 1;
      }
    }

    res.json({
      channel: {
        lastMessage: lastChannelMsg[0]?.content ?? null,
        lastAt: lastChannelMsg[0]?.createdAt.toISOString() ?? null,
        unread: channelUnread,
      },
      conversations: Array.from(convMap.values()),
    });
  } catch (err) {
    req.log.error({ err }, "Portal get messages summary error");
    res.status(500).json({ error: "server_error", message: "Failed to load messages" });
  }
});

// GET /api/portal/messages/channel — the project channel thread.
router.get("/portal/messages/channel", ...portalGuards, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const me = req.user!.id;
    const before = req.query.before as string | undefined;
    const after = req.query.after as string | undefined;

    let pivotDate: Date | undefined;
    if (before || after) {
      const pivot = await db.select({ createdAt: channelMessagesTable.createdAt }).from(channelMessagesTable)
        .where(eq(channelMessagesTable.id, (before ?? after)!)).limit(1);
      pivotDate = pivot[0]?.createdAt;
    }

    let rows: (typeof channelMessagesTable.$inferSelect)[];
    let hasMore = false;
    if (after && pivotDate) {
      rows = await db.select().from(channelMessagesTable)
        .where(and(eq(channelMessagesTable.projectId, pid), gt(channelMessagesTable.createdAt, pivotDate)))
        .orderBy(channelMessagesTable.createdAt).limit(100);
    } else if (before && pivotDate) {
      const fetched = await db.select().from(channelMessagesTable)
        .where(and(eq(channelMessagesTable.projectId, pid), lt(channelMessagesTable.createdAt, pivotDate)))
        .orderBy(desc(channelMessagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    } else {
      const fetched = await db.select().from(channelMessagesTable)
        .where(eq(channelMessagesTable.projectId, pid))
        .orderBy(desc(channelMessagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    }

    const messages = await serializeChannelMessages(rows, pid, me);

    if (!before) {
      const now = new Date();
      const existing = await db.select().from(channelReadsTable)
        .where(and(eq(channelReadsTable.projectId, pid), eq(channelReadsTable.userId, me))).limit(1);
      if (existing[0]) {
        await db.update(channelReadsTable).set({ lastReadAt: now }).where(and(eq(channelReadsTable.projectId, pid), eq(channelReadsTable.userId, me)));
      } else {
        await db.insert(channelReadsTable).values({ projectId: pid, userId: me, lastReadAt: now });
      }
    }

    res.json({ hasMore, messages });
  } catch (err) {
    req.log.error({ err }, "Portal get channel thread error");
    res.status(500).json({ error: "server_error", message: "Failed to load channel" });
  }
});

// POST /api/portal/messages/channel — post to the project channel.
router.post("/portal/messages/channel", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const content = (req.body?.content as string | undefined)?.trim();
    if (!content) { res.status(400).json({ error: "validation_error", message: "content is required" }); return; }

    const sent = await sendChannelMessage({ projectId: pid, companyId: req.user!.companyId, senderId: req.user!.id, content });
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "messages", action: "send", itemType: "channel_message", itemId: sent.id, req });

    res.status(201).json({
      id: sent.id, senderId: req.user!.id, senderName: sent.senderName, senderRemoved: false, senderRole: req.portalMemberRole ?? null,
      content: sent.content, reactions: [], createdAt: sent.createdAt.toISOString(), mine: true,
    });
  } catch (err) {
    req.log.error({ err }, "Portal send channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to send message" });
  }
});

// GET/POST /api/portal/messages/dm/:otherUserId — a DM thread with another
// CURRENT member of this same project. The membership check on otherUserId is
// what makes cross-project isolation real: a member on project A can't reach
// a thread with someone only on project B, even if a legacy company-wide DM
// between the same two users happens to exist.
async function isCurrentProjectMember(projectId: string, userId: string): Promise<boolean> {
  const rows = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId))).limit(1);
  return !!rows[0];
}

router.get("/portal/messages/dm/:otherUserId", ...portalGuards, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const me = req.user!.id;
    const other = req.params.otherUserId;
    if (!(await isCurrentProjectMember(pid, other))) {
      res.status(404).json({ error: "not_found", message: "Not a current member of this project" });
      return;
    }
    const before = req.query.before as string | undefined;
    const after = req.query.after as string | undefined;
    const convFilter = and(
      eq(messagesTable.projectId, pid),
      or(and(eq(messagesTable.senderId, me), eq(messagesTable.recipientId, other)), and(eq(messagesTable.senderId, other), eq(messagesTable.recipientId, me))),
    );

    let pivotDate: Date | undefined;
    if (before || after) {
      const pivot = await db.select({ createdAt: messagesTable.createdAt }).from(messagesTable).where(eq(messagesTable.id, (before ?? after)!)).limit(1);
      pivotDate = pivot[0]?.createdAt;
    }

    let rows: (typeof messagesTable.$inferSelect)[];
    let hasMore = false;
    if (after && pivotDate) {
      rows = await db.select().from(messagesTable).where(and(convFilter, gt(messagesTable.createdAt, pivotDate))).orderBy(messagesTable.createdAt).limit(100);
    } else if (before && pivotDate) {
      const fetched = await db.select().from(messagesTable).where(and(convFilter, lt(messagesTable.createdAt, pivotDate))).orderBy(desc(messagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    } else {
      const fetched = await db.select().from(messagesTable).where(convFilter).orderBy(desc(messagesTable.createdAt)).limit(PAGE_SIZE + 1);
      hasMore = fetched.length > PAGE_SIZE;
      rows = fetched.slice(0, PAGE_SIZE).reverse();
    }

    const messages = await serializeDmMessages(rows, pid, me);

    if (!before) {
      const unreadIds = rows.filter(r => r.recipientId === me && !r.readAt).map(r => r.id);
      if (unreadIds.length) await db.update(messagesTable).set({ readAt: new Date() }).where(inArray(messagesTable.id, unreadIds));
    }

    res.json({ hasMore, messages });
  } catch (err) {
    req.log.error({ err }, "Portal get DM thread error");
    res.status(500).json({ error: "server_error", message: "Failed to load thread" });
  }
});

router.post("/portal/messages/dm/:otherUserId", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  try {
    const pid = req.portalProjectId!;
    const other = req.params.otherUserId;
    if (!(await isCurrentProjectMember(pid, other))) {
      res.status(404).json({ error: "not_found", message: "Not a current member of this project" });
      return;
    }
    const content = (req.body?.content as string | undefined)?.trim();
    if (!content) { res.status(400).json({ error: "validation_error", message: "content is required" }); return; }

    const sent = await sendDirectMessage({ senderId: req.user!.id, recipientId: other, companyId: req.user!.companyId, projectId: pid, content });
    void logActivity({ userId: req.user!.id, projectId: pid, companyId: req.user!.companyId, section: "messages", action: "send", itemType: "dm", itemId: sent.id, req });

    res.status(201).json({
      id: sent.id, senderId: req.user!.id, senderName: sent.senderName, senderRemoved: false, senderRole: null,
      content: sent.content, reactions: [], readAt: null, createdAt: sent.createdAt.toISOString(), mine: true,
    });
  } catch (err) {
    req.log.error({ err }, "Portal send DM error");
    res.status(500).json({ error: "server_error", message: "Failed to send message" });
  }
});

router.post("/portal/messages/:id/react", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji || !isAllowedReactionEmoji(emoji)) { res.status(400).json({ error: "validation_error", message: "Invalid emoji" }); return; }
    const msg = await db.select({ id: messagesTable.id }).from(messagesTable)
      .where(and(eq(messagesTable.id, req.params.id), eq(messagesTable.projectId, req.portalProjectId!))).limit(1);
    if (!msg[0]) { res.status(404).json({ error: "not_found", message: "Message not found" }); return; }
    res.json(await toggleMessageReaction(req.params.id, req.user!.id, emoji));
  } catch (err) {
    req.log.error({ err }, "Portal react to DM error");
    res.status(500).json({ error: "server_error", message: "Failed to react" });
  }
});

router.post("/portal/messages/channel/:id/react", authenticate, requirePortalSession, requirePortalMember, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji || !isAllowedReactionEmoji(emoji)) { res.status(400).json({ error: "validation_error", message: "Invalid emoji" }); return; }
    const msg = await db.select({ id: channelMessagesTable.id }).from(channelMessagesTable)
      .where(and(eq(channelMessagesTable.id, req.params.id), eq(channelMessagesTable.projectId, req.portalProjectId!))).limit(1);
    if (!msg[0]) { res.status(404).json({ error: "not_found", message: "Message not found" }); return; }
    res.json(await toggleChannelMessageReaction(req.params.id, req.user!.id, emoji));
  } catch (err) {
    req.log.error({ err }, "Portal react to channel message error");
    res.status(500).json({ error: "server_error", message: "Failed to react" });
  }
});

async function serializeDmMessages(rows: (typeof messagesTable.$inferSelect)[], projectId: string, me: string) {
  const senderIds = Array.from(new Set(rows.map(r => r.senderId)));
  const userRows = senderIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, senderIds)) : [];
  const userMap = new Map(userRows.map(u => [u.id, u.name]));
  const removed = await removedFromProjectUserIds(projectId, senderIds);

  const msgIds = rows.map(r => r.id);
  const reactionRows = msgIds.length ? await db.select().from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, msgIds)) : [];
  const reactionMap = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of reactionRows) {
    if (!reactionMap.has(r.messageId)) reactionMap.set(r.messageId, new Map());
    const em = reactionMap.get(r.messageId)!;
    const ex = em.get(r.emoji) ?? { count: 0, mine: false };
    em.set(r.emoji, { count: ex.count + 1, mine: ex.mine || r.userId === me });
  }
  const reactionsFor = (id: string) => Array.from(reactionMap.get(id)?.entries() ?? []).map(([emoji, v]) => ({ emoji, ...v }));

  return rows.map(m => ({
    id: m.id, senderId: m.senderId, senderName: userMap.get(m.senderId) ?? "Unknown", senderRemoved: removed.has(m.senderId),
    content: m.content, reactions: reactionsFor(m.id), readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(), mine: m.senderId === me,
  }));
}

async function serializeChannelMessages(rows: (typeof channelMessagesTable.$inferSelect)[], projectId: string, me: string) {
  const senderIds = Array.from(new Set(rows.map(r => r.senderId)));
  const userRows = senderIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, senderIds)) : [];
  const userMap = new Map(userRows.map(u => [u.id, u.name]));
  const removed = await removedFromProjectUserIds(projectId, senderIds);

  const msgIds = rows.map(r => r.id);
  const reactionRows = msgIds.length ? await db.select().from(channelMessageReactionsTable).where(inArray(channelMessageReactionsTable.channelMessageId, msgIds)) : [];
  const reactionMap = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of reactionRows) {
    if (!reactionMap.has(r.channelMessageId)) reactionMap.set(r.channelMessageId, new Map());
    const em = reactionMap.get(r.channelMessageId)!;
    const ex = em.get(r.emoji) ?? { count: 0, mine: false };
    em.set(r.emoji, { count: ex.count + 1, mine: ex.mine || r.userId === me });
  }
  const reactionsFor = (id: string) => Array.from(reactionMap.get(id)?.entries() ?? []).map(([emoji, v]) => ({ emoji, ...v }));

  return rows.map(m => ({
    id: m.id, senderId: m.senderId, senderName: userMap.get(m.senderId) ?? "Unknown", senderRemoved: removed.has(m.senderId),
    content: m.content, reactions: reactionsFor(m.id), createdAt: m.createdAt.toISOString(), mine: m.senderId === me,
  }));
}

export default router;
