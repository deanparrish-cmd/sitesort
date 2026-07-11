import { db } from "@workspace/db";
import {
  projectsTable,
  projectMembersTable,
  siteCheckinsTable,
  documentsTable,
  documentDistributionsTable,
  acknowledgmentAuditTable,
  photosTable,
  usersTable,
  notificationsTable,
  dailyReportsTable,
  dailyNotesTable,
  type DailyReportData,
} from "@workspace/db/schema";
import { and, eq, gte, lt, inArray, isNotNull, sql } from "drizzle-orm";
import { generateId } from "./id";
import { logger } from "./logger";

const REPORT_TZ = "Europe/London";
const REPORT_HOUR = 18; // 6pm — "end of day"
const SNAG_CATEGORIES = ["snag", "mistake", "work_completed"];

// The empty auto-snapshot used when a report row is created early by a manager
// authoring the site diary before the 18:00 job has run. `data` is NOT NULL, so
// author-created rows carry this until the generator fills in the real activity.
export const EMPTY_REPORT_DATA: DailyReportData = {
  subcontractorsOnSite: [],
  documentActivity: { uploaded: [], amended: [], viewed: [], signedOff: [] },
  sitePhotos: [],
  siteManagerNotes: [],
};

// --- Timezone helpers (no external deps) ----------------------------------

// Offset (ms, positive east of UTC) of `tz` at the given instant.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUTC - date.getTime();
}

