import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { dailyReportsTable, dailyNotesTable, projectsTable, usersTable, type ManagerReport } from "@workspace/db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { generateDailyReportForProject, EMPTY_REPORT_DATA } from "../lib/daily-reports";
import { generateId } from "../lib/id";

const router: IRouter = Router();

const INTERNAL_ROLES = ["admin", "project_manager", "site_worker"];

function isInternal(role: string): boolean {
  return INTERNAL_ROLES.includes(role);
}

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// The structured "site diary" fields a manager/worker can author. Kept in this
// fixed order so the frontend form and any export render consistently.
const MANAGER_REPORT_FIELDS = [
  "weather", "labourOnSite", "plantEquipment", "workCompleted", "delaysIssues", "deliveries", "hsNotes",
] as const;
const MANAGER_FIELD_MAX = 5000;

// Trim/cap each provided field; drop empties. Returns null if nothing usable was
// supplied (so an all-blank submit doesn't create a hollow report row).
function sanitizeManagerReport(body: unknown): ManagerReport | null {
  if (!body || typeof body !== "object") return null;
  const src = body as Record<string, unknown>;
  const out: ManagerReport = {};
  for (const key of MANAGER_REPORT_FIELDS) {
    const raw = src[key];
    if (typeof raw !== "string") continue;
    const val = raw.trim().slice(0, MANAGER_FIELD_MAX);
    if (val) out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// A stored managerReport counts as "present" only if it has at least one non-empty field.
function hasManagerContent(mr: ManagerReport | null | undefined): boolean {
  return !!mr && MANAGER_REPORT_FIELDS.some((k) => typeof mr[k] === "string" && mr[k]!.trim().length > 0);
}

// F5 — company-wide Daily Site Reports hub. Lists every project's reports for the
// active company, newest first. Optional filters: ?projectId, ?from, ?to (dates).
router.get("/daily-reports", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to view reports" });
      return;
    }

    const filters = [eq(projectsTable.companyId, req.user!.companyId)];

    const projectId = req.query.projectId as string | undefined;
    if (projectId) filters.push(eq(dailyReportsTable.projectId, projectId));

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    for (const [val, label] of [[from, "from"], [to, "to"]] as const) {
      if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        res.status(400).json({ error: "validation_error", message: `${label} must be YYYY-MM-DD` });
        return;
      }
    }
    if (from) filters.push(gte(dailyReportsTable.reportDate, from));
    if (to) filters.push(lte(dailyReportsTable.reportDate, to));

    const rows = await db
      .select({
        id: dailyReportsTable.id,
        projectId: dailyReportsTable.projectId,
        projectName: projectsTable.name,
        reportDate: dailyReportsTable.reportDate,
        generatedAt: dailyReportsTable.generatedAt,
        checkinCount: dailyReportsTable.checkinCount,
        documentEventCount: dailyReportsTable.documentEventCount,
        photoCount: dailyReportsTable.photoCount,
        managerReport: dailyReportsTable.managerReport,
        authoredAt: dailyReportsTable.authoredAt,
      })
      .from(dailyReportsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, dailyReportsTable.projectId))
      .where(and(...filters))
      .orderBy(desc(dailyReportsTable.reportDate), projectsTable.name);

    res.json(
      rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: r.projectName,
        reportDate: r.reportDate,
        generatedAt: r.generatedAt.toISOString(),
        checkinCount: r.checkinCount,
        documentEventCount: r.documentEventCount,
        photoCount: r.photoCount,
        hasManagerReport: hasManagerContent(r.managerReport),
        authoredAt: r.authoredAt ? r.authoredAt.toISOString() : null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List company daily reports error");
    res.status(500).json({ error: "server_error", message: "Failed to list reports" });
  }
});

