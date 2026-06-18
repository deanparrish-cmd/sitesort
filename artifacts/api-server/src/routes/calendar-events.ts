import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, projectsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

// Managers (admin / project_manager) may create/delete shared calendar events.
function isManager(role?: string): boolean {
  return role === "admin" || role === "project_manager";
}

// List all custom calendar events for the company (visible to every member).
router.get("/calendar-events", authenticate, async (req, res) => {
  try {
    const events = await db.select().from(calendarEventsTable)
      .where(eq(calendarEventsTable.companyId, req.user!.companyId));
    res.json(events);
  } catch (err) {
    req.log.error({ err }, "List calendar events error");
    res.status(500).json({ error: "server_error" });
  }
});

// Create a custom calendar event (managers only).
router.post("/calendar-events", authenticate, async (req, res) => {
  try {
    if (!isManager(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only managers can add calendar events" });
      return;
    }
    const { title, eventDate, note, projectId } = req.body ?? {};
    if (typeof title !== "string" || !title.trim() || typeof eventDate !== "string" || !eventDate.trim()) {
      res.status(400).json({ error: "validation_error", message: "title and eventDate are required" });
      return;
    }
    // projectId is optional (null = company-wide). If provided, verify it belongs to this company (IDOR-safe).
    let resolvedProjectId: string | null = null;
    if (typeof projectId === "string" && projectId.trim()) {
      const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, req.user!.companyId)));
      if (!project) {
        res.status(400).json({ error: "validation_error", message: "Unknown project" });
        return;
      }
      resolvedProjectId = project.id;
    }
    const [event] = await db.insert(calendarEventsTable).values({
      id: randomUUID(),
      companyId: req.user!.companyId,
      createdBy: req.user!.id,
      projectId: resolvedProjectId,
      title: title.trim(),
      eventDate: eventDate.slice(0, 10),
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    }).returning();
    res.status(201).json(event);
  } catch (err) {
    req.log.error({ err }, "Create calendar event error");
    res.status(500).json({ error: "server_error" });
  }
});

// Delete a custom calendar event (managers only, tenant-scoped).
router.delete("/calendar-events/:id", authenticate, async (req, res) => {
  try {
    if (!isManager(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only managers can delete calendar events" });
      return;
    }
    const [deleted] = await db.delete(calendarEventsTable)
      .where(and(eq(calendarEventsTable.id, req.params.id), eq(calendarEventsTable.companyId, req.user!.companyId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "not_found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete calendar event error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
