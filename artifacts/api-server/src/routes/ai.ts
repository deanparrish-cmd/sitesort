import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function getOpenAI() {
  // Prefer the Replit AI Integrations proxy (no user-provided key needed); fall
  // back to a direct OPENAI_API_KEY if one is configured.
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const integrationKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (baseURL && integrationKey) {
    return new OpenAI({ baseURL, apiKey: integrationKey });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Whisper isn't available via the integration proxy; gpt-4o-mini-transcribe is,
// and it also works with a direct OpenAI key.
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

// Map a recorded audio MIME type to a filename OpenAI can detect the format from.
function audioFilename(mimetype: string | undefined): string {
  const t = (mimetype ?? "").toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.mp4";
  if (t.includes("ogg")) return "audio.ogg";
  if (t.includes("wav")) return "audio.wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  return "audio.webm";
}

// Plain speech-to-text: transcribe a short audio clip and return the text.
// Used by the dictation buttons (photo descriptions, the spoken daily report).
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

      const openai = getOpenAI();
      const audioBuffer = req.file.buffer;
      const transcription = await openai.audio.transcriptions.create({
        model: TRANSCRIBE_MODEL,
        file: new File([new Uint8Array(audioBuffer)], audioFilename(req.file.mimetype), { type: req.file.mimetype || "audio/webm" }),
        language: "en",
      });

      res.json({ transcript: transcription.text.trim() });
    } catch (err: any) {
      req.log.error({ err }, "Transcription error");
      res.status(500).json({ error: "server_error", message: err?.message ?? "Transcription failed" });
    }
  },
);

export default router;
