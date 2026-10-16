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
import { opsAlertAddresses, maskEmail } from "./environment";

// Shown to people (login screen etc.) when the database can't be reached.
export const DB_UNAVAILABLE_MESSAGE =
  "SiteSort is temporarily unavailable. Your data is safe. Please try again in a few minutes.";

const INTERVAL_MS = 2 * 60_000;
// Two failed probes in a row before alerting, so one network blip stays quiet.
const FAILURES_BEFORE_ALERT = 2;

let consecutiveFailures = 0;
let alerted = false;
let downSince: Date | null = null;

// Sends to every configured address, one email each, so one bad address
// can't stop the others. Returns what happened per address.
export async function notify(subject: string, lines: string[]): Promise<{ to: string; ok: boolean; id?: string; error?: string }[]> {
  const addresses = opsAlertAddresses();
  if (addresses.length === 0) {
    logger.warn({ subject }, "db watchdog: OPS_ALERT_EMAIL not set, alert not emailed");
    return [];
  }
  const results = [];
  for (const to of addresses) {
    try {
      const id = await sendOpsAlertEmail(to, subject, lines);
      results.push({ to: maskEmail(to), ok: true, id });
    } catch (err) {
      logger.error({ err, subject, to: maskEmail(to) }, "db watchdog: alert email failed");
      results.push({ to: maskEmail(to), ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  logger.info({ subject, results }, "db watchdog: alert sent");
  return results;
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
  const addresses = opsAlertAddresses();
  if (addresses.length > 0) logger.info({ recipients: addresses.map(maskEmail) }, "db watchdog: on, alerts go to OPS_ALERT_EMAIL");
  else logger.warn("db watchdog: on, but OPS_ALERT_EMAIL is not set, so alerts are only logged");
  const tick = () => { runDbWatchdogCheck().catch(err => logger.error({ err }, "db watchdog: check crashed")); };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}
