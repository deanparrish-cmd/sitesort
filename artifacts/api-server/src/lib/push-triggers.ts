import { db } from "@workspace/db";
import { pendingPushesTable, projectMembersTable } from "@workspace/db/schema";
import { and, eq, lt, isNotNull, sql } from "drizzle-orm";
import { generateId } from "./id";
import { logger } from "./logger";
import { sendPushToMember, isPushConfigured } from "./web-push";

// User ids of every ACCEPTED portal member of a project (a membership row that
// carries both a person link and an account). Used to notify "everyone on the
// project" for site-wide updates (daily notes, safety notices).
export async function acceptedPortalMemberUserIds(projectId: string): Promise<string[]> {
  const rows = await db.select({ userId: projectMembersTable.userId }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), isNotNull(projectMembersTable.personId), isNotNull(projectMembersTable.userId)));
  return rows.map(r => r.userId as string);
}

// Bursts of shares collapse into one notification: a queued item waits this long
// for the burst to settle before it's flushed. A member who gets 3 drawings in a
// minute receives a single "3 new documents" push, not three. Both are tunable
// via env (mainly for tests) with production-sensible defaults.
const DEBOUNCE_MS = Number(process.env.PUSH_DEBOUNCE_MS) || 90_000;          // quiet period before a member's queue flushes
const FLUSH_INTERVAL_MS = Number(process.env.PUSH_FLUSH_INTERVAL_MS) || 30_000; // how often the flush job runs

type EnqueueItem = {
  kind: string;          // 'document' | 'site_update'
  itemType?: string | null;
  itemId?: string | null;
  title: string;         // label of the single item
  projectName: string;
  deepLink: string;      // portal path for the single-item case
};

// Queue a notification for each member (deduped). No-op if push isn't configured
// or there are no members. Never throws — notifications must not break a request.
export async function enqueuePushForMembers(userIds: string[], projectId: string, item: EnqueueItem): Promise<void> {
  if (!isPushConfigured()) return;
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;
  try {
    await db.insert(pendingPushesTable).values(unique.map((userId) => ({
      id: generateId(), userId, projectId,
      kind: item.kind, itemType: item.itemType ?? null, itemId: item.itemId ?? null,
      title: item.title, projectName: item.projectName, deepLink: item.deepLink,
    })));
  } catch (err) {
    logger.warn({ err }, "enqueuePushForMembers failed");
  }
}

// Flush every member whose queue has settled (no new item for DEBOUNCE_MS).
// One pending row → a specific notification (title + its deep link). Several →
// one collapsed "N new documents/updates — <project>" pointing at "Shared with me".
export async function flushPendingPushes(): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const cutoff = new Date(Date.now() - DEBOUNCE_MS);
    // Members whose MOST RECENT pending item is older than the cutoff (settled).
    const ready = await db
      .select({ userId: pendingPushesTable.userId, projectId: pendingPushesTable.projectId })
      .from(pendingPushesTable)
      .groupBy(pendingPushesTable.userId, pendingPushesTable.projectId)
      .having(lt(sql`max(${pendingPushesTable.createdAt})`, cutoff));

    for (const { userId, projectId } of ready) {
      const rows = await db.select().from(pendingPushesTable)
        .where(and(eq(pendingPushesTable.userId, userId), eq(pendingPushesTable.projectId, projectId)));
      if (rows.length === 0) continue;

      let payload;
      if (rows.length === 1) {
        const r = rows[0];
        payload = { title: r.title, body: r.projectName, url: r.deepLink, tag: `portal-${projectId}` };
      } else {
        const projectName = rows[0].projectName;
        const docs = rows.filter((r) => r.kind === "document").length;
        const noun = docs === rows.length ? "documents" : docs === 0 ? "updates" : "new items";
        payload = {
          title: `${rows.length} new ${noun} — ${projectName}`,
          body: "Tap to view what's been shared with you.",
          url: "/portal/shared",
          tag: `portal-${projectId}`,
        };
      }
      // Delete first so a send that races the next flush can't double-fire.
      await db.delete(pendingPushesTable).where(and(eq(pendingPushesTable.userId, userId), eq(pendingPushesTable.projectId, projectId)));
      await sendPushToMember(userId, projectId, payload);
    }
  } catch (err) {
    logger.warn({ err }, "flushPendingPushes failed");
  }
}

let started = false;
export function schedulePushFlush(): void {
  if (started || !isPushConfigured()) return;
  started = true;
  setInterval(() => { void flushPendingPushes(); }, FLUSH_INTERVAL_MS).unref?.();
  logger.info("push flush scheduled");
}
