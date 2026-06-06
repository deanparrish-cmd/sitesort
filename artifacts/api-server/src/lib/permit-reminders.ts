import { db } from "@workspace/db";
import { permitsTable, projectsTable, usersTable, insuranceRecordsTable, subcontractorsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import { sendPermitExpiryEmail, sendInsuranceExpiryEmail } from "./email";
import { logger } from "./logger";

// Expiry windows (in days from now) we send reminders for.
const REMINDER_WINDOWS = [
  { min: 6, max: 8 }, // ~7 days out
  { min: 0, max: 2 }, // ~1 day out
];

// Send emails for permits expiring in ~7 days and ~1 day.
async function runPermitReminders(now: Date) {
  for (const { min, max } of REMINDER_WINDOWS) {
    const fromStr = new Date(now.getTime() + min * 86_400_000).toISOString().slice(0, 10);
    const toStr = new Date(now.getTime() + max * 86_400_000).toISOString().slice(0, 10);

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
}

// Send emails for subcontractor insurance certificates expiring in ~7 days
// and ~1 day. Insurance has no single responsible user, so alerts go to the
// company's admins (who manage subcontractor compliance).
async function runInsuranceReminders(now: Date) {
  // Cache company admins to avoid re-querying per record.
  const adminsByCompany = new Map<
    string,
    Array<{ name: string; email: string }>
  >();

  async function adminsFor(companyId: string) {
    const cached = adminsByCompany.get(companyId);
    if (cached) return cached;
    const admins = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.companyId, companyId), eq(usersTable.role, "admin"), eq(usersTable.emailNotifications, true)));
    adminsByCompany.set(companyId, admins);
    return admins;
  }

  for (const { min, max } of REMINDER_WINDOWS) {
    const fromStr = new Date(now.getTime() + min * 86_400_000).toISOString().slice(0, 10);
    const toStr = new Date(now.getTime() + max * 86_400_000).toISOString().slice(0, 10);

    const records = await db
      .select({
        id: insuranceRecordsTable.id,
        type: insuranceRecordsTable.type,
        expiryDate: insuranceRecordsTable.expiryDate,
        subcontractorName: subcontractorsTable.companyName,
        companyId: subcontractorsTable.companyId,
      })
      .from(insuranceRecordsTable)
      .innerJoin(subcontractorsTable, eq(insuranceRecordsTable.subcontractorId, subcontractorsTable.id))
      .where(and(gte(insuranceRecordsTable.expiryDate, fromStr), lte(insuranceRecordsTable.expiryDate, toStr)));

    for (const record of records) {
      const admins = await adminsFor(record.companyId);
      if (admins.length === 0) continue;

      const expiryDate = new Date(record.expiryDate + "T12:00:00");
      const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / 86_400_000);

      for (const admin of admins) {
        sendInsuranceExpiryEmail(
          admin.email,
          admin.name,
          record.type,
          record.subcontractorName,
          daysLeft,
        ).catch(err => logger.warn({ err }, "Failed to send insurance expiry email"));
      }
    }
  }
}

// Called once at startup and then every 24 h.
async function runComplianceReminders() {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const now = new Date();
    await runPermitReminders(now);
    await runInsuranceReminders(now);
  } catch (err) {
    logger.error({ err }, "Compliance reminders error");
  }
}

export function schedulePermitReminders() {
  // Run once shortly after startup, then every 24 h
  setTimeout(runComplianceReminders, 30_000);
  setInterval(runComplianceReminders, 24 * 60 * 60 * 1000);
}