// YYYY-MM-DD calendar date in REPORT_TZ for the given instant.
function londonDateStr(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// UTC instant for a wall-clock time on `dateStr` (YYYY-MM-DD) in REPORT_TZ.
function londonWallClockUtc(dateStr: string, hour: number): Date {
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offset = tzOffsetMs(guess, REPORT_TZ);
  return new Date(guess.getTime() - offset);
}

function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function msUntilNextLondonReportHour(now: Date): number {
  const todayStr = londonDateStr(now);
  let target = londonWallClockUtc(todayStr, REPORT_HOUR);
  if (target.getTime() <= now.getTime()) {
    target = londonWallClockUtc(addDaysStr(todayStr, 1), REPORT_HOUR);
  }
  return target.getTime() - now.getTime();
}

function isPastReportHour(now: Date): boolean {
  return now.getTime() >= londonWallClockUtc(londonDateStr(now), REPORT_HOUR).getTime();
}

function dateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// --- Report building -------------------------------------------------------

async function buildReportData(
  projectId: string,
  reportDate: string,
  startUtc: Date,
  endUtc: Date,
): Promise<{ data: DailyReportData; checkinCount: number; documentEventCount: number; photoCount: number; noteCount: number }> {
  const checkins = await db
    .select({
      id: siteCheckinsTable.id,
      workerName: siteCheckinsTable.workerName,
      checkedInAt: siteCheckinsTable.checkedInAt,
      photoUrl: siteCheckinsTable.photoUrl,
    })
    .from(siteCheckinsTable)
    .where(
      and(
        eq(siteCheckinsTable.projectId, projectId),
        gte(siteCheckinsTable.checkedInAt, startUtc),
        lt(siteCheckinsTable.checkedInAt, endUtc),
      ),
    )
    .orderBy(siteCheckinsTable.checkedInAt);

  const docRows = await db
    .select({
      id: documentsTable.id,
      name: documentsTable.name,
      type: documentsTable.type,
      version: documentsTable.version,
      previousVersionId: documentsTable.previousVersionId,
      createdAt: documentsTable.createdAt,
      uploaderName: usersTable.name,
    })
    .from(documentsTable)
    .leftJoin(usersTable, eq(usersTable.id, documentsTable.uploadedBy))
    .where(
      and(
        eq(documentsTable.projectId, projectId),
        gte(documentsTable.createdAt, startUtc),
        lt(documentsTable.createdAt, endUtc),
      ),
    )
    .orderBy(documentsTable.createdAt);

  const viewedRows = await db
    .select({
      documentId: documentsTable.id,
      documentName: documentsTable.name,
      userName: usersTable.name,
      at: documentDistributionsTable.viewedAt,
    })
    .from(documentDistributionsTable)
    .innerJoin(documentsTable, eq(documentsTable.id, documentDistributionsTable.documentId))
    .leftJoin(usersTable, eq(usersTable.id, documentDistributionsTable.userId))
    .where(
      and(
        eq(documentsTable.projectId, projectId),
        isNotNull(documentDistributionsTable.viewedAt),
        gte(documentDistributionsTable.viewedAt, startUtc),
        lt(documentDistributionsTable.viewedAt, endUtc),
      ),
    )
    .orderBy(documentDistributionsTable.viewedAt);

  const signedRows = await db
    .select({
      documentId: acknowledgmentAuditTable.documentId,
      documentName: documentsTable.name,
      documentVersion: acknowledgmentAuditTable.documentVersion,
      userName: acknowledgmentAuditTable.userName,
      userRole: acknowledgmentAuditTable.userRole,
      signedOffWithPin: acknowledgmentAuditTable.signedOffWithPin,
      at: acknowledgmentAuditTable.createdAt,
    })
    .from(acknowledgmentAuditTable)
    .innerJoin(documentsTable, eq(documentsTable.id, acknowledgmentAuditTable.documentId))
    .where(
      and(
        eq(documentsTable.projectId, projectId),
        gte(acknowledgmentAuditTable.createdAt, startUtc),
        lt(acknowledgmentAuditTable.createdAt, endUtc),
      ),
    )
    .orderBy(acknowledgmentAuditTable.createdAt);

  const photoRows = await db
    .select({
      id: photosTable.id,
      referenceNumber: photosTable.referenceNumber,
      category: photosTable.category,
      description: photosTable.description,
      zone: photosTable.zone,
      uploaderName: usersTable.name,
      photoUrl: photosTable.photoUrl,
      takenAt: photosTable.takenAt,
    })
    .from(photosTable)
    .leftJoin(usersTable, eq(usersTable.id, photosTable.uploadedBy))
    .where(
      and(
        eq(photosTable.projectId, projectId),
        inArray(photosTable.category, SNAG_CATEGORIES),
        gte(photosTable.takenAt, startUtc),
        lt(photosTable.takenAt, endUtc),
      ),
    )
    .orderBy(photosTable.takenAt);

  const noteRows = await db
    .select({
      id: dailyNotesTable.id,
      body: dailyNotesTable.body,
      source: dailyNotesTable.source,
      createdAt: dailyNotesTable.createdAt,
      authorName: usersTable.name,
    })
    .from(dailyNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, dailyNotesTable.authorId))
    .where(
      and(
        eq(dailyNotesTable.projectId, projectId),
        eq(dailyNotesTable.noteDate, reportDate),
      ),
    )
    .orderBy(dailyNotesTable.createdAt);

  const uploaded = docRows
    .filter((d) => !d.previousVersionId)
    .map((d) => ({
      documentId: d.id,
      name: d.name,
      type: d.type,
      version: d.version,
      uploaderName: d.uploaderName ?? "Unknown",
      at: d.createdAt.toISOString(),
    }));

  const amended = docRows
    .filter((d) => !!d.previousVersionId)
    .map((d) => ({
      documentId: d.id,
      name: d.name,
      type: d.type,
      version: d.version,
      uploaderName: d.uploaderName ?? "Unknown",
      at: d.createdAt.toISOString(),
    }));

  const viewed = viewedRows.map((v) => ({
    documentId: v.documentId,
    documentName: v.documentName,
    userName: v.userName ?? "Unknown",
    at: (v.at as Date).toISOString(),
  }));

  const signedOff = signedRows.map((s) => ({
    documentId: s.documentId,
    documentName: s.documentName,
    documentVersion: s.documentVersion,
    userName: s.userName,
    userRole: s.userRole,
    signedOffWithPin: s.signedOffWithPin,
    at: s.at.toISOString(),
  }));

  const data: DailyReportData = {
    subcontractorsOnSite: checkins.map((c) => ({
      id: c.id,
      workerName: c.workerName,
      checkedInAt: c.checkedInAt.toISOString(),
      photoUrl: c.photoUrl ?? null,
    })),
    documentActivity: { uploaded, amended, viewed, signedOff },
    sitePhotos: photoRows.map((p) => ({
      id: p.id,
      referenceNumber: p.referenceNumber,
      category: p.category,
      description: p.description ?? null,
      zone: p.zone ?? null,
      uploaderName: p.uploaderName ?? "Unknown",
      photoUrl: p.photoUrl ?? null,
      takenAt: p.takenAt.toISOString(),
    })),
    siteManagerNotes: noteRows.map((n) => ({
      id: n.id,
      authorName: n.authorName ?? "Unknown",
      body: n.body,
      source: n.source,
      at: n.createdAt.toISOString(),
    })),
  };

  return {
    data,
    checkinCount: data.subcontractorsOnSite.length,
    documentEventCount: uploaded.length + amended.length + viewed.length + signedOff.length,
    photoCount: data.sitePhotos.length,
    noteCount: data.siteManagerNotes.length,
  };
}

