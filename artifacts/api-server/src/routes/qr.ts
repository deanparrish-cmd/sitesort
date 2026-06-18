import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qrCodesTable, qrBoardPinsTable, documentsTable, projectsTable, projectMembersTable, usersTable, permitsTable, photosTable, invoicesTable, siteCheckinsTable, subcontractorsTable, insuranceRecordsTable, calendarEventsTable } from "@workspace/db/schema";
import { eq, and, or, desc, asc, inArray, isNull, gte } from "drizzle-orm";
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

// List pinned items for a project's QR board
router.get("/projects/:projectId/qr-pins", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found" }); return; }
    const pins = await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, req.params.projectId));
    res.json(pins.map(p => ({ id: p.id, itemType: p.itemType, itemId: p.itemId })));
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

// Pin an item to the QR board
router.post("/projects/:projectId/qr-pins", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found" }); return; }
    const { itemType, itemId } = req.body;
    if (!itemType || !itemId) { res.status(400).json({ error: "validation_error", message: "itemType and itemId required" }); return; }
    const id = generateId();
    await db.insert(qrBoardPinsTable).values({ id, projectId: req.params.projectId, itemType, itemId }).onConflictDoNothing();
    res.status(201).json({ id, itemType, itemId });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

// Unpin an item from the QR board
router.delete("/projects/:projectId/qr-pins", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) { res.status(404).json({ error: "not_found" }); return; }
    const { itemType, itemId } = req.body;
    await db.delete(qrBoardPinsTable).where(
      and(eq(qrBoardPinsTable.projectId, req.params.projectId), eq(qrBoardPinsTable.itemType, itemType), eq(qrBoardPinsTable.itemId, itemId))
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
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
        phone: usersTable.phone,
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
      fileUrl: documentsTable.fileUrl,
      createdAt: documentsTable.createdAt,
      publicAccess: documentsTable.publicAccess,
    }).from(documentsTable)
      .where(and(eq(documentsTable.projectId, qr.projectId), eq(documentsTable.status, "current")));

    // Resolve pinned items for this board
    const pins = await db.select().from(qrBoardPinsTable)
      .where(eq(qrBoardPinsTable.projectId, qr.projectId));

    const docPinIds = pins.filter(p => p.itemType === "document").map(p => p.itemId);
    const photoPinIds = pins.filter(p => p.itemType === "photo").map(p => p.itemId);
    const permitPinIds = pins.filter(p => p.itemType === "permit").map(p => p.itemId);

    const [pinnedDocs, pinnedPhotos, pinnedPermitRows] = await Promise.all([
      docPinIds.length > 0 ? db.select().from(documentsTable).where(inArray(documentsTable.id, docPinIds)) : Promise.resolve([]),
      photoPinIds.length > 0 ? db.select().from(photosTable).where(inArray(photosTable.id, photoPinIds)) : Promise.resolve([]),
      permitPinIds.length > 0 ? db.select().from(permitsTable).where(inArray(permitsTable.id, permitPinIds)) : Promise.resolve([]),
    ]);

    // Upcoming custom calendar events for this board: company-wide events
    // (projectId IS NULL) plus events scoped to this project, dated today or later.
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcomingEvents = await db.select({
      id: calendarEventsTable.id,
      title: calendarEventsTable.title,
      eventDate: calendarEventsTable.eventDate,
      note: calendarEventsTable.note,
    }).from(calendarEventsTable)
      .where(and(
        eq(calendarEventsTable.companyId, project.companyId),
        or(isNull(calendarEventsTable.projectId), eq(calendarEventsTable.projectId, qr.projectId)),
        gte(calendarEventsTable.eventDate, todayStr),
      ))
      .orderBy(asc(calendarEventsTable.eventDate));

    const normaliseUrl = (url: string) =>
      url.startsWith("/uploads/") ? url.replace("/uploads/", "/api/uploads/") : url;

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
      siteManager: siteManager ? { name: siteManager.name, email: siteManager.email, phone: siteManager.phone ?? null } : null,
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
      pinnedItems: [
        ...pinnedDocs.map(d => ({
          itemType: "document",
          id: d.id,
          name: d.name,
          type: d.type,
          version: d.version,
          fileUrl: normaliseUrl(d.fileUrl),
        })),
        ...pinnedPhotos.map(p => ({
          itemType: "photo",
          id: p.id,
          referenceNumber: p.referenceNumber,
          category: p.category,
          description: p.description,
          photoUrl: p.photoUrl ? normaliseUrl(p.photoUrl) : null,
        })),
        ...pinnedPermitRows.map(p => {
          const now = new Date();
          const expiry = new Date(p.expiryDate);
          const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const status = daysUntil < 0 ? "expired" : daysUntil <= 30 ? "expiring_soon" : "active";
          return { itemType: "permit", id: p.id, type: p.type, description: p.description, expiryDate: p.expiryDate, status };
        }),
      ],
      upcomingEvents,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to load site board" });
  }
});

