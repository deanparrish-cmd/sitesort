import { useState, useRef, useEffect } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// Web Speech API dictation. Renders nothing when the browser has no support
// (e.g. Firefox, or iOS Safari in some contexts) — the field stays usable by
// typing, never a broken mic button. en-GB. Shared by the dashboard Daily
// Report form and the portal (Daily Report, site-issue description, plant
// notes) — one implementation, no drift.
export function DictationButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const SR = typeof window !== "undefined"
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  if (!SR) return null;

  const toggle = () => {
    if (listening) { try { recRef.current?.stop(); } catch { /* noop */ } return; }
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final.trim()) onTranscript(final.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? "Stop dictation" : "Dictate"}
      aria-pressed={listening}
      className={cn(
        "shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border transition-colors",
        listening
          ? "bg-red-50 border-red-300 text-red-600 animate-pulse dark:bg-red-950/30"
          : "bg-background border-border text-muted-foreground hover:text-primary hover:border-primary/40",
      )}
    >
      {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}
