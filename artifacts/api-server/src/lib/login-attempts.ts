import { redis } from "./redis";

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function attemptsKey(email: string) {
  return `login_attempts:${email.toLowerCase()}`;
}

export async function recordFailedAttempt(email: string): Promise<{ locked: boolean; remaining: number }> {
  const key = attemptsKey(email);
  const current = await redis.get(key);
  const count = current ? parseInt(current, 10) + 1 : 1;

  await redis.set(key, String(count), "EX", LOCKOUT_SECONDS);

  const remaining = Math.max(0, MAX_ATTEMPTS - count);
  return { locked: count >= MAX_ATTEMPTS, remaining };
}

export async function isLockedOut(email: string): Promise<boolean> {
  const val = await redis.get(attemptsKey(email));
  return val !== null && parseInt(val, 10) >= MAX_ATTEMPTS;
}

export async function clearAttempts(email: string): Promise<void> {
  await redis.del(attemptsKey(email));
}
