// Database watchdog (deployed app only). Probes the database every few minutes
// and emails OPS_ALERT_EMAIL when it stops answering, then again when it comes
// back. Email goes through Resend, which needs no database, so it still works
// while the database is paused.
//
// Limit: the deployment is autoscale, so this only runs while an instance is
// up. With no traffic there is no instance and no check. An outside uptime
// monitor on /api/health (503 when the database is down) is what catches that.
import { probeDb, type DbFailure } from "@workspace/db";
import { sendOpsAlertEmail } from "./email";
import { logger } from "./logger";

// Shown to people (login screen etc.) when the database can't be reached.
export const DB_UNAVAILABLE_MESSAGE =
  "SiteSort is temporarily unavailable. Your data is safe. Please try again in a few minutes.";

const INTERVAL_MS = 2 * 60_000;
// Two failed probes in a row before alerting, so one network blip stays quiet.
const FAILURES_BEFORE_ALERT = 2;

let consecutiveFailures = 0;
let alerted = false;
let downSince: Date | null = null;

function alertAddress(): string | null {
  const to = process.env.OPS_ALERT_EMAIL?.trim();
  return to || null;
}

async function notify(subject: string, lines: string[]): Promise<void> {
  const to = alertAddress();
  if (!to) {
    logger.warn({ subject }, "db watchdog: OPS_ALERT_EMAIL not set, alert not emailed");
    return;
  }
  try {
    await sendOpsAlertEmail(to, subject, lines);
  } catch (err) {
    logger.error({ err, subject }, "db watchdog: alert email failed");
  }
}

function describe(f: DbFailure): string[] {
  const hint = f.kind === "paused"
    ? "This looks like a paused database. On Replit, check the credit balance, then press Unpause on the database. A top-up alone does not bring it back."
    : "Check the database in the Replit Database pane, and the Replit credit balance.";
  return [
    `Kind: ${f.kind}${f.code ? ` (code ${f.code})` : ""}`,
    `Error: ${f.message}`,
    hint,
  ];
}

export async function runDbWatchdogCheck(): Promise<void> {
  const result = await probeDb();
  if (result.ok) {
    if (alerted) {
      const mins = downSince ? Math.round((Date.now() - downSince.getTime()) / 60_000) : null;
      logger.info({ downMinutes: mins }, "db watchdog: database reachable again");
      await notify("SiteSort database is back", [
        `The database is answering again${mins !== null ? ` after about ${mins} minutes` : ""}.`,
      ]);
    }
    consecutiveFailures = 0;
    alerted = false;
    downSince = null;
    return;
  }
  consecutiveFailures++;
  downSince ??= new Date();
  logger.error({ dbFailure: result.failure, consecutiveFailures }, "db watchdog: database check failed");
  if (!alerted && consecutiveFailures >= FAILURES_BEFORE_ALERT) {
    alerted = true;
    await notify(
      result.failure.kind === "paused" ? "SiteSort database is PAUSED" : "SiteSort database is DOWN",
      [`Since ${downSince.toISOString()} the live app cannot reach its database. Logins and the app will fail until it is back.`, ...describe(result.failure)],
    );
  }
}

export function scheduleDbWatchdog(): void {
  const tick = () => { runDbWatchdogCheck().catch(err => logger.error({ err }, "db watchdog: check crashed")); };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}
