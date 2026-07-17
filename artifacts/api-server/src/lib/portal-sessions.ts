import { db } from "@workspace/db";
import { portalSessionsTable, pushSubscriptionsTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { generateId } from "./id";

// Server-side portal session policy (see portal_sessions schema for the "why"):
//   • SLIDING_MS  — sliding lifetime; each active request pushes expires_at to
//     now + 30 days, so a worker in regular use is never logged out.
//   • INACTIVITY_MS — matched to the sliding window (30 days): site workers must
//     NOT be booted after a short idle gap (e.g. a weekend or a 12h break). The
//     sliding 30-day expiry is the only thing that ends a session on its own.
export const SLIDING_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
export const INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (== sliding window)
// Throttle the sliding write: don't touch the row on every request (portal pages
// fetch several endpoints), only once activity is >1 min stale. 1 min ≪ 30d so
// the sliding-window slide stays effectively continuous.
const TOUCH_THROTTLE_MS = 60 * 1000;

export type SessionCheck =
  | { ok: true }
  | { ok: false; reason: "not_found" | "revoked" | "inactive" | "expired" };

// Create a fresh session for a member entering the portal; returns its id (the
// JWT `sid`). expires_at starts one sliding window out.
export async function createPortalSession(userId: string, projectId: string): Promise<string> {
  const id = generateId();
  const now = new Date();
  await db.insert(portalSessionsTable).values({
    id, userId, projectId,
    createdAt: now, lastActiveAt: now,
    expiresAt: new Date(now.getTime() + SLIDING_MS),
  });
  return id;
}

// Validate a session by its id AND owner (user + project must match the token's
// claims, so a leaked sid can't be replayed against another account), enforcing
// revoke → inactivity → sliding-expiry. On success, slides the window forward
// (throttled). Enforcement is entirely server-side.
export async function checkAndTouchSession(sid: string, userId: string, projectId: string): Promise<SessionCheck> {
  const rows = await db.select().from(portalSessionsTable).where(eq(portalSessionsTable.id, sid)).limit(1);
  const s = rows[0];
  if (!s || s.userId !== userId || s.projectId !== projectId) return { ok: false, reason: "not_found" };
  if (s.revokedAt) return { ok: false, reason: "revoked" };

  const now = Date.now();
  if (now - s.lastActiveAt.getTime() > INACTIVITY_MS) {
    // Idle too long — retire the row so it can't be revived, then reject.
    await db.update(portalSessionsTable).set({ revokedAt: new Date() })
      .where(and(eq(portalSessionsTable.id, sid), isNull(portalSessionsTable.revokedAt)));
    return { ok: false, reason: "inactive" };
  }
  if (now > s.expiresAt.getTime()) return { ok: false, reason: "expired" };

  // Alive — slide the window (throttled to avoid a write per request).
  if (now - s.lastActiveAt.getTime() > TOUCH_THROTTLE_MS) {
    await db.update(portalSessionsTable)
      .set({ lastActiveAt: new Date(now), expiresAt: new Date(now + SLIDING_MS) })
      .where(eq(portalSessionsTable.id, sid));
  }
  return { ok: true };
}

// Explicit logout — kill one session immediately, server-side.
export async function revokePortalSession(sid: string): Promise<void> {
  await db.update(portalSessionsTable).set({ revokedAt: new Date() })
    .where(and(eq(portalSessionsTable.id, sid), isNull(portalSessionsTable.revokedAt)));
}

// Dashboard revoke — kill every live session a member holds for a project, so
// their next request is booted even before the membership re-check would catch it,
// AND delete their push subscriptions so a revoked member receives nothing.
export async function revokePortalSessionsForMember(userId: string, projectId: string): Promise<void> {
  await db.update(portalSessionsTable).set({ revokedAt: new Date() })
    .where(and(
      eq(portalSessionsTable.userId, userId),
      eq(portalSessionsTable.projectId, projectId),
      isNull(portalSessionsTable.revokedAt),
    ));
  await db.delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.projectId, projectId)))
    .catch(() => {});
}