// Public check-in endpoint — validates contact registration and insurance before recording
router.post("/site/:token/checkin", checkinUpload.single("photo"), async (req: Request, res: Response) => {
  try {
    const { workerName, companyName, lat, lng } = req.body;
    if (!workerName?.trim() || !companyName?.trim()) {
      res.status(400).json({ error: "validation_error", message: "workerName and companyName required" });
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

    const nameLower = workerName.trim().toLowerCase();
    const companyLower = companyName.trim().toLowerCase();

    // 1) In-house team members (users) assigned to this project — matched on name
    //    alone (no company / insurance requirement: they're covered by the company).
    const projectUsers = await db
      .select({ name: usersTable.name })
      .from(projectMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
      .where(eq(projectMembersTable.projectId, qr.projectId));

    const isInHouseMember = projectUsers.some(u => u.name.trim().toLowerCase() === nameLower);

    if (!isInHouseMember) {
      // 2) Otherwise must be a subcontractor contact linked to this project (name + company)
      //    with at least one valid (non-archived, non-expired) insurance certificate.
      const projectContacts = await db
        .select({
          id: subcontractorsTable.id,
          contactName: subcontractorsTable.contactName,
          companyName: subcontractorsTable.companyName,
        })
        .from(projectMembersTable)
        .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
        .where(eq(projectMembersTable.projectId, qr.projectId));

      const matched = projectContacts.find(c =>
        c.contactName.toLowerCase() === nameLower &&
        c.companyName.toLowerCase() === companyLower
      );

      if (!matched) {
        res.status(403).json({ error: "check_in_blocked", reason: "not_registered" });
        return;
      }

      const today = new Date().toISOString().split("T")[0];
      const validInsurance = await db
        .select({ id: insuranceRecordsTable.id })
        .from(insuranceRecordsTable)
        .where(and(
          eq(insuranceRecordsTable.subcontractorId, matched.id),
          isNull(insuranceRecordsTable.archivedAt),
          gte(insuranceRecordsTable.expiryDate, today),
        ))
        .limit(1);

      if (validInsurance.length === 0) {
        res.status(403).json({ error: "check_in_blocked", reason: "no_valid_insurance" });
        return;
      }
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
      companyName: companyName.trim(),
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

// Authenticated — list all check-ins across all company projects
router.get("/checkins", authenticate, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: siteCheckinsTable.id,
        projectId: siteCheckinsTable.projectId,
        projectName: projectsTable.name,
        workerName: siteCheckinsTable.workerName,
        companyName: siteCheckinsTable.companyName,
        photoUrl: siteCheckinsTable.photoUrl,
        checkedInAt: siteCheckinsTable.checkedInAt,
        lat: siteCheckinsTable.lat,
        lng: siteCheckinsTable.lng,
      })
      .from(siteCheckinsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, siteCheckinsTable.projectId))
      .where(eq(projectsTable.companyId, req.user!.companyId))
      .orderBy(desc(siteCheckinsTable.checkedInAt));

    res.json(rows.map(c => ({ ...c, checkedInAt: c.checkedInAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "List all checkins error");
    res.status(500).json({ error: "server_error", message: "Failed to load check-ins" });
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
