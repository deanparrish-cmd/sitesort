import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { dailyReportsTable, projectsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { generateDailyReportForProject } from "../lib/daily-reports";

const router: IRouter = Router();

const INTERNAL_ROLES = ["admin", "project_manager", "site_worker"];

function isInternal(role: string): boolean {
  return INTERNAL_ROLES.includes(role);
}

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
      })
      .from(dailyReportsTable)
      .where(eq(dailyReportsTable.projectId, req.params.projectId))
      .orderBy(desc(dailyReportsTable.reportDate));

    res.json(
      reports.map((r) => ({
        ...r,
        generatedAt: r.generatedAt.toISOString(),
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
        companyId: projectsTable.companyId,
      })
      .from(dailyReportsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, dailyReportsTable.projectId))
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
    });
  } catch (err) {
    req.log.error({ err }, "Get daily report error");
    res.status(500).json({ error: "server_error", message: "Failed to load report" });
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
