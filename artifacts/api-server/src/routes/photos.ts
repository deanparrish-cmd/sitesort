import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { photosTable, usersTable, notificationsTable, projectMembersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

let photoCounter = 1000;

router.get("/projects/:projectId/photos", authenticate, async (req, res) => {
  try {
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

router.post("/projects/:projectId/photos", authenticate, async (req, res) => {
  try {
    const { photoUrl, category, description, zone, latitude, longitude } = req.body;
    if (!photoUrl || !category) {
      res.status(400).json({ error: "validation_error", message: "photoUrl and category required" });
      return;
    }

    const refNum = `PROJ-PHOTO-${String(++photoCounter).padStart(4, "0")}`;
    const id = generateId();
    await db.insert(photosTable).values({
      id,
      projectId: req.params.projectId,
      uploadedBy: req.user!.id,
      photoUrl,
      category,
      description: description ?? null,
      zone: zone ?? null,
      referenceNumber: refNum,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    });

    if (category === "safety_concern" || category === "snag") {
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
