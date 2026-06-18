import app from "./app";
import { logger } from "./lib/logger";
import { schedulePermitReminders } from "./lib/permit-reminders";
import { scheduleDailyReports } from "./lib/daily-reports";
import { ensureSchema } from "./lib/ensure-schema";

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

// Ensure required schema exists (idempotent) before serving — then listen
// regardless, so a migration hiccup can't take the server down.
ensureSchema().finally(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    schedulePermitReminders();
    scheduleDailyReports();
  });
});
