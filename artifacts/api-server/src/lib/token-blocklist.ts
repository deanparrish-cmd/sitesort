import { createHash } from "crypto";
import { redis } from "./redis";

function tokenKey(token: string) {
  return `blocklist:${createHash("sha256").update(token).digest("hex")}`;
}

export async function blockToken(token: string, expiresAt: number) {
  const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
  await redis.set(tokenKey(token), "1", "EX", ttl);
}

export async function isTokenBlocked(token: string): Promise<boolean> {
  return (await redis.get(tokenKey(token))) !== null;
}
