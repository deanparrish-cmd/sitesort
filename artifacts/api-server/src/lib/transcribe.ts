import OpenAI from "openai";

// Shared speech-to-text used by the dashboard (/projects/:id/transcribe) and
// portal (/portal/transcribe) dictation endpoints.
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
export function audioFilename(mimetype: string | undefined): string {
  const t = (mimetype ?? "").toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.mp4";
  if (t.includes("ogg")) return "audio.ogg";
  if (t.includes("wav")) return "audio.wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  return "audio.webm";
}

export async function transcribeAudio(buffer: Buffer, mimetype: string | undefined): Promise<string> {
  const openai = getOpenAI();
  const transcription = await openai.audio.transcriptions.create({
    model: TRANSCRIBE_MODEL,
    file: new File([new Uint8Array(buffer)], audioFilename(mimetype), { type: mimetype || "audio/webm" }),
    language: "en",
  });
  return transcription.text.trim();
}
