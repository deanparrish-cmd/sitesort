import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Users, FileText, Upload, Pencil, ShieldCheck, Eye, Camera,
  ClipboardCheck, ClipboardList, Mic, Square, PencilLine, Plus,
} from "lucide-react";

// Shared by the Daily Reports hub (/daily-reports) and the project-detail
// "Daily Reports" tab: renders the immutable auto snapshot plus the editable
// structured "site diary" (with voice-to-text on the free-text fields).

export type ManagerReport = {
  weather?: string;
  labourOnSite?: string;
  plantEquipment?: string;
  workCompleted?: string;
  delaysIssues?: string;
  deliveries?: string;
  hsNotes?: string;
};

export type DailyReportData = {
  subcontractorsOnSite: { id: string; workerName: string; checkedInAt: string; photoUrl: string | null }[];
  documentActivity: {
    uploaded: { documentId: string; name: string; type: string; version: number; uploaderName: string; at: string }[];
    amended: { documentId: string; name: string; type: string; version: number; uploaderName: string; at: string }[];
    viewed: { documentId: string; documentName: string; userName: string; at: string }[];
    signedOff: { documentId: string; documentName: string; documentVersion: number; userName: string; userRole: string; signedOffWithPin: boolean; at: string }[];
  };
  sitePhotos: { id: string; referenceNumber: string; category: string; description: string | null; zone: string | null; uploaderName: string; photoUrl: string | null; takenAt: string }[];
  siteManagerNotes: { id: string; authorName: string; body: string; source: string; at: string }[];
};

export type DailyReportDetailData = {
  id: string;
  projectId: string;
  projectName: string;
  reportDate: string;
  generatedAt: string;
  checkinCount: number;
  documentEventCount: number;
  photoCount: number;
  data: DailyReportData;
  managerReport?: ManagerReport | null;
  authorName?: string | null;
  authoredAt?: string | null;
};

type DiaryFieldKey = keyof ManagerReport;
const DIARY_FIELDS: { key: DiaryFieldKey; label: string; multiline: boolean; placeholder: string }[] = [
  { key: "weather", label: "Weather", multiline: false, placeholder: "e.g. Dry, 16°C, light wind" },
  { key: "labourOnSite", label: "Labour on site", multiline: false, placeholder: "e.g. 8 (3 trades)" },
  { key: "plantEquipment", label: "Plant / equipment", multiline: false, placeholder: "e.g. Excavator, 2× dumper" },
  { key: "workCompleted", label: "Work completed", multiline: true, placeholder: "What was done on site today…" },
  { key: "delaysIssues", label: "Delays / issues", multiline: true, placeholder: "Anything holding up progress…" },
  { key: "deliveries", label: "Deliveries", multiline: true, placeholder: "Materials or plant delivered…" },
  { key: "hsNotes", label: "Health & safety / notes", multiline: true, placeholder: "Toolbox talks, incidents, observations…" },
];

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function hasManagerContent(mr: ManagerReport | null | undefined): boolean {
  return !!mr && DIARY_FIELDS.some((f) => (mr[f.key] ?? "").toString().trim().length > 0);
}

