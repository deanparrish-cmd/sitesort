import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { pickAudioMimeType } from "@/lib/audio";

// Dictation via MediaRecorder + server-side transcription. The old Web Speech
// API approach silently failed on iOS home-screen web apps (SpeechRecognition
// errors with "service-not-allowed" in standalone PWAs) and doesn't exist in
// Firefox — exactly the contexts the portal is used in. MediaRecorder works
// everywhere, and the audio is transcribed by POST {transcribeUrl} (multipart
// "audio" field → { transcript }). The global fetch interceptor attaches the
// right auth token (dashboard or portal). Shared by the dashboard Daily
// Report form and the portal — one implementation, no drift.
export function DictationButton({ onTranscript, transcribeUrl }: { onTranscript: (text: string) => void; transcribeUrl: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(() => () => {
    cancelledRef.current = true;
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current?.stream.getTracks().forEach(t => t.stop());
  }, []);

  if (!supported) return null;

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({ title: "Microphone blocked", description: "Allow microphone access for this site in your browser settings, then try again.", variant: "destructive" });
      return;
    }
    const mimeType = pickAudioMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach(t => t.stop());
      toast({ title: "Couldn't start recording", variant: "destructive" });
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (cancelledRef.current) return;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
      chunksRef.current = [];
      if (blob.size === 0) { setState("idle"); return; }
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, "dictation");
        const res = await fetch(transcribeUrl, { method: "POST", body: form });
        if (!res.ok) throw new Error();
        const data = await res.json() as { transcript?: string };
        const text = (data.transcript ?? "").trim();
        if (text) onTranscript(text);
        else toast({ title: "Nothing heard", description: "Try again, speaking a little closer to the phone." });
      } catch {
        toast({ title: "Couldn't transcribe", description: "Check your connection and try again.", variant: "destructive" });
      } finally {
        if (!cancelledRef.current) setState("idle");
      }
    };
    recRef.current = rec;
    rec.start();
    setState("recording");
  };

  const toggle = () => {
    if (state === "transcribing") return;
    if (state === "recording") { try { recRef.current?.stop(); } catch { setState("idle"); } return; }
    void start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={state === "transcribing"}
      title={state === "recording" ? "Stop dictation" : state === "transcribing" ? "Transcribing…" : "Dictate"}
      aria-pressed={state === "recording"}
      className={cn(
        "shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border transition-colors",
        state === "recording"
          ? "bg-red-50 border-red-300 text-red-600 animate-pulse dark:bg-red-950/30"
          : state === "transcribing"
            ? "bg-background border-border text-muted-foreground"
            : "bg-background border-border text-muted-foreground hover:text-primary hover:border-primary/40",
      )}
    >
      {state === "recording" ? <Square className="w-4 h-4" /> : state === "transcribing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}
