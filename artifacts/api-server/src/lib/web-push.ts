import webpush from "web-push";
import { db, pool } from "@workspace/db";
import { pushSubscriptionsTable, projectMembersTable, pushAlertsTable } from "@workspace/db/schema";
import { and, eq, ne, notInArray, isNotNull } from "drizzle-orm";
import { generateId } from "./id";
import { logger } from "./logger";
import { vapidKeys } from "./environment";

// VAPID identity for Web Push. Keys live in Replit Secrets (VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY) — never committed. If unset, push is DISABLED gracefully:
// endpoints still work, sends are no-ops, and the frontend hides the enable UI.
// Outside the deployed app the workspace's own pair is used (lib/environment.ts).
const { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY } = vapidKeys();
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@sitesort.co.uk";

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (err) {
    logger.error({ err }, "web-push: invalid VAPID keys — push disabled");
  }
} else {
  logger.warn("web-push: VAPID keys not set — push notifications disabled");
}

export function isPushConfigured(): boolean {
  return configured;
}
export function getVapidPublicKey(): string | null {
  return configured ? PUBLIC_KEY : null;
}

// Register this phone for push on EVERY project its member is on the portal
// for, plus the one it's on now. Before, a phone held one row and opening
// another project moved it there, silently ending the first project's alerts
// (a held-at-the-gate alert reached nobody) while the toggle still showed On.
// A phone now signed in as someone else drops the previous person's rows, so
// their alerts don't land on a phone they no longer use. Returns project ids.
export async function registerPushDevice(
  userId: string, currentProjectId: string,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null; swVersion?: string | null },
): Promise<string[]> {
  const memberships = await db.select({ projectId: projectMembersTable.projectId }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.userId, userId), isNotNull(projectMembersTable.personId)));
  const projectIds = [...new Set([currentProjectId, ...memberships.map(m => m.projectId)])];
  await db.transaction(async (tx) => {
    await tx.delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.endpoint, sub.endpoint), ne(pushSubscriptionsTable.userId, userId)));
    // Projects this member has left: no alerts from them on this phone.
    await tx.delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.endpoint, sub.endpoint), notInArray(pushSubscriptionsTable.projectId, projectIds)));
    const now = new Date();
    for (const projectId of projectIds) {
      await tx.insert(pushSubscriptionsTable)
        .values({ id: generateId(), userId, projectId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent, swVersion: sub.swVersion ?? null })
        .onConflictDoUpdate({
          target: [pushSubscriptionsTable.endpoint, pushSubscriptionsTable.projectId],
          set: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent, swVersion: sub.swVersion ?? null, lastSeenAt: now },
        });
    }
  });
  return projectIds;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;   // portal deep-link path (e.g. /portal/drawings?doc=123)
  tag?: string;  // collapses same-tag notifications on the device
};

// A phone is removed after this many alerts in a row with no receipt (Dean,
// 2026-10-22: 7, not 3; phones go flat, people take leave, and removing a live
// phone is the worse error). Only alerts sent after the phone's FIRST receipt
// count, so a phone still on the old service worker (which can't report back)
// is never pruned for silence. A removed phone comes back by itself the next
// time its owner opens the portal (resyncPush re-registers it).
export const PRUNE_AFTER_UNANSWERED = 7;
// An alert only counts as unanswered once it is this old: a phone with no
// signal gets it late and reports back late.
export const RECEIPT_GRACE_MS = 10 * 60 * 1000;

type Device = { endpoint: string; p256dh: string; auth: string; swVersion?: string | null };
export type DeviceSend = { alertId: string; endpoint: string; result: "accepted" | "gone" | "failed"; status: number | null };

