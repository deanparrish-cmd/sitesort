import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Fail a checkout fast rather than hanging a request forever if the DB is unreachable.
  connectionTimeoutMillis: 10_000,
  // Recycle idle clients so a serverless/managed Postgres (which closes idle
  // connections) doesn't hand us a dead socket.
  idleTimeoutMillis: 30_000,
  max: 10,
});

// CRITICAL: a pg Pool emits an 'error' event when an *idle* client's connection
// breaks (managed Postgres closing idle conns, a network blip, a PG restart).
// With no listener, that 'error' is an unhandled EventEmitter error and crashes
// the whole Node process — which is why the app intermittently 502'd (the process
// died and had to be restarted). Logging it here keeps the process alive; the
// broken client is removed from the pool and the next query gets a fresh one.
pool.on("error", (err) => {
  console.error("[db] idle client error (handled, pool will recover):", err);
});

export const db = drizzle(pool, { schema });

// Lightweight connectivity probe for the /api/health endpoint and startup check.
// Resolves true if a trivial query succeeds within `timeoutMs`, false otherwise.
export async function checkDbConnection(timeoutMs = 5_000): Promise<boolean> {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db check timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export * from "./schema";
