import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { qrCodesTable, documentsTable, projectsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { randomBytes } from "crypto";

const router: IRouter = Router();

const CATEGORY_LABELS: Record<string, string> = {
  safety: "Safety Information",
  emergency: "Emergency Procedures",
  drawings: "Current Drawings",
  general: "General Documents",
};

const CATEGORY_TYPES: Record<string, string[]> = {
  safety: ["safety"],
  emergency: ["safety"],
  drawings: ["drawing"],
  general: ["general", "method_statement"],
};

router.post("/projects/:projectId/qr-codes", authenticate, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) {
      res.status(400).json({ error: "validation_error", message: "categories array required" });
      return;
    }

    const result = [];
    for (const category of categories) {
      const existing = await db.select().from(qrCodesTable)
        .where(and(eq(qrCodesTable.projectId, req.params.projectId), eq(qrCodesTable.category, category)))
        .limit(1);

      let qr;
      if (existing.length > 0) {
        qr = existing[0];
      } else {
        const token = randomBytes(16).toString("hex");
        const id = generateId();
        const requiresLogin = category !== "safety" && category !== "emergency";

        await db.insert(qrCodesTable).values({
          id,
          projectId: req.params.projectId,
          category,
          token,
          label: CATEGORY_LABELS[category] ?? category,
          requiresLogin,
        });

        qr = { id, projectId: req.params.projectId, category, token, label: CATEGORY_LABELS[category] ?? category, requiresLogin, createdAt: new Date() };
      }

      result.push({
        id: qr.id,
        projectId: qr.projectId,
        category: qr.category,
        token: qr.token,
        qrImageUrl: `/api/qr/${qr.token}/image`,
        label: qr.label,
        requiresLogin: qr.requiresLogin,
        createdAt: qr.createdAt instanceof Date ? qr.createdAt.toISOString() : new Date().toISOString(),
      });
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Generate QR codes error");
    res.status(500).json({ error: "server_error", message: "Failed to generate QR codes" });
  }
});

router.get("/qr/:token", async (req, res) => {
  try {
    const qrRows = await db.select().from(qrCodesTable).where(eq(qrCodesTable.token, req.params.token)).limit(1);
    if (qrRows.length === 0) {
      res.status(404).json({ error: "not_found", message: "QR code not found" });
      return;
    }

    const qr = qrRows[0];
    const projectRows = await db.select().from(projectsTable).where(eq(projectsTable.id, qr.projectId)).limit(1);
    const projectName = projectRows[0]?.name ?? "Unknown Project";

    const docTypes = CATEGORY_TYPES[qr.category] ?? [];
    const allDocs = await db.select().from(documentsTable).where(and(eq(documentsTable.projectId, qr.projectId), eq(documentsTable.status, "current")));
    const filteredDocs = allDocs.filter(d => docTypes.includes(d.type) && d.publicAccess);

    res.json({
      projectName,
      category: qr.category,
      requiresLogin: qr.requiresLogin,
      documents: filteredDocs.map(d => ({
        id: d.id,
        projectId: d.projectId,
        uploadedBy: d.uploadedBy,
        uploaderName: "Unknown",
        name: d.name,
        type: d.type,
        version: d.version,
        fileUrl: d.fileUrl,
        fileSize: d.fileSize,
        previousVersionId: d.previousVersionId ?? null,
        status: d.status,
        requiresAcknowledgment: d.requiresAcknowledgment,
        publicAccess: d.publicAccess,
        createdAt: d.createdAt.toISOString(),
        distributionSummary: { total: 0, pending: 0, viewed: 0, acknowledged: 0 },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "QR content error");
    res.status(500).json({ error: "server_error", message: "Failed to get QR content" });
  }
});

export default router;
