import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { documentsTable, projectsTable } from "@workspace/db/schema";
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

router.post(
  "/projects/:projectId/voice-recall",
  authenticate,
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "validation_error", message: "No audio file provided" });
        return;
      }

      const openai = getOpenAI();

      // 1. Transcribe audio with Whisper
      const audioBuffer = req.file.buffer;
      const transcription = await openai.audio.transcriptions.create({
        model: TRANSCRIBE_MODEL,
        file: new File([audioBuffer], audioFilename(req.file.mimetype), { type: req.file.mimetype || "audio/webm" }),
        language: "en",
      });

      const transcript = transcription.text.trim();
      if (!transcript) {
        res.json({ transcript: "", results: [], summary: "No speech detected. Please try again." });
        return;
      }

      // 2. Load all documents for this project (verify project ownership first)
      const project = await db.select({ id: projectsTable.id }).from(projectsTable)
        .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
        .limit(1);
      if (!project[0]) {
        res.status(404).json({ error: "not_found", message: "Project not found" });
        return;
      }

      const allDocs = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.projectId, req.params.projectId));

      const docList = allDocs.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        version: d.version,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
      }));

      // 3. Ask GPT-4o to interpret the query and identify matching documents
      const systemPrompt = `You are a construction document assistant. 
Given a voice query from a site manager and a list of project documents, identify which documents the user is asking about and provide a helpful summary.

Document types: drawing, method_statement, permit, safety, general.
Document status: current (latest version), superseded (older version).

Respond ONLY with valid JSON in this exact format:
{
  "matchedDocumentIds": ["id1", "id2"],
  "summary": "A brief, clear explanation of what was found (1-2 sentences)",
  "intent": "What the user was trying to find"
}

If no documents match, return an empty matchedDocumentIds array and explain in summary.`;

      const userMessage = `Voice query: "${transcript}"

Available documents:
${JSON.stringify(docList, null, 2)}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: { matchedDocumentIds?: string[]; summary?: string; intent?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { matchedDocumentIds: [], summary: "Could not parse AI response.", intent: transcript };
      }

      const matchedIds = new Set(parsed.matchedDocumentIds ?? []);
      const results = allDocs
        .filter(d => matchedIds.has(d.id))
        .map(d => ({
          id: d.id,
          name: d.name,
          type: d.type,
          version: d.version,
          status: d.status,
          fileUrl: d.fileUrl,
          createdAt: d.createdAt.toISOString(),
        }));

      res.json({
        transcript,
        intent: parsed.intent ?? transcript,
        summary: parsed.summary ?? "Documents found.",
        results,
      });
    } catch (err: any) {
      req.log.error({ err }, "Voice recall error");
      res.status(500).json({ error: "server_error", message: err?.message ?? "Voice recall failed" });
    }
  }
);

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
        file: new File([audioBuffer], audioFilename(req.file.mimetype), { type: req.file.mimetype || "audio/webm" }),
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