// List daily reports for a project (most recent first).
router.get("/projects/:projectId/daily-reports", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to view reports" });
      return;
    }

    const project = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const reports = await db
      .select({
        id: dailyReportsTable.id,
        projectId: dailyReportsTable.projectId,
        reportDate: dailyReportsTable.reportDate,
        generatedAt: dailyReportsTable.generatedAt,
        checkinCount: dailyReportsTable.checkinCount,
        documentEventCount: dailyReportsTable.documentEventCount,
        photoCount: dailyReportsTable.photoCount,
        managerReport: dailyReportsTable.managerReport,
      })
      .from(dailyReportsTable)
      .where(eq(dailyReportsTable.projectId, req.params.projectId))
      .orderBy(desc(dailyReportsTable.reportDate));

    res.json(
      reports.map(({ managerReport, ...r }) => ({
        ...r,
        generatedAt: r.generatedAt.toISOString(),
        hasManagerReport: hasManagerContent(managerReport),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List daily reports error");
    res.status(500).json({ error: "server_error", message: "Failed to list reports" });
  }
});

// Fetch a single daily report with its full collated snapshot.
router.get("/daily-reports/:id", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to view reports" });
      return;
    }

    const rows = await db
      .select({
        id: dailyReportsTable.id,
        projectId: dailyReportsTable.projectId,
        projectName: projectsTable.name,
        reportDate: dailyReportsTable.reportDate,
        generatedAt: dailyReportsTable.generatedAt,
        checkinCount: dailyReportsTable.checkinCount,
        documentEventCount: dailyReportsTable.documentEventCount,
        photoCount: dailyReportsTable.photoCount,
        data: dailyReportsTable.data,
        managerReport: dailyReportsTable.managerReport,
        authoredAt: dailyReportsTable.authoredAt,
        authorName: usersTable.name,
        companyId: projectsTable.companyId,
      })
      .from(dailyReportsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, dailyReportsTable.projectId))
      .leftJoin(usersTable, eq(usersTable.id, dailyReportsTable.authoredBy))
      .where(eq(dailyReportsTable.id, req.params.id))
      .limit(1);

    const report = rows[0];
    if (!report || report.companyId !== req.user!.companyId) {
      res.status(404).json({ error: "not_found", message: "Report not found" });
      return;
    }

    res.json({
      id: report.id,
      projectId: report.projectId,
      projectName: report.projectName,
      reportDate: report.reportDate,
      generatedAt: report.generatedAt.toISOString(),
      checkinCount: report.checkinCount,
      documentEventCount: report.documentEventCount,
      photoCount: report.photoCount,
      data: report.data,
      managerReport: hasManagerContent(report.managerReport) ? report.managerReport : null,
      authorName: report.authorName ?? null,
      authoredAt: report.authoredAt ? report.authoredAt.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err }, "Get daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to load report" });
  }
});

// List site notes (e.g. the spoken daily report) for a project on a given day.
// Defaults to today (Europe/London). Used to show what has already been logged.
router.get("/projects/:projectId/daily-notes", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to view notes" });
      return;
    }

    const project = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const date = (req.query.date as string | undefined) ?? londonToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "validation_error", message: "date must be YYYY-MM-DD" });
      return;
    }

    const notes = await db
      .select({
        id: dailyNotesTable.id,
        body: dailyNotesTable.body,
        source: dailyNotesTable.source,
        noteDate: dailyNotesTable.noteDate,
        photoUrl: dailyNotesTable.photoUrl,
        createdAt: dailyNotesTable.createdAt,
        authorName: usersTable.name,
      })
      .from(dailyNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, dailyNotesTable.authorId))
      .where(and(eq(dailyNotesTable.projectId, req.params.projectId), eq(dailyNotesTable.noteDate, date)))
      .orderBy(desc(dailyNotesTable.createdAt));

    res.json(
      notes.map((n) => ({
        id: n.id,
        body: n.body,
        source: n.source,
        noteDate: n.noteDate,
        photoUrl: n.photoUrl,
        authorName: n.authorName ?? "Unknown",
        createdAt: n.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List daily notes error");
    res.status(500).json({ error: "server_error", message: "Failed to list notes" });
  }
});

// Add a site note (overall spoken daily report) for the current day. Internal staff only.
router.post("/projects/:projectId/daily-notes", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to add notes" });
      return;
    }

    const project = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "validation_error", message: "Note text is required" });
      return;
    }

    const source = req.body?.source === "text" ? "text" : "voice";
    // Optional photo attachment — accept only our own upload URLs, never an
    // arbitrary external link.
    const rawPhoto = typeof req.body?.photoUrl === "string" ? req.body.photoUrl.trim() : "";
    const photoUrl = /^\/(api\/)?uploads\//.test(rawPhoto) ? rawPhoto : null;
    const id = generateId();
    await db.insert(dailyNotesTable).values({
      id,
      projectId: req.params.projectId,
      authorId: req.user!.id,
      noteDate: londonToday(),
      body,
      source,
      photoUrl,
    });

    res.status(201).json({ id, photoUrl });
  } catch (err) {
    req.log.error({ err }, "Create daily note error");
    res.status(500).json({ error: "server_error", message: "Failed to save note" });
  }
});

