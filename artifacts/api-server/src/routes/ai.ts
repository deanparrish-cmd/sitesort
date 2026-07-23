import { Router, type IRouter } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { transcribeAudio } from "../lib/transcribe";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Plain speech-to-text: transcribe a short audio clip and return the text.
// Used by the dashboard dictation buttons (the portal has its own twin at
// POST /api/portal/transcribe, gated on a portal session instead).
router.post(
  "/projects/:projectId/transcribe",
  authenticate,
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "validation_error", message: "No audio file provided" });
        return;
      }

      // Verify the caller has access to this project (tenant scoping).
      const project = await db.select({ id: projectsTable.id }).from(projectsTable)
        .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
        .limit(1);
      if (!project[0]) {
        res.status(404).json({ error: "not_found", message: "Project not found" });
        return;
      }

      const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
      res.json({ transcript });
    } catch (err: any) {
      req.log.error({ err }, "Transcription error");
      res.status(500).json({ error: "server_error", message: err?.message ?? "Transcription failed" });
    }
  },
);

export default router;
