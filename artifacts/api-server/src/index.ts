import app from "./app";
import { logger } from "./lib/logger";
import { schedulePermitReminders } from "./lib/permit-reminders";
import { scheduleDailyReports } from "./lib/daily-reports";
import { schedulePushFlush } from "./lib/push-triggers";
import { ensureSchema } from "./lib/ensure-schema";
import { checkDbConnection } from "@workspace/db";

// Process-level safety net. Previously an unhandled rejection or an uncaught
// exception (e.g. a pg pool idle-client error) would kill the process, and
// Replit would restart it — producing intermittent 502s. Log loudly and keep
// serving instead of dying silently. (The pool's own 'error' handler in
// @workspace/db already prevents the most common crash; these are the backstop.)
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "UNHANDLED PROMISE REJECTION (kept alive)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "UNCAUGHT EXCEPTION (kept alive)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Startup DB connectivity check — log a clear message either way, but do NOT
// block listening on it (a transient DB outage shouldn't stop the server from
// coming up and serving /api/health, which reports the DB state).
async function logDbStatus(): Promise<void> {
  const ok = await checkDbConnection();
  if (ok) logger.info("Database connection OK");
  else logger.error("DATABASE UNREACHABLE at startup — server will still listen; /api/health will report db:down");
}

// Race a promise against a timeout so a hung DB can't block app.listen forever
// (which would 502 the whole boot). On timeout we log and continue to listen.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | void> {
  return Promise.race([
    p,
    new Promise<void>((resolve) => setTimeout(() => {
      logger.error({ label, ms }, "startup step timed out — continuing to listen");
      resolve();
    }, ms)),
  ]);
}

async function start(): Promise<void> {
  await logDbStatus();
  // Ensure required schema exists (idempotent) before serving — then listen
  // regardless, so a migration hiccup can't take the server down.
  await withTimeout(ensureSchema(), 30_000, "ensureSchema");

  // Explicit host 0.0.0.0 so the server is reachable behind Replit's router.
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info({ port, host: "0.0.0.0" }, "Server listening");
    schedulePermitReminders();
    scheduleDailyReports();
    schedulePushFlush();
  });
  server.on("error", (err) => {
    logger.error({ err }, "HTTP server error (failed to bind / listen)");
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
