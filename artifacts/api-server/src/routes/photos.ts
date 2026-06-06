import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { photosTable, usersTable, notificationsTable, projectMembersTable, projectsTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendSafetyAlertEmail } from "../lib/email";

const router: IRouter = Router();

router.get("/projects/:projectId/photos", authenticate, async (req, res) => {
  try {
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { category } = req.query as { category?: string };
    const conditions = [eq(photosTable.projectId, req.params.projectId)];
    if (category) conditions.push(eq(photosTable.category, category));

    const photos = await db.select().from(photosTable).where(and(...conditions)).orderBy(photosTable.takenAt);
    const result = await Promise.all(photos.map(async (p) => {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.uploadedBy)).limit(1);
      return {
        id: p.id,
        projectId: p.projectId,
        uploadedBy: p.uploadedBy,
        uploaderName: userRows[0]?.name ?? "Unknown",
        photoUrl: p.photoUrl,
        category: p.category,
        description: p.description ?? null,
        zone: p.zone ?? null,
        referenceNumber: p.referenceNumber,
        latitude: p.latitude ? Number(p.latitude) : null,
        longitude: p.longitude ? Number(p.longitude) : null,
        takenAt: p.takenAt.toISOString(),
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List photos error");
    res.status(500).json({ error: "server_error", message: "Failed to list photos" });
  }
});

const INTERNAL_ROLES = ["admin", "project_manager", "site_worker"];

router.post("/projects/:projectId/photos", authenticate, async (req, res) => {
  try {
    if (!INTERNAL_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Not allowed to log photos" });
      return;
    }

    const { photoUrl, category, description, zone, latitude, longitude } = req.body;
    if (!category) {
      res.status(400).json({ error: "validation_error", message: "category required" });
      return;
    }

    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const [{ total }] = await db.select({ total: count() }).from(photosTable);
    const refNum = `PHOTO-${String(total + 1).padStart(4, "0")}`;
    const id = generateId();
    await db.insert(photosTable).values({
      id,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      photoUrl: photoUrl ?? null,
      category,
      description: description ?? null,
      zone: zone ?? null,
      referenceNumber: refNum,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    });

    if (category === "safety_concern" || category === "snag") {
      const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1);
      const projectName = projectRows[0]?.name ?? "your project";

      const managers = await db.select({ userId: projectMembersTable.userId }).from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.role, "manager")));

      for (const m of managers) {
        if (m.userId) {
          await db.insert(notificationsTable).values({
            id: generateId(),
            userId: m.userId,
            type: "safety_concern",
            title: `⚠️ ${category === "safety_concern" ? "Safety Concern" : "Snag"} logged`,
            message: `A ${category.replace("_", " ")} has been logged on your project. Reference: ${refNum}`,
            relatedEntityId: id,
            relatedEntityType: "photo",
            read: false,
          });

          // Send email alert (fire-and-forget)
          const managerRows = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.userId)).limit(1);
          if (managerRows[0]) {
            const { email: managerEmail, name: managerName } = managerRows[0];
            sendSafetyAlertEmail(managerEmail, managerName, category, refNum, projectName).catch(err =>
              req.log.error({ err }, "Failed to send safety alert email"),
            );
          }
        }
      }
    }

    const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    res.status(201).json({
      id,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      uploaderName: userRows[0]?.name ?? "Unknown",
      photoUrl,
      category,
      description: description ?? null,
      zone: zone ?? null,
      referenceNumber: refNum,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      takenAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Log photo error");
    res.status(500).json({ error: "server_error", message: "Failed to log photo" });
  }
});

export default router;
