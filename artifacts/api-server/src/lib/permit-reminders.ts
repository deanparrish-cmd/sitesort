import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  permitsTable, projectsTable, usersTable, insuranceRecordsTable,
  subcontractorsTable, expiryReminderLogsTable,
} from "@workspace/db/schema";
import { and, eq, gte, lte, isNull } from "drizzle-orm";
import { sendPermitExpiryEmail, sendInsuranceExpiryEmail } from "./email";
import { logger } from "./logger";

// Pre-expiry reminder thresholds (days before expiry). One email is sent the
// first time an item's days-remaining drops to or below each threshold.
const PRE_EXPIRY_THRESHOLDS = [30, 21, 14, 7, 1];
// After expiry we keep reminding daily for this many days (exp-0 = day of
// expiry, through exp-6), then stop — so up to 7 "expired" emails total.
const EXPIRED_GRACE_DAYS = 6;

// Whole-day difference between an expiry date (YYYY-MM-DD) and today.
export function daysUntil(expiryStr: string, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expiryStr.slice(0, 10).split("-").map(Number);
  const exp = new Date(y, m - 1, d);
  return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
}

// Maps days-remaining to the milestone key we'd send today, or null if no
// reminder is due. Pre-expiry uses the smallest threshold >= daysLeft (so an
// item that first appears at e.g. 5 days out gets the "7" reminder, not a burst
// of 30/21/14). Expired items get a per-day key for daily nagging within grace.
export function milestoneFor(daysLeft: number): string | null {
  if (daysLeft >= 1) {
    const bucket = PRE_EXPIRY_THRESHOLDS
      .filter(t => t >= daysLeft)
      .sort((a, b) => a - b)[0];
    return bucket === undefined ? null : String(bucket);
  }
  if (daysLeft <= 0 && daysLeft >= -EXPIRED_GRACE_DAYS) return `exp-${-daysLeft}`;
  return null;
}

// Atomically records that a milestone email was sent. Returns true only on the
// first insert (unique constraint → ON CONFLICT DO NOTHING), so emails never
// repeat for the same item + milestone even if the job runs more than once a day.
async function claimMilestone(entityType: string, entityId: string, milestone: string): Promise<boolean> {
  const inserted = await db
    .insert(expiryReminderLogsTable)
    .values({ id: randomUUID(), entityType, entityId, milestone })
    .onConflictDoNothing({ target: [expiryReminderLogsTable.entityType, expiryReminderLogsTable.entityId, expiryReminderLogsTable.milestone] })
    .returning({ id: expiryReminderLogsTable.id });
  return inserted.length > 0;
}

// Date-string bounds for the scan window: from EXPIRED_GRACE_DAYS in the past to
// 30 days ahead. Anything outside this can't have a milestone due today.
function scanWindow(now: Date): { fromStr: string; toStr: string } {
  const fromStr = new Date(now.getTime() - EXPIRED_GRACE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const toStr = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  return { fromStr, toStr };
}

// Permits expiring soon / expired → email the responsible user (one per milestone).
async function runPermitReminders(now: Date) {
  const { fromStr, toStr } = scanWindow(now);

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
    .where(and(
      gte(permitsTable.expiryDate, fromStr),
      lte(permitsTable.expiryDate, toStr),
      isNull(permitsTable.archivedAt),
    ));

  for (const permit of permits) {
    const daysLeft = daysUntil(permit.expiryDate, now);
    const milestone = milestoneFor(daysLeft);
    if (!milestone) continue;

    const [user] = await db
      .select({ name: usersTable.name, email: usersTable.email, emailNotifications: usersTable.emailNotifications })
      .from(usersTable)
      .where(eq(usersTable.id, permit.responsibleUserId))
      .limit(1);
    if (!user?.emailNotifications) continue;

    if (!(await claimMilestone("permit", permit.id, milestone))) continue;

    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, permit.projectId))
      .limit(1);

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

// Subcontractor insurance expiring soon / expired. Insurance has no single
// responsible user, so alerts go to the company's admins (who manage compliance).
async function runInsuranceReminders(now: Date) {
  const { fromStr, toStr } = scanWindow(now);

  // Cache company admins to avoid re-querying per record.
  const adminsByCompany = new Map<string, Array<{ name: string; email: string }>>();
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
    .where(and(
      gte(insuranceRecordsTable.expiryDate, fromStr),
      lte(insuranceRecordsTable.expiryDate, toStr),
      isNull(insuranceRecordsTable.archivedAt),
    ));

  for (const record of records) {
    const daysLeft = daysUntil(record.expiryDate, now);
    const milestone = milestoneFor(daysLeft);
    if (!milestone) continue;

    const admins = await adminsFor(record.companyId);
    if (admins.length === 0) continue;

    // One claim per record+milestone — admins are notified together as a batch.
    if (!(await claimMilestone("insurance", record.id, milestone))) continue;

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