// F5 — author/edit the structured "site diary" for a project on a given day.
// Upsert: if the 18:00 job hasn't run yet the report row is created early with an
// empty auto snapshot (autoGenerated stays false so the generator later fills it
// in); otherwise the narrative is updated in place. The auto snapshot is never
// touched here. Internal staff (incl. site workers) may author.
router.patch("/projects/:projectId/daily-reports/:date", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to write reports" });
      return;
    }

    const project = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "validation_error", message: "date must be YYYY-MM-DD" });
      return;
    }

    const managerReport = sanitizeManagerReport(req.body);
    const now = new Date();

    if (managerReport === null) {
      // Clearing every field: only affect an existing row, never create a hollow one.
      const cleared = await db
        .update(dailyReportsTable)
        .set({ managerReport: null, authoredBy: req.user!.id, authoredAt: now })
        .where(and(eq(dailyReportsTable.projectId, req.params.projectId), eq(dailyReportsTable.reportDate, date)))
        .returning({ id: dailyReportsTable.id });
      if (cleared.length === 0) {
        res.status(400).json({ error: "validation_error", message: "Enter at least one field" });
        return;
      }
      res.json({ id: cleared[0]!.id, reportDate: date, managerReport: null });
      return;
    }

    const id = generateId();
    const upserted = await db
      .insert(dailyReportsTable)
      .values({
        id,
        projectId: req.params.projectId,
        reportDate: date,
        data: EMPTY_REPORT_DATA,
        managerReport,
        authoredBy: req.user!.id,
        authoredAt: now,
      })
      .onConflictDoUpdate({
        target: [dailyReportsTable.projectId, dailyReportsTable.reportDate],
        set: { managerReport, authoredBy: req.user!.id, authoredAt: now },
      })
      .returning({ id: dailyReportsTable.id });

    res.json({ id: upserted[0]!.id, reportDate: date, managerReport });
  } catch (err) {
    req.log.error({ err }, "Author daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to save report" });
  }
});

// Admin-only manual generation (backfill / on-demand). The normal flow is the
// automatic 18:00 Europe/London scheduler; this is for backfilling a date.
router.post("/projects/:projectId/daily-reports/generate", authenticate, async (req, res) => {
  try {
    if (req.user!.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Admin only" });
      return;
    }

    const project = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const reportDate = (req.body?.reportDate as string | undefined)
      ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      res.status(400).json({ error: "validation_error", message: "reportDate must be YYYY-MM-DD" });
      return;
    }

    const { reportId, created } = await generateDailyReportForProject(req.params.projectId, reportDate);
    res.status(created ? 201 : 200).json({ reportId, reportDate, created });
  } catch (err) {
    req.log.error({ err }, "Generate daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to generate report" });
  }
});

export default router;
