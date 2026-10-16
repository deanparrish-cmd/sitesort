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

// What kind of database failure this is, from the error alone. "paused" is a
// best guess at the wording of a suspended/disabled managed Postgres (Replit's
// zero-credit pause): it has not been seen in our logs yet, so anything we
// don't recognise falls through to "unreachable"/"error" with the raw message
// logged alongside, and the pattern can be tightened once a real one is seen.
export type DbFailureKind = "paused" | "timeout" | "auth" | "unreachable" | "error";

export interface DbFailure {
  kind: DbFailureKind;
  code: string | null;
  message: string;
}

export function classifyDbError(err: unknown): DbFailure {
  // Drizzle wraps the driver error ("Failed query: ...") and keeps it as
  // `cause`; classify the innermost one.
  for (let i = 0; i < 5 && (err as { cause?: unknown } | null)?.cause; i++) err = (err as { cause: unknown }).cause;
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : null;
  const message = typeof e?.message === "string" ? e.message : String(err);
  let kind: DbFailureKind = "error";
  if (/disabled|suspend|paused|quota|exceeded the|billing/i.test(message)) kind = "paused";
  else if (code === "28P01" || code === "28000") kind = "auth";
  else if (/timeout|timed out/i.test(message) || code === "ETIMEDOUT") kind = "timeout";
  else if (
    (code && (/^(08|57P)/.test(code) || ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"].includes(code)))
    || /connection terminated|terminating connection|connect ECONN|getaddrinfo/i.test(message)
  ) kind = "unreachable";
  return { kind, code, message };
}

// True when an error means "the database can't be reached at all" (paused,
// down, unreachable), as opposed to a bad query. Routes use it to answer 503
// with a plain message instead of a generic 500.
export function isDbUnavailableError(err: unknown): boolean {
  return classifyDbError(err).kind !== "error";
}

// Connectivity probe for /api/health, the startup check and the DB watchdog.
// Returns the classified failure (with the real error message) when it fails.
export async function probeDb(timeoutMs = 5_000): Promise<{ ok: true } | { ok: false; failure: DbFailure }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`db check timeout after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, failure: classifyDbError(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Boolean form, kept for existing callers.
export async function checkDbConnection(timeoutMs = 5_000): Promise<boolean> {
  return (await probeDb(timeoutMs)).ok;
}

export * from "./schema";
