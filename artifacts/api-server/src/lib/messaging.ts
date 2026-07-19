import { db } from "@workspace/db";
import {
  messagesTable, channelMessagesTable, messageReactionsTable, channelMessageReactionsTable,
  usersTable, projectsTable, projectMembersTable, notificationsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { generateId } from "./id";
import { sendNewMessageEmail } from "./email";
import { acceptedPortalMemberUserIds, enqueuePushForMembers } from "./push-triggers";

// Shared by the dashboard (routes/messages.ts, routes/channels.ts) and the
// Team Portal (routes/portal-messages.ts) so there is exactly ONE send/react
// path per message type — not a parallel portal implementation.

const REACTION_EMOJIS = ["👍", "✅", "👀", "❤️", "😂"];

export function isAllowedReactionEmoji(emoji: string): boolean {
  return REACTION_EMOJIS.includes(emoji);
}

// A DM's `projectId` is null for a legacy/company-wide conversation (today's
// dashboard-only chat, unaffected by any of this) or set for a Team Portal
// conversation — which is what makes "separate conversation lists per project
// portal" real: the SAME two users get a distinct thread per project.
//
// invoiceId/attachmentType/attachmentId/replyToId exist only for the dashboard
// composer (invoice sharing #32, attachment sharing #33) — the portal composer
// (v1 scope) never sets them, but the send/notify path is identical either way,
// so it's shared rather than forked.
export async function sendDirectMessage(params: {
  senderId: string;
  recipientId: string;
  companyId: string;
  projectId: string | null;
  content: string;
  invoiceId?: string | null;
  attachmentType?: string | null;
  attachmentId?: string | null;
  replyToId?: string | null;
}): Promise<{ id: string; senderName: string; content: string; createdAt: Date }> {
  const { senderId, recipientId, companyId, projectId, content, invoiceId, attachmentType, attachmentId, replyToId } = params;
  const id = generateId();
  const now = new Date();
  await db.insert(messagesTable).values({
    id, companyId, senderId, recipientId, projectId, content: content.trim(), createdAt: now,
    ...(invoiceId ? { invoiceId } : {}),
    ...(attachmentType && attachmentId ? { attachmentType, attachmentId } : {}),
    ...(replyToId ? { replyToId } : {}),
  });

  const senderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, senderId)).limit(1);
  const senderName = senderRows[0]?.name ?? "Someone";
  const preview = content.trim().length > 80 ? content.trim().slice(0, 77) + "…" : content.trim();

  // Portal-participant recipients get a web push (deep-linked into the
  // conversation); everyone else (dashboard users, e.g. the PM) gets the
  // existing in-app notification + optional email — same as today's DMs, so
  // the dashboard Messages page picks these up with zero extra plumbing.
  const isPortalRecipient = projectId ? (await acceptedPortalMemberUserIds(projectId)).includes(recipientId) : false;
  if (projectId && isPortalRecipient) {
    let projectName = "";
    const proj = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    projectName = proj[0]?.name ?? "";
    void enqueuePushForMembers([recipientId], projectId, {
      kind: "message", itemType: "dm", itemId: id,
      title: `New message from ${senderName}`, projectName,
      deepLink: `/portal/messages?c=dm-${senderId}`,
    });
  } else {
    const recipient = await db.select({ email: usersTable.email, name: usersTable.name, emailNotifications: usersTable.emailNotifications })
      .from(usersTable).where(eq(usersTable.id, recipientId)).limit(1);
    await db.insert(notificationsTable).values({
      id: generateId(), userId: recipientId, type: "new_message",
      title: `New message from ${senderName}`, message: preview,
      relatedEntityId: senderId, relatedEntityType: "user",
    });
    if (recipient[0]?.emailNotifications) {
      sendNewMessageEmail(recipient[0].email, recipient[0].name, senderName, preview, false, "").catch(() => {});
    }
  }

  return { id, senderName, content: content.trim(), createdAt: now };
}

export async function sendChannelMessage(params: {
  projectId: string;
  companyId: string;
  senderId: string;
  content: string;
  attachmentType?: string | null;
  attachmentId?: string | null;
  replyToId?: string | null;
}): Promise<{ id: string; senderName: string; content: string; createdAt: Date; projectName: string }> {
  const { projectId, companyId, senderId, content, attachmentType, attachmentId, replyToId } = params;
  const project = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  const projectName = project[0]?.name ?? "";

  const id = generateId();
  const now = new Date();
  await db.insert(channelMessagesTable).values({
    id, projectId, companyId, senderId, content: content.trim(), createdAt: now,
    ...(attachmentType && attachmentId ? { attachmentType, attachmentId } : {}),
    ...(replyToId ? { replyToId } : {}),
  });

  const senderRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, senderId)).limit(1);
  const senderName = senderRows[0]?.name ?? "Someone";
  const preview = content.trim().length > 80 ? content.trim().slice(0, 77) + "…" : (content.trim() || (attachmentType ?? "Attachment"));

  const members = await db.select({ userId: projectMembersTable.userId })
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), sql`${projectMembersTable.userId} != ${senderId} AND ${projectMembersTable.userId} IS NOT NULL`));
  const memberIds = members.map(m => m.userId).filter((x): x is string => !!x);

  const memberUsers = memberIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, emailNotifications: usersTable.emailNotifications })
        .from(usersTable).where(inArray(usersTable.id, memberIds))
    : [];
  const memberMap = new Map(memberUsers.map(u => [u.id, u]));

  for (const uid of memberIds) {
    await db.insert(notificationsTable).values({
      id: generateId(), userId: uid, type: "new_message",
      title: `${senderName} in #${projectName}`, message: preview,
      relatedEntityId: projectId, relatedEntityType: "project",
    });
    const mu = memberMap.get(uid);
    if (mu?.emailNotifications) {
      sendNewMessageEmail(mu.email, mu.name, senderName, preview, true, projectName).catch(() => {});
    }
  }

  const portalMemberIds = (await acceptedPortalMemberUserIds(projectId)).filter(uid => uid !== senderId);
  if (portalMemberIds.length) {
    void enqueuePushForMembers(portalMemberIds, projectId, {
      kind: "message", itemType: "channel", itemId: id,
      title: `${senderName} in #${projectName}`, projectName,
      deepLink: "/portal/messages?c=channel",
    });
  }

  return { id, senderName, content: content.trim(), createdAt: now, projectName };
}

export async function toggleMessageReaction(messageId: string, userId: string, emoji: string): Promise<{ emoji: string; count: number; mine: boolean }[]> {
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
  return Array.from(grouped.entries()).map(([e, v]) => ({ emoji: e, ...v }));
}

export async function toggleChannelMessageReaction(channelMessageId: string, userId: string, emoji: string): Promise<{ emoji: string; count: number; mine: boolean }[]> {
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
  return Array.from(grouped.entries()).map(([e, v]) => ({ emoji: e, ...v }));
}
