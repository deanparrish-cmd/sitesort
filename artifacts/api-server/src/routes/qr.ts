import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qrCodesTable, documentsTable, projectsTable, projectMembersTable, usersTable, permitsTable, siteCheckinsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { randomBytes } from "crypto";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { getBucket, objectKey } from "../lib/gcs";

const checkinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Images only"));
  },
});

const router: IRouter = Router();

const CATEGORY_LABELS: Record<string, string> = {
  site_board: "Site Board",
  safety: "Safety Information",
  emergency: "Emergency Procedures",
  drawings: "Current Drawings",
  general: "General Documents",
};

// List QR codes for a project
router.get("/projects/:projectId/qr-codes", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const codes = await db.select()
      .from(qrCodesTable)
      .where(eq(qrCodesTable.projectId, req.params.projectId));

    const base = `${req.protocol}://${req.get("host")}`;
    res.json(codes.map(qr => ({
      ...qr,
      siteUrl: `${base}/site/${qr.token}`,
      createdAt: qr.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "List QR codes error");
    res.status(500).json({ error: "server_error", message: "Failed to list QR codes" });
  }
});

// Generate QR codes for a project
router.post("/projects/:projectId/qr-codes", authenticate, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) {
      res.status(400).json({ error: "validation_error", message: "categories array required" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .then(r => r[0]);

    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const base = `${req.protocol}://${req.get("host")}`;
    const result = [];

    for (const category of categories) {
      const existing = await db.select().from(qrCodesTable)
        .where(and(eq(qrCodesTable.projectId, req.params.projectId), eq(qrCodesTable.category, category)))
        .then(r => r[0]);

      if (existing) {
        result.push({ ...existing, siteUrl: `${base}/site/${existing.token}`, createdAt: existing.createdAt.toISOString() });
        continue;
      }

      const token = randomBytes(16).toString("hex");
      const id = generateId();
      const label = CATEGORY_LABELS[category] ?? category;

      const [qr] = await db.insert(qrCodesTable).values({
        id,
        projectId: req.params.projectId,
        category,
        token,
        label,
        requiresLogin: false,
      }).returning();

      result.push({ ...qr, siteUrl: `${base}/site/${qr.token}`, createdAt: qr.createdAt.toISOString() });
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Generate QR codes error");
    res.status(500).json({ error: "server_error", message: "Failed to generate QR codes" });
  }
});

// Delete a QR code
router.delete("/projects/:projectId/qr-codes/:id", authenticate, async (req, res) => {
  try {
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .then(r => r[0]);

    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    await db.delete(qrCodesTable).where(and(eq(qrCodesTable.id, req.params.id), eq(qrCodesTable.projectId, req.params.projectId)));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete QR code error");
    res.status(500).json({ error: "server_error", message: "Failed to delete QR code" });
  }
});

// Public site board endpoint — no auth required
router.get("/site/:token", async (req, res) => {
  try {
    const qr = await db.select().from(qrCodesTable)
      .where(eq(qrCodesTable.token, req.params.token))
      .then(r => r[0]);

    if (!qr) {
      res.status(404).json({ error: "not_found", message: "Site board not found" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(eq(projectsTable.id, qr.projectId))
      .then(r => r[0]);

    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const members = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: projectMembersTable.role,
      })
      .from(projectMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
      .where(eq(projectMembersTable.projectId, qr.projectId));

    const permits = await db.select().from(permitsTable)
      .where(eq(permitsTable.projectId, qr.projectId));

    const documents = await db.select({
      id: documentsTable.id,
      name: documentsTable.name,
      type: documentsTable.type,
      version: documentsTable.version,
      createdAt: documentsTable.createdAt,
      publicAccess: documentsTable.publicAccess,
    }).from(documentsTable)
      .where(and(eq(documentsTable.projectId, qr.projectId), eq(documentsTable.status, "current")));

    const siteManager = members.find(m => m.role === "manager") ?? members[0] ?? null;

    res.json({
      project: {
        id: project.id,
        name: project.name,
        address: project.address,
        status: project.status,
        startDate: project.startDate,
        targetEndDate: project.targetEndDate ?? null,
        trades: project.trades ?? [],
      },
      siteManager: siteManager ? { name: siteManager.name, email: siteManager.email } : null,
      teamSize: members.length,
      permits: permits.map(p => ({
        id: p.id,
        type: p.type,
        description: p.description,
        expiryDate: p.expiryDate,
      })),
      documents: documents
        .filter(d => d.publicAccess)
        .map(d => ({
          id: d.id,
          name: d.name,
          type: d.type,
          version: d.version,
          uploadedAt: d.createdAt,
        })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load site board" });
  }
});

// Public check-in endpoint — no auth required
router.post("/site/:token/checkin", checkinUpload.single("photo"), async (req: Request, res: Response) => {
  try {
    const { workerName, lat, lng } = req.body;
    if (!workerName?.trim()) {
      res.status(400).json({ error: "validation_error", message: "workerName required" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "validation_error", message: "photo required" });
      return;
    }

    const qr = await db.select().from(qrCodesTable)
      .where(eq(qrCodesTable.token, req.params.token))
      .then(r => r[0]);
    if (!qr) {
      res.status(404).json({ error: "not_found", message: "Invalid site token" });
      return;
    }

    const ext = path.extname(req.file.originalname || ".jpg").toLowerCase() || ".jpg";
    const filename = `checkin-${randomUUID()}${ext}`;
    const key = objectKey(filename);
    await getBucket().file(key).save(req.file.buffer, {
      contentType: req.file.mimetype,
      resumable: false,
      metadata: { metadata: { originalName: req.file.originalname } },
    });

    const photoUrl = `/api/uploads/${filename}`;
    const id = generateId();
    const [checkin] = await db.insert(siteCheckinsTable).values({
      id,
      projectId: qr.projectId,
      workerName: workerName.trim(),
      photoUrl,
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
    }).returning();

    res.status(201).json({
      ...checkin,
      checkedInAt: checkin.checkedInAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Check-in failed" });
  }
});

// Authenticated — list all check-ins for a project
router.get("/projects/:projectId/checkins", authenticate, async (req: Request, res: Response) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const checkins = await db.select().from(siteCheckinsTable)
      .where(eq(siteCheckinsTable.projectId, req.params.projectId))
      .orderBy(desc(siteCheckinsTable.checkedInAt));

    res.json(checkins.map(c => ({ ...c, checkedInAt: c.checkedInAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load check-ins" });
  }
});

export default router;
