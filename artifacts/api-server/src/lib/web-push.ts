import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

// VAPID identity for Web Push. Keys live in Replit Secrets (VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY) — never committed. If unset, push is DISABLED gracefully:
// endpoints still work, sends are no-ops, and the frontend hides the enable UI.
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
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

export type PushPayload = {
  title: string;
  body: string;
  url: string;   // portal deep-link path (e.g. /portal/drawings?doc=123)
  tag?: string;  // collapses same-tag notifications on the device
};

// Send a payload to every device a member has subscribed. Best-effort: a 404/410
// means the browser dropped that subscription → prune it so we stop trying. Never
// throws. Returns how many devices were successfully delivered to.
export async function sendPushToMember(userId: string, projectId: string, payload: PushPayload): Promise<number> {
  if (!configured) return 0;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.projectId, projectId)));
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      delivered++;
    } catch (err: any) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        // Subscription is gone/expired — remove it.
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, s.id)).catch(() => {});
      } else {
        logger.warn({ err, endpoint: s.endpoint.slice(0, 40) }, "web-push: send failed");
      }
    }
  }));
  return delivered;
}
