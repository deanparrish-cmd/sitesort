import { db } from "@workspace/db";
import { permitsTable, projectsTable, usersTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import { sendPermitExpiryEmail } from "./email";
import { logger } from "./logger";

// Send emails for permits expiring in 7 ± 1 days and 1 day (the day before).
// Called once at startup and then every 24 h.
async function runPermitReminders() {
  try {
    if (!process.env.RESEND_API_KEY) return;

    const now = new Date();
    const windows = [
      { min: 6, max: 8 },   // ~7 days
      { min: 0, max: 2 },   // ~1 day
    ];

    for (const { min, max } of windows) {
      const from = new Date(now.getTime() + min * 86_400_000);
      const to = new Date(now.getTime() + max * 86_400_000);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const permits = await db
        .select({
          id: permitsTable.id,
          type: permitsTable.type,
          description: permitsTable.description,
          expiryDate: permitsTable.expiryDate,
          responsibleUserId: permitsTable.responsibleUserId,
          projectId: permitsTable.projectId,
        })
        .from(permitsTable)
        .where(and(gte(permitsTable.expiryDate, fromStr), lte(permitsTable.expiryDate, toStr), isNotNull(permitsTable.responsibleUserId)));

      for (const permit of permits) {
        if (!permit.responsibleUserId) continue;

        const [user] = await db
          .select({ name: usersTable.name, email: usersTable.email, emailNotifications: usersTable.emailNotifications })
          .from(usersTable)
          .where(eq(usersTable.id, permit.responsibleUserId))
          .limit(1);

        if (!user?.emailNotifications) continue;

        const [project] = await db
          .select({ name: projectsTable.name })
          .from(projectsTable)
          .where(eq(projectsTable.id, permit.projectId))
          .limit(1);

        const expiryDate = new Date(permit.expiryDate + "T12:00:00");
        const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / 86_400_000);

        sendPermitExpiryEmail(
          user.email,
          user.name,
          permit.type,
          permit.description,
          project?.name ?? "Unknown project",
          daysLeft,
        ).catch(err => logger.warn({ err }, "Failed to send permit expiry email"));
      }
    }
  } catch (err) {
    logger.error({ err }, "Permit reminders error");
  }
}

export function schedulePermitReminders() {
  // Run once shortly after startup, then every 24 h
  setTimeout(runPermitReminders, 30_000);
  setInterval(runPermitReminders, 24 * 60 * 60 * 1000);
}
