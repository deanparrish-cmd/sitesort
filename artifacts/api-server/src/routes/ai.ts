import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
        model: "whisper-1",
        file: new File([audioBuffer], "audio.webm", { type: req.file.mimetype || "audio/webm" }),
        language: "en",
      });

      const transcript = transcription.text.trim();
      if (!transcript) {
        res.json({ transcript: "", results: [], summary: "No speech detected. Please try again." });
        return;
      }

      // 2. Load all documents for this project
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

export default router;