// Send one payload to each phone once, recording a push_alerts row per phone.
// The row id travels in the payload as `receipt`; sw.js posts it back to
// /api/push/receipt. A 404/410 means the browser dropped that registration:
// prune it so we stop trying. Never throws.
export async function sendToDevices(
  userId: string, projectId: string | null, devices: Device[], payload: PushPayload, kind: "alert" | "test" = "alert",
): Promise<DeviceSend[]> {
  const seen = new Set<string>();
  const unique = devices.filter(d => !seen.has(d.endpoint) && seen.add(d.endpoint));
  const out: DeviceSend[] = [];
  await Promise.all(unique.map(async (d) => {
    const alertId = generateId();
    let result: DeviceSend["result"] = "accepted";
    let status: number | null = null;
    try {
      const r = await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        JSON.stringify({ ...payload, receipt: alertId }),
      );
      status = r?.statusCode ?? null;
    } catch (err: any) {
      status = err?.statusCode ?? null;
      if (status === 404 || status === 410) {
        result = "gone";
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, d.endpoint)).catch(() => {});
      } else {
        result = "failed";
        logger.warn({ err, endpoint: d.endpoint.slice(0, 40) }, "web-push: send failed");
      }
    }
    await db.insert(pushAlertsTable).values({
      id: alertId, userId, projectId, endpoint: d.endpoint, kind, tag: payload.tag ?? null, sendResult: result, sendStatus: status, deviceSw: d.swVersion ?? null,
    }).catch((err) => logger.warn({ err }, "web-push: alert row not recorded"));
    if (result === "accepted") await pruneIfUnanswered(userId, d.endpoint).catch((err) => logger.warn({ err }, "web-push: prune check failed"));
    out.push({ alertId, endpoint: d.endpoint, result, status });
  }));
  return out;
}

// Remove a phone that has stopped answering: its last PRUNE_AFTER_UNANSWERED
// alerts (each past the grace period, all sent after its first receipt) have
// no receipt. Leaves a `pruned` marker row so the PM can see why it went.
export async function pruneIfUnanswered(userId: string, endpoint: string): Promise<boolean> {
  const { rows } = await pool.query(
    `WITH first AS (SELECT min(COALESCE(received_at, arrived_at, tapped_at)) AS t FROM push_alerts WHERE endpoint = $1)
     SELECT COALESCE(a.received_at, a.arrived_at, a.tapped_at) AS received_at FROM push_alerts a, first
      WHERE a.endpoint = $1 AND a.send_result = 'accepted' AND first.t IS NOT NULL
        AND a.sent_at > first.t AND a.sent_at < now() - ($2::int * interval '1 millisecond')
      ORDER BY a.sent_at DESC LIMIT $3`,
    [endpoint, RECEIPT_GRACE_MS, PRUNE_AFTER_UNANSWERED],
  );
  if (rows.length < PRUNE_AFTER_UNANSWERED || rows.some((r: { received_at: Date | null }) => r.received_at)) return false;
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  await db.insert(pushAlertsTable).values({ id: generateId(), userId, endpoint, kind: "alert", sendResult: "pruned" });
  logger.info({ userId, endpoint: endpoint.slice(0, 40), unanswered: rows.length }, "web-push: phone removed after unanswered alerts");
  return true;
}

// Send to EVERY device this user has subscribed across ALL their projects.
// Used for cross-project events (e.g. an invitation to a NEW project, where a
// project-scoped subscription for it can't exist yet). Same best-effort
// semantics as sendPushToMember.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!configured) return 0;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  if (subs.length === 0) return 0;
  // Two projects can share a device endpoint: sendToDevices sends once per phone.
  const sent = await sendToDevices(userId, null, subs, payload);
  const delivered = sent.filter(s => s.result === "accepted").length;
  logger.info({ userId, devices: sent.length, delivered, tag: payload.tag }, "web-push: user send");
  return delivered;
}

// Send a payload to every device a member has subscribed. Best-effort: a 404/410
// means the browser dropped that subscription → prune it so we stop trying. Never
// throws. Returns how many devices were successfully delivered to.
export async function sendPushToMember(userId: string, projectId: string, payload: PushPayload): Promise<number> {
  if (!configured) return 0;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.projectId, projectId)));
  if (subs.length === 0) return 0;
  const sent = await sendToDevices(userId, projectId, subs, payload);
  const delivered = sent.filter(s => s.result === "accepted").length;
  // Log every send outcome (success included). "delivered" = Apple/Google
  // accepted it; whether it reached the screen is in push_alerts.received_at.
  logger.info({ userId, projectId, devices: subs.length, delivered, tag: payload.tag }, "web-push: send");
  return delivered;
}
