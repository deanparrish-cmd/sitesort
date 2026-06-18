import Redis from "ioredis";
import { logger } from "./logger";

// In-memory fallback used when REDIS_URL is not configured
const memStore = new Map<string, { value: string; exp: number }>();

setInterval(() => {
  const now = Date.now() / 1000;
  for (const [key, entry] of memStore) {
    if (entry.exp <= now) memStore.delete(key);
  }
}, 60_000).unref();

const memClient = {
  async set(key: string, value: string, _ex: "EX", ttl: number) {
    memStore.set(key, { value, exp: Math.floor(Date.now() / 1000) + ttl });
  },
  async get(key: string): Promise<string | null> {
    const entry = memStore.get(key);
    if (!entry) return null;
    if (entry.exp <= Date.now() / 1000) {
      memStore.delete(key);
      return null;
    }
    return entry.value;
  },
  // Atomic increment within the single-threaded event loop. New keys start at 1
  // with a far-future expiry; callers should set the real TTL via expire().
  async incr(key: string): Promise<number> {
    const now = Date.now() / 1000;
    const entry = memStore.get(key);
    if (!entry || entry.exp <= now) {
      memStore.set(key, { value: "1", exp: now + 365 * 24 * 3600 });
      return 1;
    }
    const next = parseInt(entry.value, 10) + 1;
    entry.value = String(next);
    return next;
  },
  async expire(key: string, ttl: number) {
    const entry = memStore.get(key);
    if (entry) entry.exp = Math.floor(Date.now() / 1000) + ttl;
  },
  async del(key: string) {
    memStore.delete(key);
  },
};

let client: typeof memClient | Redis;

if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
  redis.connect().catch((err) => logger.error({ err }, "Redis connect failed"));
  client = redis as unknown as typeof memClient;
  logger.info("Redis blocklist enabled");
} else {
  client = memClient;
  logger.warn("REDIS_URL not set — using in-memory store (single-instance only, lost on restart)");
}

export { client as redis };
