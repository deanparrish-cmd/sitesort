import { redis } from "./redis";

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function attemptsKey(userId: string) {
  return `pin_attempts:${userId}`;
}

export async function recordFailedPinAttempt(userId: string): Promise<{ locked: boolean; remaining: number }> {
  const key = attemptsKey(userId);
  // Atomic increment avoids the read-modify-write race that could let concurrent
  // wrong-PIN requests undercount attempts and bypass the lockout.
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOCKOUT_SECONDS);
  }

  const remaining = Math.max(0, MAX_ATTEMPTS - count);
  return { locked: count >= MAX_ATTEMPTS, remaining };
}

export async function isPinLockedOut(userId: string): Promise<boolean> {
  const val = await redis.get(attemptsKey(userId));
  return val !== null && parseInt(val, 10) >= MAX_ATTEMPTS;
}

export async function clearPinAttempts(userId: string): Promise<void> {
  await redis.del(attemptsKey(userId));
}
