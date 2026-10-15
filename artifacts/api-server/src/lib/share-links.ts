import { createHash, randomBytes } from "crypto";
import { db } from "@workspace/db";
import {
  shareLinksTable, documentsTable, permitsTable, projectsTable, companiesTable,
  usersTable, notificationsTable, type ShareLink,
} from "@workspace/db/schema";
import { and, desc, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { generateId } from "./id";
import { logger } from "./logger";
import { uploadFilename } from "./signed-uploads";
import { isProjectApprover } from "./project-authority";
import { sendShareLinkExpiringEmail } from "./email";

// Per-share links (#127 Part B). Drawings, project documents and permits are
// the files people send outside SiteSort; since Part B their bare upload links
// need a login like every other file, and the way out is a link minted per
// share: /s/<token>, valid for 30 days or until the item is superseded,
// whichever comes first. The landing page names the item and its revision, so
// whoever opens it can see which revision they were sent.

export const SHARE_ITEM_TYPES = ["document", "permit"] as const;
export type ShareItemType = typeof SHARE_ITEM_TYPES[number];
export const SHARE_LINK_DAYS = 30;
export const REMINDER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isShareItemType(t: unknown): t is ShareItemType {
  return typeof t === "string" && (SHARE_ITEM_TYPES as readonly string[]).includes(t);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sharePath(token: string): string {
  return `/s/${token}`;
}

export type ShareItem = {
  itemType: ShareItemType;
  id: string;
  projectId: string;
  name: string;
  // What the recipient checks against the title block: a drawing's revision
  // letter, else "Version N"; permits carry their type and expiry instead.
  revisionLabel: string | null;
  detail: string | null;
  live: boolean; // false once superseded / archived
  filename: string | null; // null = no file attached
};

export async function loadShareItem(itemType: ShareItemType, itemId: string): Promise<ShareItem | null> {
  if (itemType === "document") {
    const d = (await db.select().from(documentsTable).where(eq(documentsTable.id, itemId)).limit(1))[0];
    if (!d) return null;
    return {
      itemType, id: d.id, projectId: d.projectId, name: d.name,
      revisionLabel: d.revision ? `Revision ${d.revision}` : `Version ${d.version}`,
      detail: d.type ? d.type.charAt(0).toUpperCase() + d.type.slice(1).replace(/_/g, " ") : null,
      live: d.status === "current",
      filename: uploadFilename(d.fileUrl),
    };
  }
  const p = (await db.select().from(permitsTable).where(eq(permitsTable.id, itemId)).limit(1))[0];
  if (!p) return null;
  return {
    itemType, id: p.id, projectId: p.projectId, name: p.type,
    revisionLabel: null,
    detail: `${p.description}. Valid ${p.startDate} to ${p.expiryDate}`,
    live: !p.archivedAt,
    filename: p.documentUrl ? uploadFilename(p.documentUrl) : null,
  };
}

// The item that replaced this one, if any: a document's newest revision (the
// supersede chain via previousVersionId), or the permit of the same type on
// the same project that isn't archived. Null when nothing current is left.
export async function currentShareItem(item: ShareItem): Promise<ShareItem | null> {
  if (item.live) return item;
  if (item.itemType === "document") {
    let id = item.id;
    for (let hops = 0; hops < 50; hops++) {
      const next = (await db.select({ id: documentsTable.id, status: documentsTable.status }).from(documentsTable)
        .where(and(eq(documentsTable.previousVersionId, id), eq(documentsTable.projectId, item.projectId)))
        .orderBy(desc(documentsTable.createdAt)).limit(1))[0];
      if (!next) return null;
      if (next.status === "current") return loadShareItem("document", next.id);
      id = next.id;
    }
    return null;
  }
  const old = (await db.select({ type: permitsTable.type }).from(permitsTable).where(eq(permitsTable.id, item.id)).limit(1))[0];
  if (!old) return null;
  const cur = (await db.select({ id: permitsTable.id }).from(permitsTable)
    .where(and(eq(permitsTable.projectId, item.projectId), eq(permitsTable.type, old.type), isNull(permitsTable.archivedAt)))
    .orderBy(desc(permitsTable.createdAt)).limit(1))[0];
  return cur ? loadShareItem("permit", cur.id) : null;
}

export async function mintShareLink(opts: {
  companyId: string; projectId: string; itemType: ShareItemType; itemId: string;
  createdByUserId: string | null; method?: string | null; recipientInfo?: string | null; now?: Date;
}): Promise<{ link: ShareLink; token: string }> {
  const now = opts.now ?? new Date();
  const token = randomBytes(24).toString("base64url");
  const sent = !!opts.method;
  const [link] = await db.insert(shareLinksTable).values({
    id: generateId(),
    tokenHash: hashToken(token),
    companyId: opts.companyId,
    projectId: opts.projectId,
    itemType: opts.itemType,
    itemId: opts.itemId,
    createdByUserId: opts.createdByUserId,
    method: opts.method ?? null,
    recipientInfo: opts.recipientInfo ?? null,
    sentAt: sent ? now : null,
    expiresAt: new Date(now.getTime() + SHARE_LINK_DAYS * DAY_MS),
  }).returning();
  return { link, token };
}

export async function findShareLink(token: string): Promise<ShareLink | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  return (await db.select().from(shareLinksTable).where(eq(shareLinksTable.tokenHash, hashToken(token))).limit(1))[0] ?? null;
}

export type ShareState = "ok" | "expired" | "superseded" | "revoked" | "removed";

export function shareState(link: ShareLink, item: ShareItem | null, now: Date = new Date()): ShareState {
  if (link.revokedAt) return "revoked";
  if (!item || !item.filename) return "removed";
  if (!item.live) return "superseded";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

// Who may decide on an access request or revoke a link: the person who sent
// it, or anyone with approver authority on the project.
export async function canManageShare(user: { id: string; role: string }, link: Pick<ShareLink, "createdByUserId" | "projectId">): Promise<boolean> {
  if (link.createdByUserId && link.createdByUserId === user.id) return true;
  return isProjectApprover(user, link.projectId);
}

export async function projectAndCompanyNames(projectId: string): Promise<{ projectName: string; companyName: string } | null> {
  const r = (await db.select({ projectName: projectsTable.name, companyName: companiesTable.name })
    .from(projectsTable).innerJoin(companiesTable, eq(companiesTable.id, projectsTable.companyId))
    .where(eq(projectsTable.id, projectId)).limit(1))[0];
  return r ?? null;
}

// Three days before a sent link expires, its sender gets a notification (and
// an email unless they've turned email off) so they can send a fresh one.
// Claimed per link (reminder_sent_at) so overlapping runs never double-send.
export async function runShareLinkReminders(now: Date = new Date()): Promise<number> {
  const due = await db.select().from(shareLinksTable).where(and(
    isNotNull(shareLinksTable.sentAt),
    isNull(shareLinksTable.revokedAt),
    isNull(shareLinksTable.reminderSentAt),
    isNotNull(shareLinksTable.createdByUserId),
    gt(shareLinksTable.expiresAt, now),
    lte(shareLinksTable.expiresAt, new Date(now.getTime() + REMINDER_DAYS * DAY_MS)),
  ));
  let sent = 0;
  for (const link of due) {
    try {
      const item = await loadShareItem(link.itemType as ShareItemType, link.itemId);
      // A superseded or removed item's link is already dead; nothing to renew.
      if (shareState(link, item, now) !== "ok" || !item) {
        await db.update(shareLinksTable).set({ reminderSentAt: now }).where(eq(shareLinksTable.id, link.id));
        continue;
      }
      const claimed = await db.update(shareLinksTable).set({ reminderSentAt: now })
        .where(and(eq(shareLinksTable.id, link.id), isNull(shareLinksTable.reminderSentAt))).returning({ id: shareLinksTable.id });
      if (!claimed.length) continue;
      const names = await projectAndCompanyNames(link.projectId);
      const expires = link.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
      const who = link.recipientInfo ? ` to ${link.recipientInfo}` : "";
      await db.insert(notificationsTable).values({
        id: generateId(), userId: link.createdByUserId!, type: "share_link_expiring",
        title: `Shared link expires ${expires}: ${item.name}`,
        message: `The link you sent${who} stops working on ${expires}. Share it again if they still need it.`,
        relatedEntityId: item.id, relatedEntityType: item.itemType,
        metadata: { projectId: link.projectId, shareLinkId: link.id }, read: false,
      });
      const user = (await db.select({ email: usersTable.email, name: usersTable.name, emailNotifications: usersTable.emailNotifications })
        .from(usersTable).where(eq(usersTable.id, link.createdByUserId!)).limit(1))[0];
      if (user?.emailNotifications) {
        await sendShareLinkExpiringEmail({
          to: user.email, name: user.name, itemName: item.name, revisionLabel: item.revisionLabel,
          projectName: names?.projectName ?? "", recipientInfo: link.recipientInfo, expiresAt: link.expiresAt,
          projectId: link.projectId, itemType: item.itemType, itemId: item.id,
        }).catch(err => logger.warn({ err, shareLinkId: link.id }, "share expiry email failed"));
      }
      sent++;
    } catch (err) {
      logger.warn({ err, shareLinkId: link.id }, "share link reminder failed");
    }
  }
  return sent;
}

let started = false;
export function scheduleShareLinkReminders(): void {
  if (started) return;
  started = true;
  const run = () => { void runShareLinkReminders().then(n => { if (n) logger.info({ sent: n }, "share link reminders sent"); }); };
  setTimeout(run, 60_000).unref?.();
  setInterval(run, 60 * 60 * 1000).unref?.();
}

export async function recordShareOpen(linkId: string): Promise<void> {
  await db.update(shareLinksTable)
    .set({ openCount: sql`${shareLinksTable.openCount} + 1`, lastOpenedAt: new Date() })
    .where(eq(shareLinksTable.id, linkId));
}
