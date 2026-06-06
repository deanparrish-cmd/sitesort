// Pick a recording MIME type the current browser actually supports.
// iOS Safari does NOT support audio/webm in MediaRecorder (it uses audio/mp4),
// so hardcoding "audio/webm" throws there. We probe candidates in order and
// return undefined to let the browser choose its own default if none match.
export function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

// File extension that matches a recorded blob's MIME type, so the server (and
// OpenAI) can detect the audio format correctly.
export function audioExtension(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "mp4";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  return "webm";
}
