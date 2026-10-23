import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { redis } from "./redis";
import { recordCredentialEvent } from "./credential-notice";

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes
// Hard stop (Dean, 2026-10-23): the 3rd lockout within 24 h switches the PIN
// off (users.pin_locked_at) until the owner resets it from the emailed link.
// Without it, 5 guesses every 15 minutes would get through 10,000 PINs in time.
const MAX_LOCKOUTS = 3;
const LOCKOUT_WINDOW_SECONDS = 24 * 60 * 60;

const TOO_MANY = { status: 429, body: { error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." } };
export const PIN_SWITCHED_OFF_MESSAGE = "Your sign-off PIN has been switched off after too many wrong tries. Choose Forgot PIN and use the link we email you to set a new one.";
const SWITCHED_OFF = { status: 423, body: { error: "pin_switched_off", message: PIN_SWITCHED_OFF_MESSAGE } };

export type PinLock = { status: number; body: { error: string; message: string } };

function attemptsKey(userId: string) {
  return `pin_attempts:${userId}`;
}
function lockoutsKey(userId: string) {
  return `pin_lockouts:${userId}`;
}

export async function recordFailedPinAttempt(userId: string): Promise<{ locked: boolean; remaining: number; lock: PinLock }> {
  const key = attemptsKey(userId);
  // Atomic increment avoids the read-modify-write race that could let concurrent
  // wrong-PIN requests undercount attempts and bypass the lockout.
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOCKOUT_SECONDS);
  }

  const remaining = Math.max(0, MAX_ATTEMPTS - count);
  if (count !== MAX_ATTEMPTS) return { locked: count >= MAX_ATTEMPTS, remaining, lock: TOO_MANY };
  // This attempt started a lockout: count it towards the hard stop.
  const lockouts = await redis.incr(lockoutsKey(userId));
  if (lockouts === 1) await redis.expire(lockoutsKey(userId), LOCKOUT_WINDOW_SECONDS);
  if (lockouts < MAX_LOCKOUTS) return { locked: true, remaining, lock: TOO_MANY };
  await db.update(usersTable).set({ pinLockedAt: new Date() }).where(eq(usersTable.id, userId));
  await recordCredentialEvent(userId, "pin_switched_off");
  return { locked: true, remaining, lock: SWITCHED_OFF };
}

// Null when the PIN may be tried; otherwise the response to send.
export async function pinLockResponse(userId: string): Promise<PinLock | null> {
  const row = (await db.select({ pinLockedAt: usersTable.pinLockedAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1))[0];
  if (row?.pinLockedAt) return SWITCHED_OFF;
  const val = await redis.get(attemptsKey(userId));
  return val !== null && parseInt(val, 10) >= MAX_ATTEMPTS ? TOO_MANY : null;
}

export async function clearPinAttempts(userId: string, opts?: { lockouts?: boolean }): Promise<void> {
  await redis.del(attemptsKey(userId));
  if (opts?.lockouts) await redis.del(lockoutsKey(userId));
}