// Generate (or no-op if it already exists) the end-of-day report for one project.
// Returns the report id, and whether it was newly created this call.
export async function generateDailyReportForProject(
  projectId: string,
  reportDate: string,
): Promise<{ reportId: string; created: boolean }> {
  const startUtc = londonWallClockUtc(reportDate, 0);
  const endUtc = londonWallClockUtc(addDaysStr(reportDate, 1), 0);
  const { data, checkinCount, documentEventCount, photoCount, noteCount } = await buildReportData(projectId, reportDate, startUtc, endUtc);

  return db.transaction(async (tx) => {
    const id = generateId();
    // Insert the auto snapshot. If a row already exists it was either (a) created
    // early by a manager authoring the site diary — fill in the auto data now
    // (false→true), preserving their narrative — or (b) already auto-generated on
    // an earlier catch-up run — the `setWhere` guard then skips the update so the
    // immutable snapshot is never rewritten. Either way the manager fields are
    // left untouched. RETURNING yields a row only when an insert or update happened.
    const upserted = await tx
      .insert(dailyReportsTable)
      .values({ id, projectId, reportDate, checkinCount, documentEventCount, photoCount, data, autoGenerated: true })
      .onConflictDoUpdate({
        target: [dailyReportsTable.projectId, dailyReportsTable.reportDate],
        set: { checkinCount, documentEventCount, photoCount, data, generatedAt: sql`now()`, autoGenerated: true },
        setWhere: eq(dailyReportsTable.autoGenerated, false),
      })
      .returning({ id: dailyReportsTable.id });

    if (upserted.length === 0) {
      // Row already auto-generated (setWhere excluded it) — keep it immutable.
      const existing = await tx
        .select({ id: dailyReportsTable.id })
        .from(dailyReportsTable)
        .where(and(eq(dailyReportsTable.projectId, projectId), eq(dailyReportsTable.reportDate, reportDate)))
        .limit(1);
      return { reportId: existing[0]?.id ?? id, created: false };
    }
    // The report id is whichever row now holds this project/date (a fresh insert
    // returns the new id; an update of an early-authored row returns that row's id).
    const reportId = upserted[0]!.id;

    const projectRows = await tx
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const projectName = projectRows[0]?.name ?? "your project";

    const managers = await tx
      .select({ userId: projectMembersTable.userId })
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.role, "manager")));

    const total = checkinCount + documentEventCount + photoCount + noteCount;
    const summary =
      total === 0
        ? "No site activity recorded today."
        : `${checkinCount} subcontractor check-in${checkinCount === 1 ? "" : "s"} · ${documentEventCount} document update${documentEventCount === 1 ? "" : "s"} · ${photoCount} site photo${photoCount === 1 ? "" : "s"} · ${noteCount} site note${noteCount === 1 ? "" : "s"}.`;

    for (const m of managers) {
      if (!m.userId) continue;
      await tx.insert(notificationsTable).values({
        id: generateId(),
        userId: m.userId,
        type: "daily_report",
        title: `Daily site report — ${projectName}`,
        message: `${dateLabel(reportDate)}: ${summary}`,
        relatedEntityId: reportId,
        relatedEntityType: "daily_report",
        read: false,
      });
    }

    return { reportId, created: true };
  });
}

async function generateDailyReportsForAllActiveProjects(reportDate: string): Promise<void> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.status, "active"));

  for (const p of projects) {
    try {
      const { created } = await generateDailyReportForProject(p.id, reportDate);
      if (created) logger.info({ projectId: p.id, reportDate }, "Generated daily report");
    } catch (err) {
      logger.error({ err, projectId: p.id, reportDate }, "Failed to generate daily report for project");
    }
  }
}

// Scheduled at 18:00 Europe/London daily, with a startup catch-up so reports are
// not lost across restarts. Idempotent via the (projectId, reportDate) unique key.
export function scheduleDailyReports(): void {
  const runForToday = () => {
    const reportDate = londonDateStr(new Date());
    generateDailyReportsForAllActiveProjects(reportDate).catch((err) =>
      logger.error({ err }, "Daily report scheduled run error"),
    );
  };

  // Catch-up shortly after boot: yesterday (in case we were down at 18:00),
  // plus today if it is already past the report hour.
  setTimeout(() => {
    const now = new Date();
    const todayStr = londonDateStr(now);
    generateDailyReportsForAllActiveProjects(addDaysStr(todayStr, -1)).catch((err) =>
      logger.error({ err }, "Daily report catch-up error"),
    );
    if (isPastReportHour(now)) {
      generateDailyReportsForAllActiveProjects(todayStr).catch((err) =>
        logger.error({ err }, "Daily report catch-up error"),
      );
    }
  }, 30_000);

  // Run at the next 18:00 London, then re-arm by recomputing the delay to the
  // following 18:00. Chaining setTimeout (rather than a fixed 24h interval)
  // keeps runs aligned to the London wall clock across BST<->GMT transitions.
  const scheduleNext = () => {
    setTimeout(() => {
      runForToday();
      scheduleNext();
    }, msUntilNextLondonReportHour(new Date()));
  };
  scheduleNext();
}
