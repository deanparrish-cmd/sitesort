import { useState, useRef, useCallback } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceDictationProps {
  projectId: string;
  // Called with the transcribed text once recording is processed.
  onTranscript: (text: string) => void;
  // Optional label shown next to the mic in the idle state.
  label?: string;
  className?: string;
  // Max recording length in seconds before auto-stop.
  maxSeconds?: number;
}

type State = "idle" | "recording" | "processing";

export function VoiceDictation({
  projectId,
  onTranscript,
  label = "Dictate",
  className,
  maxSeconds = 120,
}: VoiceDictationProps) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendAudio = useCallback(
    async (blob: Blob) => {
      try {
        const formData = new FormData();
        formData.append("audio", blob, "recording.webm");
        // Auth token injected automatically by the fetch interceptor in api-setup.ts
        const res = await fetch(`/api/projects/${projectId}/transcribe`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message ?? "Transcription failed");
        }
        const data: { transcript: string } = await res.json();
        const text = (data.transcript ?? "").trim();
        if (text) onTranscript(text);
        else setError("No speech detected. Please try again.");
      } catch (err: any) {
        setError(err?.message ?? "Could not transcribe. Please try again.");
      } finally {
        setState("idle");
        setSeconds(0);
      }
    },
    [projectId, onTranscript],
  );

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setState("processing");
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendAudio(blob);
      };

      recorder.start(250);
      setState("recording");

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= maxSeconds - 1) {
            stopRecording();
            return maxSeconds;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access denied. Please allow access and try again.");
    }
  }, [maxSeconds, sendAudio, stopRecording]);

  return (
    <div className={cn("inline-flex flex-col items-start gap-1", className)}>
      <Button
        type="button"
        variant={state === "recording" ? "destructive" : "outline"}
        size="sm"
        onClick={state === "idle" ? startRecording : state === "recording" ? stopRecording : undefined}
        disabled={state === "processing"}
        className="gap-1.5"
      >
        {state === "processing" ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Transcribing…
          </>
        ) : state === "recording" ? (
          <>
            <Square className="w-3.5 h-3.5 fill-current" /> Stop · {seconds}s
          </>
        ) : (
          <>
            <Mic className="w-3.5 h-3.5" /> {label}
          </>
        )}
      </Button>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
