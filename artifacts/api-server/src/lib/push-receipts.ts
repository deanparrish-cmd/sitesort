import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { RECEIPT_GRACE_MS } from "./web-push";

// Phone alert receipts (2026-10-22). Read side of push_alerts: what each phone
// has told us, for the portal's "Send a test alert" card and the PM's Team tab.
// "Accepted" (Apple/Google took it) is never shown as "reached the phone": only
// a receipt from the phone's service worker is.

// Stable, non-reversible id for a phone, so the browser never handles another
// phone's push endpoint (which is a capability URL).
export function deviceKey(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return "iPad";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/macintosh/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows computer";
  return "Device";
}

export type ReceiptEvent = "arrived" | "received" | "tapped";
export type ReceiptDetail = {
  shown?: boolean | null; permission?: string | null; error?: string | null;
  posted?: boolean | null; foreground?: boolean | null; sw?: string | null; badge?: string | null;
};

// Called by sw.js (no login: a service worker holds no portal token). The id is
// a random UUID only ever carried inside the encrypted push payload, and a
// receipt can only stamp its own row, so a guessed id changes nothing real.
//   arrived:  the service worker ran (sent BEFORE it tries to show anything)
//   received: showNotification finished; shown/error say whether it threw
//   tapped:   the notification was tapped
export async function recordReceipt(id: string, event: ReceiptEvent, d: ReceiptDetail = {}): Promise<boolean> {
  const perm = d.permission && ["granted", "denied", "default"].includes(d.permission) ? d.permission : null;
  const sw = d.sw ? d.sw.slice(0, 32) : null;
  const q = event === "arrived"
    ? [`UPDATE push_alerts SET arrived_at = COALESCE(arrived_at, now()), sw_version = COALESCE($2, sw_version), permission = COALESCE($3, permission)
         WHERE id = $1 AND send_result = 'accepted'`, [id, sw, perm]]
    : event === "received"
    ? [`UPDATE push_alerts SET received_at = COALESCE(received_at, now()), arrived_at = COALESCE(arrived_at, now()),
              shown = COALESCE($2, shown), permission = COALESCE($3, permission), show_error = COALESCE($4, show_error),
              posted = COALESCE($5, posted), foreground = COALESCE($6, foreground), sw_version = COALESCE($7, sw_version),
              badge_result = COALESCE($8, badge_result)
         WHERE id = $1 AND send_result = 'accepted'`,
       [id, d.shown ?? null, perm, d.error ? d.error.slice(0, 300) : null, d.posted ?? null, d.foreground ?? null, sw, d.badge ? d.badge.slice(0, 120) : null]]
    // A tap proves the phone got it even if the other reports were lost.
    : [`UPDATE push_alerts SET tapped_at = COALESCE(tapped_at, now()), arrived_at = COALESCE(arrived_at, now())
         WHERE id = $1 AND send_result = 'accepted'`, [id]];
  const { rowCount } = await pool.query(q[0] as string, q[1] as unknown[]);
  return (rowCount ?? 0) > 0;
}

// What happened to one alert on one phone, in words a person can act on.
//   no_receipt_old_app  sent to a phone still on the old service worker: silence proves nothing
//   waiting             under a minute old, no word yet
//   never_arrived       the service worker never ran (the push didn't reach it, or no signal to report)
//   arrived_no_result   it ran, then never finished showing (killed or hung)
//   show_failed         it ran and showNotification threw (show_error says what)
//   not_posted          showNotification resolved but the phone's list doesn't have it
//   displayed           shown and posted; a banner depends on the phone's settings (Focus, banners)
//   displayed_app_open  shown while SiteSort was open on screen: iOS shows no banner then, by design
export type AlertOutcome = "no_receipt_old_app" | "waiting" | "never_arrived" | "arrived_no_result" | "show_failed" | "not_posted" | "displayed" | "displayed_app_open";
export function alertOutcome(r: {
  send_result: string; sent_at: Date | string; device_sw: string | null; arrived_at: Date | string | null; received_at: Date | string | null;
  shown: boolean | null; posted: boolean | null; foreground: boolean | null; sw_version: string | null; tapped_at: Date | string | null;
}): AlertOutcome | null {
  if (r.send_result !== "accepted") return null;
  const heard = r.arrived_at || r.received_at || r.tapped_at;
  if (!heard) {
    if (!r.device_sw) return "no_receipt_old_app";
    return Date.now() - new Date(r.sent_at).getTime() < 60_000 ? "waiting" : "never_arrived";
  }
  // A tap with no other report: it was on screen.
  if (!r.received_at) return r.tapped_at ? "displayed" : "arrived_no_result";
  if (r.shown === false) return "show_failed";
  if (r.posted === false) return "not_posted";
  return r.foreground ? "displayed_app_open" : "displayed";
}