// Web Speech API dictation. Renders nothing when the browser has no support
// (e.g. Firefox), so the field stays usable by typing.
function DictationButton({ onTranscript }: { onTranscript: (text: string) => void }) {
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

export function DailyReportDetail({
  report,
  canEdit,
  onSaved,
  initialEditing = false,
}: {
  report: DailyReportDetailData;
  canEdit: boolean;
  onSaved?: (managerReport: ManagerReport | null) => void;
  initialEditing?: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(initialEditing);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ManagerReport>(report.managerReport ?? {});

  // Reset when a different report is shown (or edit mode is (re)requested).
  useEffect(() => {
    setForm(report.managerReport ?? {});
    setEditing(initialEditing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id, report.projectId, report.reportDate]);

  const setField = (key: DiaryFieldKey, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const appendField = (key: DiaryFieldKey, text: string) =>
    setForm((f) => ({ ...f, [key]: (f[key]?.trim() ? f[key]!.trimEnd() + " " : "") + text }));

  const save = async () => {
    const body: Record<string, string> = {};
    for (const f of DIARY_FIELDS) {
      const v = (form[f.key] ?? "").trim();
      if (v) body[f.key] = v;
    }
    setSaving(true);
    const res = await fetch(`/api/projects/${report.projectId}/daily-reports/${report.reportDate}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const msg = res.status === 400 ? "Enter at least one field" : "Couldn't save site diary";
      toast({ title: msg, variant: "destructive" });
      return;
    }
    const data = await res.json().catch(() => ({}));
    toast({ title: "Site diary saved" });
    setEditing(false);
    onSaved?.(data?.managerReport ?? null);
  };

  const raw = report.data;
  const d: DailyReportData = {
    subcontractorsOnSite: raw?.subcontractorsOnSite ?? [],
    documentActivity: {
      uploaded: raw?.documentActivity?.uploaded ?? [],
      amended: raw?.documentActivity?.amended ?? [],
      viewed: raw?.documentActivity?.viewed ?? [],
      signedOff: raw?.documentActivity?.signedOff ?? [],
    },
    sitePhotos: raw?.sitePhotos ?? [],
    siteManagerNotes: raw?.siteManagerNotes ?? [],
  };
  const REPORT_CATEGORY_LABELS: Record<string, string> = {
    general: "General", progress: "Progress", snag: "Snag", safety_concern: "Safety Concern",
    mistake: "Mistake", work_completed: "Work completed",
  };
  const totalEvents = report.checkinCount + report.documentEventCount + report.photoCount;
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const diaryPresent = hasManagerContent(report.managerReport);

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      {report.projectName && (
        <p className="text-xs text-muted-foreground">
          {report.projectName}{report.generatedAt ? ` · generated ${formatDate(report.generatedAt)}` : ""}
        </p>
      )}

      {/* Site diary — editable structured report */}
      <div className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h4 className="flex items-center gap-2 font-semibold text-sm">
            <ClipboardList className="w-4 h-4 text-primary" />Site diary
          </h4>
          {canEdit && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {diaryPresent ? <><PencilLine className="w-3.5 h-3.5 mr-1.5" />Edit</> : <><Plus className="w-3.5 h-3.5 mr-1.5" />Add site diary</>}
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            {DIARY_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">{f.label}</label>
                <div className="flex items-start gap-2">
                  {f.multiline ? (
                    <Textarea
                      value={form[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      rows={2}
                      className="flex-1"
                    />
                  ) : (
                    <Input
                      value={form[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="flex-1"
                    />
                  )}
                  {f.multiline && <DictationButton onTranscript={(t) => appendField(f.key, t)} />}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => { setForm(report.managerReport ?? {}); setEditing(false); }} disabled={saving}>Cancel</Button>
              <Button variant="accent" size="sm" onClick={save} isLoading={saving}>Save site diary</Button>
            </div>
          </div>
        ) : diaryPresent ? (
          <div className="space-y-3">
            {DIARY_FIELDS.filter((f) => (report.managerReport?.[f.key] ?? "").trim()).map((f) => (
              <div key={f.key}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{f.label}</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{report.managerReport?.[f.key]}</p>
              </div>
            ))}
            {(report.authorName || report.authoredAt) && (
              <p className="text-[11px] text-muted-foreground pt-1">
                {report.authorName ? `Authored by ${report.authorName}` : "Authored"}{report.authoredAt ? ` · ${formatDate(report.authoredAt)}` : ""}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No site diary has been written for this day{canEdit ? " yet." : "."}</p>
        )}
      </div>

      {totalEvents === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No automatic site activity was recorded on this day.</CardContent></Card>
      )}

      {d.subcontractorsOnSite.length > 0 && (
        <div>
          <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><Users className="w-4 h-4 text-primary" />Contacts on site ({d.subcontractorsOnSite.length})</h4>
          <div className="space-y-1.5">
            {d.subcontractorsOnSite.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                <span className="font-medium">{c.workerName}</span>
                <span className="text-xs text-muted-foreground">checked in {time(c.checkedInAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.documentEventCount > 0 && (
        <div>
          <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><FileText className="w-4 h-4 text-primary" />Document activity ({report.documentEventCount})</h4>
          <div className="space-y-1.5">
            {d.documentActivity.uploaded.map((e) => (
              <div key={`u-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                <Upload className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.name}</span> uploaded by {e.uploaderName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
              </div>
            ))}
            {d.documentActivity.amended.map((e) => (
              <div key={`a-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                <Pencil className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.name}</span> amended (v{e.version}) by {e.uploaderName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
              </div>
            ))}
            {d.documentActivity.signedOff.map((e) => (
              <div key={`s-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.documentName}</span> signed off by {e.userName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
              </div>
            ))}
            {d.documentActivity.viewed.map((e) => (
              <div key={`v-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.documentName}</span> viewed by {e.userName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.sitePhotos.length > 0 && (
        <div>
          <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><Camera className="w-4 h-4 text-primary" />Site photos ({d.sitePhotos.length})</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {d.sitePhotos.map((p) => {
              const photoUrl = p.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
              return (
                <div key={p.id} className="rounded-lg border overflow-hidden">
                  {photoUrl ? (
                    <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                      <img src={photoUrl} alt={p.description ?? p.category} className="w-full h-28 object-cover" />
                    </a>
                  ) : (
                    <div className="w-full h-28 bg-muted flex items-center justify-center"><Camera className="w-6 h-6 text-muted-foreground" /></div>
                  )}
                  <div className="p-2 space-y-1">
                    <span className="text-[10px] font-bold">{REPORT_CATEGORY_LABELS[p.category] ?? p.category}</span>
                    {p.description && <p className="text-[11px] text-foreground line-clamp-2">{p.description}</p>}
                    <p className="text-[10px] text-muted-foreground">{time(p.takenAt)} · {p.uploaderName}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {d.siteManagerNotes.length > 0 && (
        <div>
          <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><ClipboardCheck className="w-4 h-4 text-primary" />Site updates ({d.siteManagerNotes.length})</h4>
          <div className="space-y-2">
            {d.siteManagerNotes.map((n) => (
              <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-[13px] text-foreground whitespace-pre-wrap">{n.body}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{time(n.at)} · {n.authorName}{n.source === "voice" ? " · spoken" : ""}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
