import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { dailyReportsTable, dailyNotesTable, projectsTable, usersTable } from "@workspace/db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { generateDailyReportForProject, hasManagerContent, upsertManagerReport, contributorsForReport } from "../lib/daily-reports";
import { generateId } from "../lib/id";
import { enqueuePushForMembers, acceptedPortalMemberUserIds } from "../lib/push-triggers";
import { notesFor, addNote } from "../lib/portal-submission-notes";

// A report's narrative only counts as "there" for the PM once its author has
// submitted it — a portal member's still-in-progress draft doesn't show.
function hasSubmittedContent(managerReport: unknown, submittedAt: Date | null): boolean {
  return !!submittedAt && hasManagerContent(managerReport as Parameters<typeof hasManagerContent>[0]);
}
async function nameForReportsUser(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const rows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0]?.name ?? null;
}

const router: IRouter = Router();

const INTERNAL_ROLES = ["admin", "project_manager", "site_worker"];

function isInternal(role: string): boolean {
  return INTERNAL_ROLES.includes(role);
}

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
        submittedAt: dailyReportsTable.submittedAt,
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
        // A portal member's still-in-progress draft doesn't count as "there" yet.
        hasManagerReport: hasSubmittedContent(r.managerReport, r.submittedAt),
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
        submittedAt: dailyReportsTable.submittedAt,
      })
      .from(dailyReportsTable)
      .where(eq(dailyReportsTable.projectId, req.params.projectId))
      .orderBy(desc(dailyReportsTable.reportDate));

    res.json(
      reports.map(({ managerReport, submittedAt, ...r }) => ({
        ...r,
        generatedAt: r.generatedAt.toISOString(),
        hasManagerReport: hasSubmittedContent(managerReport, submittedAt),
        lifecycleStatus: hasManagerContent(managerReport) ? (submittedAt ? "submitted" : "draft") : null,
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
        submittedAt: dailyReportsTable.submittedAt,
        submittedBy: dailyReportsTable.submittedBy,
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

    // A portal member's still-in-progress draft narrative isn't shown to the
    // PM yet — only that a draft exists, via lifecycleStatus.
    const hasContent = hasManagerContent(report.managerReport);
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
      managerReport: hasSubmittedContent(report.managerReport, report.submittedAt) ? report.managerReport : null,
      authorName: report.authorName ?? null,
      authoredAt: report.authoredAt ? report.authoredAt.toISOString() : null,
      contributors: await contributorsForReport(report.id),
      lifecycleStatus: hasContent ? (report.submittedAt ? "submitted" : "draft") : null,
      submittedAt: report.submittedAt ? report.submittedAt.toISOString() : null,
      submittedByName: await nameForReportsUser(report.submittedBy),
      submissionNotes: await notesFor("daily_report", report.id),
    });
  } catch (err) {
    req.log.error({ err }, "Get daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to load report" });
  }
});

// POST /api/daily-reports/:id/notes — PM-side append-only note (the dashboard
// counterpart of the portal's POST /portal/daily-report/:date/notes).
router.post("/daily-reports/:id/notes", authenticate, async (req, res) => {
  try {
    if (!isInternal(req.user!.role)) { res.status(403).json({ error: "forbidden", message: "Not allowed to add notes" }); return; }
    const rows = await db.select({ id: dailyReportsTable.id, projectId: dailyReportsTable.projectId, submittedAt: dailyReportsTable.submittedAt, companyId: projectsTable.companyId })
      .from(dailyReportsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, dailyReportsTable.projectId))
      .where(eq(dailyReportsTable.id, req.params.id)).limit(1);
    const report = rows[0];
    if (!report || report.companyId !== req.user!.companyId) { res.status(404).json({ error: "not_found", message: "Report not found" }); return; }
    if (!report.submittedAt) { res.status(400).json({ error: "validation_error", message: "This report hasn't been submitted yet." }); return; }
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) { res.status(400).json({ error: "validation_error", message: "A note body is required." }); return; }

    await addNote({ itemType: "daily_report", itemId: report.id, projectId: report.projectId, authorId: req.user!.id, body: body.trim() });
    res.status(201).json({ submissionNotes: await notesFor("daily_report", report.id) });
  } catch (err) {
    req.log.error({ err }, "Add daily report note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
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

    // Notify every portal member — a site update reaches the whole project.
    try {
      const proj = (await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1))[0];
      const members = await acceptedPortalMemberUserIds(req.params.projectId);
      await enqueuePushForMembers(members, req.params.projectId, {
        kind: "site_update", itemType: "note", itemId: id,
        title: `New site update — ${proj?.name ?? "your project"}`,
        projectName: proj?.name ?? "your project",
        deepLink: "/portal/overview",
      });
    } catch (e) { req.log.warn({ e }, "daily-note push enqueue failed"); }

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

    const result = await upsertManagerReport({
      projectId: req.params.projectId, companyId: req.user!.companyId, date,
      userId: req.user!.id, patch: req.body, req,
    });
    if ("error" in result) {
      res.status(400).json({ error: "validation_error", message: "Enter at least one field" });
      return;
    }
    // Dashboard writes are always immediately "submitted" — the PM IS the
    // destination, there's no draft step for their own entries (mirrors the
    // same convention for dashboard-created site issues/plant items).
    await db.update(dailyReportsTable).set({ submittedAt: new Date(), submittedBy: req.user!.id }).where(eq(dailyReportsTable.id, result.id));
    res.json({ id: result.id, reportDate: date, managerReport: result.managerReport });
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
