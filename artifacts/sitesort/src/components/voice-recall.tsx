import { useState, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, FileText, AlertTriangle, CheckCircle2, Sparkles, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";
import { pickAudioMimeType, audioExtension } from "@/lib/audio";

interface RecallResult {
  id: string;
  name: string;
  type: string;
  version: number;
  status: string;
  fileUrl: string;
  createdAt: string;
}

interface VoiceRecallResponse {
  transcript: string;
  intent: string;
  summary: string;
  results: RecallResult[];
}

interface VoiceRecallProps {
  projectId: string;
  documents?: RecallResult[];
}

type RecordingState = "idle" | "recording" | "processing";
type InputMode = "voice" | "text";

export function VoiceRecall({ projectId, documents = [] }: VoiceRecallProps) {
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [response, setResponse] = useState<VoiceRecallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [textQuery, setTextQuery] = useState("");
  const [textResults, setTextResults] = useState<RecallResult[] | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    setResponse(null);
    setSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const type = mediaRecorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        await sendAudio(blob);
      };

      mediaRecorder.start(250);
      setRecordingState("recording");

      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (s >= 29) {
            stopRecording();
            return 30;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: any) {
      setError("Microphone access denied. Please allow microphone access and try again.");
    }
  }, [projectId]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setRecordingState("processing");
  }, []);

  const sendAudio = async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", blob, `recording.${audioExtension(blob.type)}`);

      // Auth token injected automatically by the fetch interceptor in api-setup.ts
      const res = await fetch(`/api/projects/${projectId}/voice-recall`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Voice recall failed");
      }

      const data: VoiceRecallResponse = await res.json();
      setResponse(data);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setRecordingState("idle");
    }
  };

  const reset = () => {
    setResponse(null);
    setError(null);
    setSeconds(0);
    setTextQuery("");
    setTextResults(null);
  };

  const handleTextSearch = (query: string) => {
    setTextQuery(query);
    if (!query.trim()) { setTextResults(null); return; }
    const q = query.toLowerCase();
    const matches = documents.filter(d => d.name.toLowerCase().includes(q));
    setTextResults(matches);
  };

  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-base">AI Document Recall</h3>
            <p className="text-xs text-muted-foreground">Find any document by name or voice</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden text-xs font-semibold">
            <button
              onClick={() => { setInputMode("text"); reset(); }}
              className={cn("px-3 py-1.5 flex items-center gap-1 transition-colors", inputMode === "text" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted")}
            >
              <Search className="w-3 h-3" /> Text
            </button>
            <button
              onClick={() => { setInputMode("voice"); reset(); }}
              className={cn("px-3 py-1.5 flex items-center gap-1 transition-colors", inputMode === "voice" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted")}
            >
              <Mic className="w-3 h-3" /> Voice
            </button>
          </div>
          {(response || textResults !== null) && (
            <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-6">
        {/* Text search mode */}
        {inputMode === "text" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={textQuery}
                onChange={e => handleTextSearch(e.target.value)}
                placeholder="Type a document name…"
                className="pl-9"
                autoFocus
              />
            </div>
            {textResults !== null && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {textResults.length} document{textResults.length !== 1 ? "s" : ""} found
                </p>
                {textResults.length > 0 ? textResults.map(doc => {
                  const isSuperseded = doc.status === "superseded";
                  return (
                    <a
                      key={doc.id}
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-4 p-4 rounded-xl border transition-colors group",
                        isSuperseded ? "bg-muted/30 opacity-70 hover:bg-muted/50" : "bg-background hover:bg-primary/5 hover:border-primary/30"
                      )}
                    >
                      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", isSuperseded ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-bold text-sm truncate", isSuperseded && "line-through text-muted-foreground")}>{doc.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{doc.type.replace("_", " ")} · {formatDate(doc.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">v{doc.version}</span>
                        {isSuperseded ? (
                          <Badge variant="destructive" className="text-[10px]">SUPERSEDED</Badge>
                        ) : (
                          <Badge variant="success" className="text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" /> CURRENT</Badge>
                        )}
                      </div>
                    </a>
                  );
                }) : (
                  <div className="text-center py-4 text-muted-foreground text-sm">No documents match "{textQuery}".</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mic Button + Recording State */}
        {inputMode === "voice" && !response && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <button
                onClick={recordingState === "idle" ? startRecording : recordingState === "recording" ? stopRecording : undefined}
                disabled={recordingState === "processing"}
                className={cn(
                  "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg focus:outline-none focus:ring-4 focus:ring-primary/30",
                  recordingState === "idle" && "bg-primary hover:bg-primary/90 hover:scale-105 cursor-pointer",
                  recordingState === "recording" && "bg-destructive animate-pulse cursor-pointer",
                  recordingState === "processing" && "bg-muted cursor-not-allowed"
                )}
              >
                {recordingState === "processing" ? (
                  <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                ) : recordingState === "recording" ? (
                  <MicOff className="w-8 h-8 text-white" />
                ) : (
                  <Mic className="w-8 h-8 text-white" />
                )}
              </button>
              {recordingState === "recording" && (
                <span className="absolute -top-1 -right-1 bg-destructive text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
                  {seconds}s
                </span>
              )}
            </div>

            <div className="text-center">
              {recordingState === "idle" && (
                <>
                  <p className="font-semibold text-foreground">Tap to start speaking</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Try: <em>"Show me the latest floor plan"</em> or <em>"Find all safety documents"</em>
                  </p>
                </>
              )}
              {recordingState === "recording" && (
                <>
                  <p className="font-semibold text-destructive">Listening… tap to stop</p>
                  <p className="text-sm text-muted-foreground mt-1">Max 30 seconds</p>
                </>
              )}
              {recordingState === "processing" && (
                <>
                  <p className="font-semibold text-muted-foreground">Analysing your request…</p>
                  <p className="text-sm text-muted-foreground mt-1">Transcribing and searching documents</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive mt-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Error</p>
              <p className="text-sm">{error}</p>
              <button onClick={reset} className="text-xs underline mt-1">Try again</button>
            </div>
          </div>
        )}

        {/* Results */}
        {response && (
          <div className="space-y-5">
            {/* Transcript bubble */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Mic className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 max-w-sm">
                <p className="text-sm italic text-foreground">"{response.transcript}"</p>
              </div>
            </div>

            {/* AI summary bubble */}
            <div className="flex items-start gap-3 flex-row-reverse">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-primary/8 border border-primary/15 rounded-2xl rounded-tr-sm px-4 py-3 max-w-sm">
                <p className="text-sm text-foreground">{response.summary}</p>
              </div>
            </div>

            {/* Document results */}
            {response.results.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {response.results.length} document{response.results.length !== 1 ? "s" : ""} found
                </p>
                {response.results.map(doc => {
                  const isSuperseded = doc.status === "superseded";
                  return (
                    <a
                      key={doc.id}
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-4 p-4 rounded-xl border transition-colors group",
                        isSuperseded
                          ? "bg-muted/30 opacity-70 hover:bg-muted/50"
                          : "bg-background hover:bg-primary/5 hover:border-primary/30"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                        isSuperseded ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                      )}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-bold text-sm truncate", isSuperseded && "line-through text-muted-foreground")}>
                          {doc.name}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {doc.type.replace("_", " ")} · {formatDate(doc.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">v{doc.version}</span>
                        {isSuperseded ? (
                          <Badge variant="destructive" className="text-[10px]">SUPERSEDED</Badge>
                        ) : (
                          <Badge variant="success" className="text-[10px]">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> CURRENT
                          </Badge>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No matching documents found for this query.
              </div>
            )}

            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-muted hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors text-sm font-medium"
            >
              <Mic className="w-4 h-4" /> Ask another question
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