export type DeviceAlertRow = {
  alertId: string; sentAt: string; sendResult: string; receivedAt: string | null; outcome: AlertOutcome | null; showError: string | null; tappedAt: string | null;
  shown: boolean | null; permission: string | null; bannerAnswer: "yes" | "no" | null; answeredAt: string | null;
};
export type UserDevice = {
  deviceId: string; label: string; registeredAt: string; lastConfirmedAt: string | null;
  unansweredInARow: number; lastTest: DeviceAlertRow | null;
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const toRow = (r: any): DeviceAlertRow => ({
  alertId: r.id, sentAt: iso(r.sent_at)!, sendResult: r.send_result, receivedAt: iso(r.received_at),
  outcome: alertOutcome(r), showError: r.show_error ?? null, tappedAt: iso(r.tapped_at),
  shown: r.shown, permission: r.permission, bannerAnswer: r.banner_answer, answeredAt: iso(r.answered_at),
});

// Every phone this login has registered (any project), with what it has told us.
// Returns the endpoints too, server-side only: routes must not send them out.
export async function listUserDevices(userId: string): Promise<Array<UserDevice & { endpoint: string }>> {
  const { rows: subs } = await pool.query(
    `SELECT endpoint, min(created_at) AS registered_at, (array_agg(user_agent ORDER BY last_seen_at DESC))[1] AS user_agent
       FROM push_subscriptions WHERE user_id = $1 GROUP BY endpoint ORDER BY min(created_at)`, [userId]);
  if (subs.length === 0) return [];
  const endpoints = subs.map((s: any) => s.endpoint);
  const [{ rows: confirmed }, { rows: tests }, { rows: recent }] = await Promise.all([
    pool.query(`SELECT endpoint, max(COALESCE(received_at, arrived_at, tapped_at)) AS t FROM push_alerts WHERE user_id = $1 AND endpoint = ANY($2) GROUP BY endpoint`, [userId, endpoints]),
    pool.query(`SELECT DISTINCT ON (endpoint) * FROM push_alerts WHERE user_id = $1 AND endpoint = ANY($2) AND kind = 'test' ORDER BY endpoint, sent_at DESC`, [userId, endpoints]),
    pool.query(`SELECT endpoint, received_at, sent_at FROM (
                  SELECT endpoint, COALESCE(received_at, arrived_at, tapped_at) AS received_at, sent_at, row_number() OVER (PARTITION BY endpoint ORDER BY sent_at DESC) AS n
                    FROM push_alerts WHERE user_id = $1 AND endpoint = ANY($2) AND send_result = 'accepted') x
                 WHERE n <= 20 ORDER BY sent_at DESC`, [userId, endpoints]),
  ]);
  const confirmedBy = new Map(confirmed.map((r: any) => [r.endpoint, r.t as Date | null]));
  const testBy = new Map(tests.map((r: any) => [r.endpoint, r]));
  return subs.map((s: any) => {
    // Alerts in a row with no receipt, newest first, past the grace period.
    let unanswered = 0;
    for (const r of recent.filter((x: any) => x.endpoint === s.endpoint)) {
      if (Date.now() - new Date(r.sent_at).getTime() < RECEIPT_GRACE_MS) continue;
      if (r.received_at) break;
      unanswered++;
    }
    const t = testBy.get(s.endpoint);
    return {
      endpoint: s.endpoint, deviceId: deviceKey(s.endpoint), label: deviceLabel(s.user_agent),
      registeredAt: iso(s.registered_at)!, lastConfirmedAt: iso(confirmedBy.get(s.endpoint) ?? null),
      unansweredInARow: unanswered, lastTest: t ? toRow(t) : null,
    };
  });
}

export type PhoneAlerts = {
  // none: no phone set up for this project; never: set up, never reported
  // back; confirmed: at least one phone has; removed: pruned after unanswered alerts.
  state: "none" | "never" | "confirmed" | "removed";
  devices: number;
  confirmedDevices: number;
  confirmedAt?: string;
  removedAt?: string;
  banner?: { answer: "yes" | "no"; at: string; reachedPhone: boolean };
};

// The PM's view, per login on one project: only phones registered for THIS
// project count, because those are the only ones its alerts go to.
export async function phoneAlertsFor(userIds: string[], projectId: string): Promise<Map<string, PhoneAlerts>> {
  const out = new Map<string, PhoneAlerts>();
  if (userIds.length === 0) return out;
  const [{ rows: devs }, { rows: banners }, { rows: pruned }] = await Promise.all([
    pool.query(
      `SELECT s.user_id, count(DISTINCT s.endpoint)::int AS devices,
              count(DISTINCT s.endpoint) FILTER (WHERE a.t IS NOT NULL)::int AS confirmed, max(a.t) AS confirmed_at
         FROM push_subscriptions s
         LEFT JOIN LATERAL (SELECT max(COALESCE(received_at, arrived_at, tapped_at)) AS t FROM push_alerts WHERE endpoint = s.endpoint AND user_id = s.user_id) a ON true
        WHERE s.project_id = $1 AND s.user_id = ANY($2) GROUP BY s.user_id`, [projectId, userIds]),
    pool.query(
      `SELECT DISTINCT ON (user_id) user_id, banner_answer, answered_at, received_at, arrived_at, tapped_at FROM push_alerts
        WHERE user_id = ANY($1) AND kind = 'test' AND banner_answer IS NOT NULL ORDER BY user_id, answered_at DESC`, [userIds]),
    pool.query(
      `SELECT user_id, max(sent_at) AS t FROM push_alerts WHERE user_id = ANY($1) AND send_result = 'pruned' GROUP BY user_id`, [userIds]),
  ]);
  const devBy = new Map(devs.map((r: any) => [r.user_id, r]));
  const bannerBy = new Map(banners.map((r: any) => [r.user_id, r]));
  const prunedBy = new Map(pruned.map((r: any) => [r.user_id, r.t as Date]));
  for (const id of userIds) {
    const d = devBy.get(id);
    const b = bannerBy.get(id);
    const p = prunedBy.get(id);
    const devices = d?.devices ?? 0;
    const confirmedDevices = d?.confirmed ?? 0;
    const pa: PhoneAlerts = {
      state: devices === 0 ? (p ? "removed" : "none") : confirmedDevices > 0 ? "confirmed" : "never",
      devices, confirmedDevices,
    };
    if (d?.confirmed_at) pa.confirmedAt = iso(d.confirmed_at)!;
    if (devices === 0 && p) pa.removedAt = iso(p)!;
    if (b) pa.banner = { answer: b.banner_answer, at: iso(b.answered_at)!, reachedPhone: !!(b.received_at || b.arrived_at || b.tapped_at) };
    out.set(id, pa);
  }
  return out;
}
