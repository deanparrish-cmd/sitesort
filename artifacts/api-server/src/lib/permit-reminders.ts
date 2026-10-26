import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  permitsTable, projectsTable, usersTable, insuranceRecordsTable,
  subcontractorsTable, expiryReminderLogsTable, personCertificationsTable, peopleTable, companyMembersTable,
} from "@workspace/db/schema";
import { and, eq, gte, lte, isNull, inArray } from "drizzle-orm";
import { sendPermitExpiryEmail, sendInsuranceExpiryEmail, sendPersonCertExpiryEmail } from "./email";
import { daysUntilExpiry } from "./expiry";
import { logger } from "./logger";
import { notify } from "./db-watchdog";

// Pre-expiry reminder thresholds (days before expiry). One email is sent the
// first time an item's days-remaining drops to or below each threshold.
const PRE_EXPIRY_THRESHOLDS = [30, 21, 14, 7, 1];
// After expiry we keep reminding daily for this many days (exp-0 = day of
// expiry, through exp-6), then stop — so up to 7 "expired" emails total.
const EXPIRED_GRACE_DAYS = 6;

// Whole-day difference between an expiry date (YYYY-MM-DD) and today.
// Delegates to the shared expiry helper so the reminder job and the UI status
// bands stay in lock-step. Re-exported under the original name for callers/tests.
export function daysUntil(expiryStr: string, now: Date): number {
  return daysUntilExpiry(expiryStr, now);
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

// Undo a claim when the email didn't go, so the next run sends it. Before
// 2026-10-16 the claim stood even when Resend refused the email: the reminder
// was recorded as sent and never retried. The milestone stays the same the
// next day (a 7-day reminder is still due at 6 days), so a retry is on time.
async function releaseMilestone(entityType: string, entityId: string, milestone: string): Promise<void> {
  await db.delete(expiryReminderLogsTable).where(and(
    eq(expiryReminderLogsTable.entityType, entityType),
    eq(expiryReminderLogsTable.entityId, entityId),
    eq(expiryReminderLogsTable.milestone, milestone),
  ));
}

// Who is told when a firm's insurance or a person's certificate is about to
// lapse: every admin AND project manager of the company (Dean, 2026-10-26:
// "the one person responsible for a site is the one person not told"; PMs are
// company-wide, 2026-10-08). Membership comes from company_members, so an
// admin or PM whose home company is elsewhere is included too (before, only
// users homed at the company with role admin were emailed). Portal-only
// accounts never; the email setting is respected as before.
export async function reminderRecipients(companyId: string): Promise<Array<{ userId: string; name: string; email: string }>> {
  const rows = await db
    .select({ userId: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(companyMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
    .where(and(
      eq(companyMembersTable.companyId, companyId),
      inArray(companyMembersTable.role, ["admin", "project_manager"]),
      eq(usersTable.emailNotifications, true),
      eq(usersTable.portalOnly, false),
    ));
  const seen = new Set<string>();
  return rows.filter(r => !seen.has(r.userId) && seen.add(r.userId));
}

// Date-string bounds for the scan window: from EXPIRED_GRACE_DAYS in the past to
// 30 days ahead. Anything outside this can't have a milestone due today.
function scanWindow(now: Date): { fromStr: string; toStr: string } {
  const fromStr = new Date(now.getTime() - EXPIRED_GRACE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const toStr = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  return { fromStr, toStr };
}

// Per-run tally of what happened to each scanned item, so a run that sends
// nothing still explains itself in the logs instead of going dark.
type ReminderStats = { scanned: number; noMilestone: number; notifyOff: number; deduped: number; sent: number; failed: number };

// A reminder Resend refused (or that never reached it). Its milestone is
// un-recorded so the next run tries again, and the run emails OPS_ALERT_EMAIL.
type ReminderFailure = { what: string; to: string; error: string };
const errMsg = (err: unknown) => err instanceof Error ? err.message : String(err);

// Permits expiring soon / expired → email the responsible user (one per milestone).
async function runPermitReminders(now: Date, failures: ReminderFailure[]): Promise<ReminderStats> {
  const stats: ReminderStats = { scanned: 0, noMilestone: 0, notifyOff: 0, deduped: 0, sent: 0, failed: 0 };
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

  stats.scanned = permits.length;
  for (const permit of permits) {
    const daysLeft = daysUntil(permit.expiryDate, now);
    const milestone = milestoneFor(daysLeft);
    if (!milestone) { stats.noMilestone++; continue; }

    const [user] = await db
      .select({ name: usersTable.name, email: usersTable.email, emailNotifications: usersTable.emailNotifications })
      .from(usersTable)
      .where(eq(usersTable.id, permit.responsibleUserId))
      .limit(1);
    if (!user?.emailNotifications) { stats.notifyOff++; continue; }

    if (!(await claimMilestone("permit", permit.id, milestone))) { stats.deduped++; continue; }

    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, permit.projectId))
      .limit(1);

    logger.info({ permitId: permit.id, milestone, daysLeft, to: user.email }, "Sending permit expiry email");
    try {
      await sendPermitExpiryEmail(
        user.email,
        user.name,
        permit.type,
        permit.description,
        project?.name ?? "Unknown project",
        daysLeft,
        { type: "reminder", id: `permit:${permit.id}:${milestone}` },
      );
      stats.sent++;
    } catch (err) {
      await releaseMilestone("permit", permit.id, milestone);
      stats.failed++;
      failures.push({ what: `Permit ${permit.type} on ${project?.name ?? "a project"} (${milestone})`, to: user.email, error: errMsg(err) });
      logger.error({ err, permitId: permit.id, milestone }, "Permit expiry email not sent; will retry next run");
    }
  }
  return stats;
}

// Subcontractor insurance expiring soon / expired. Insurance has no single
// responsible user, so alerts go to the company's admins (who manage compliance).
async function runInsuranceReminders(now: Date, failures: ReminderFailure[]): Promise<ReminderStats> {
  const stats: ReminderStats = { scanned: 0, noMilestone: 0, notifyOff: 0, deduped: 0, sent: 0, failed: 0 };
  const { fromStr, toStr } = scanWindow(now);

  // Cache company admins to avoid re-querying per record.
  const adminsByCompany = new Map<string, Array<{ name: string; email: string }>>();
  async function adminsFor(companyId: string) {
    const cached = adminsByCompany.get(companyId);
    if (cached) return cached;
    const admins = await reminderRecipients(companyId);
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

  stats.scanned = records.length;
  for (const record of records) {
    const daysLeft = daysUntil(record.expiryDate, now);
    const milestone = milestoneFor(daysLeft);
    if (!milestone) { stats.noMilestone++; continue; }

    const admins = await adminsFor(record.companyId);
    if (admins.length === 0) { stats.notifyOff++; continue; }

    // One claim per record+milestone: admins and PMs are notified together as a batch.
    if (!(await claimMilestone("insurance", record.id, milestone))) { stats.deduped++; continue; }

    logger.info({ recordId: record.id, milestone, daysLeft, recipients: admins.length }, "Sending Insurance expiry email");
    // Recorded as sent if at least one admin's email was accepted; if none
    // was, un-recorded so the next run tries again.
    let accepted = 0;
    for (const admin of admins) {
      try {
        await sendInsuranceExpiryEmail(admin.email, admin.name, record.type, record.subcontractorName, daysLeft, { type: "reminder", id: `insurance:${record.id}:${milestone}` });
        accepted++;
      } catch (err) {
        failures.push({ what: `${record.subcontractorName} ${record.type} insurance (${milestone})`, to: admin.email, error: errMsg(err) });
        logger.error({ err, recordId: record.id, milestone }, "Insurance expiry email not sent");
      }
    }
    if (accepted > 0) stats.sent++;
    else { await releaseMilestone("insurance", record.id, milestone); stats.failed++; }
  }
  return stats;
}

// Person certifications (CSCS, SSSTS, gas safe, plant tickets, etc.) expiring
// soon / expired. Same shape as runInsuranceReminders: notifies the company's
// admins and PMs (reminderRecipients; compliance is their concern, not the
// individual's).
async function runPersonCertReminders(now: Date, failures: ReminderFailure[]): Promise<ReminderStats> {
  const stats: ReminderStats = { scanned: 0, noMilestone: 0, notifyOff: 0, deduped: 0, sent: 0, failed: 0 };
  const { fromStr, toStr } = scanWindow(now);

  const adminsByCompany = new Map<string, Array<{ name: string; email: string }>>();
  async function adminsFor(companyId: string) {
    const cached = adminsByCompany.get(companyId);
    if (cached) return cached;
    const admins = await reminderRecipients(companyId);
    adminsByCompany.set(companyId, admins);
    return admins;
  }

  const certs = await db
    .select({
      id: personCertificationsTable.id,
      name: personCertificationsTable.name,
      expiryDate: personCertificationsTable.expiryDate,
      personName: peopleTable.name,
      companyId: peopleTable.companyId,
    })
    .from(personCertificationsTable)
    .innerJoin(peopleTable, eq(personCertificationsTable.personId, peopleTable.id))
    .where(and(
      gte(personCertificationsTable.expiryDate, fromStr),
      lte(personCertificationsTable.expiryDate, toStr),
      isNull(personCertificationsTable.archivedAt),
    ));

  stats.scanned = certs.length;
  for (const cert of certs) {
    const daysLeft = daysUntil(cert.expiryDate, now);
    const milestone = milestoneFor(daysLeft);
    if (!milestone) { stats.noMilestone++; continue; }

    const admins = await adminsFor(cert.companyId);
    if (admins.length === 0) { stats.notifyOff++; continue; }

    if (!(await claimMilestone("person_cert", cert.id, milestone))) { stats.deduped++; continue; }

    logger.info({ certId: cert.id, milestone, daysLeft, recipients: admins.length }, "Sending Person certification expiry email");
    // Recorded as sent if at least one admin's email was accepted; if none
    // was, un-recorded so the next run tries again.
    let accepted = 0;
    for (const admin of admins) {
      try {
        await sendPersonCertExpiryEmail(admin.email, admin.name, cert.name, cert.personName, daysLeft, { type: "reminder", id: `person_cert:${cert.id}:${milestone}` });
        accepted++;
      } catch (err) {
        failures.push({ what: `${cert.personName} ${cert.name} (${milestone})`, to: admin.email, error: errMsg(err) });
        logger.error({ err, certId: cert.id, milestone }, "Person certification expiry email not sent");
      }
    }
    if (accepted > 0) stats.sent++;
    else { await releaseMilestone("person_cert", cert.id, milestone); stats.failed++; }
  }
  return stats;
}

// One email per run to OPS_ALERT_EMAIL listing every reminder that didn't go.
async function alertReminderFailures(failures: ReminderFailure[]): Promise<void> {
  const shown = failures.slice(0, 30);
  await notify(`SiteSort: ${failures.length} expiry reminder${failures.length === 1 ? "" : "s"} could not be sent`, [
    "These expiry reminder emails were refused or could not reach the email service. Nobody was warned about these yet.",
    ...shown.map(f => `${f.what}. To ${f.to}. ${f.error}`),
    ...(failures.length > shown.length ? [`And ${failures.length - shown.length} more.`] : []),
    "Each one will be tried again the next time reminders run. Check Resend if this keeps happening.",
  ]).catch(err => logger.error({ err }, "reminder failure alert not sent"));
}

// Called once at startup and then every 24 h.
export async function runComplianceReminders() {
  try {
    if (!process.env.RESEND_API_KEY) {
      logger.warn("Compliance reminders skipped: RESEND_API_KEY is not set");
      return;
    }
    const now = new Date();
    const failures: ReminderFailure[] = [];
    const permits = await runPermitReminders(now, failures);
    const insurance = await runInsuranceReminders(now, failures);
    const personCerts = await runPersonCertReminders(now, failures);
    logger.info({ permits, insurance, personCerts }, "Compliance reminders run complete");
    if (failures.length) await alertReminderFailures(failures);
  } catch (err) {
    logger.error({ err }, "Compliance reminders error");
  }
}

export function schedulePermitReminders() {
  // Run once shortly after startup, then every 24 h
  setTimeout(runComplianceReminders, 30_000);
  setInterval(runComplianceReminders, 24 * 60 * 60 * 1000);
}
