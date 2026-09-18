import { useCallback, useEffect, useState } from "react";
import { Camera, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { useToast } from "@/hooks/use-toast";

type ReportPhoto = { id: string; referenceNumber: string; photoUrl: string | null; caption: string | null; takenAt: string; uploaderName: string };
type Staged = { key: string; url: string; caption: string };

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}
const src = (u: string | null) => u?.replace(/^\/uploads\//, "/api/uploads/") ?? null;

/**
 * Photos added directly inside a daily site report. Uses the shared
 * FileDropZone (multi-file mode), so one upload serves the report and the
 * project photo library (the server tags each photo with the report date).
 */
export function DailyReportPhotos({ projectId, reportDate, canEdit }: { projectId: string; reportDate: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const base = `/api/projects/${projectId}/daily-reports/${reportDate}/photos`;

  const load = useCallback(() => {
    fetch(base, { headers: authHeaders() }).then(r => r.ok ? r.json() : []).then(setPhotos).catch(() => {});
  }, [base]);
  useEffect(() => { setStaged([]); setAdding(false); load(); }, [load]);

  const save = async () => {
    if (staged.length === 0) return;
    setSaving(true);
    const res = await fetch(base, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ photos: staged.map(s => ({ photoUrl: s.url, caption: s.caption })) }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) { toast({ title: "Couldn't save photos", variant: "destructive" }); return; }
    setPhotos(await res.json());
    toast({ title: `${staged.length} photo${staged.length === 1 ? "" : "s"} added`, description: "Also in the project photo library." });
    setStaged([]);
    setAdding(false);
  };

  if (!canEdit && photos.length === 0) return null;

  return (
    <div data-testid="section-report-photos">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h4 className="flex items-center gap-2 font-semibold text-sm"><Camera className="w-4 h-4 text-primary" />Report photos ({photos.length})</h4>
        {canEdit && !adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="button-add-report-photos">
            <Camera className="w-3.5 h-3.5 mr-1.5" />Add Photos
          </Button>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border p-3 mb-3 space-y-3">
          <FileDropZone
            multiple
            accept=".jpg,.jpeg,.png,.webp"
            onUploaded={f => setStaged(prev => [...prev, { key: `${f.url}-${prev.length}`, url: f.url, caption: "" }])}
            onCleared={() => {}}
          />
          {staged.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {staged.map(s => (
                <div key={s.key} className="flex gap-2 items-start">
                  <img src={src(s.url) ?? ""} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0 border" />
                  <Input
                    value={s.caption}
                    onChange={e => setStaged(prev => prev.map(x => x.key === s.key ? { ...x, caption: e.target.value } : x))}
                    placeholder="Caption (optional)"
                    maxLength={300}
                  />
                  <button type="button" onClick={() => setStaged(prev => prev.filter(x => x.key !== s.key))} className="p-2 text-muted-foreground hover:text-destructive shrink-0" aria-label="Remove photo">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setAdding(false); setStaged([]); }} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || staged.length === 0} data-testid="button-save-report-photos">
              {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : `Save ${staged.length || ""} photo${staged.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(p => (
            <div key={p.id} className="rounded-lg border overflow-hidden">
              {p.photoUrl && (
                <a href={src(p.photoUrl)!} target="_blank" rel="noopener noreferrer">
                  <img src={src(p.photoUrl)!} alt={p.caption ?? "Site photo"} className="w-full h-28 object-cover" />
                </a>
              )}
              <div className="p-2 space-y-0.5">
                {p.caption && <p className="text-[11px] text-foreground break-words">{p.caption}</p>}
                <p className="text-[10px] text-muted-foreground">{new Date(p.takenAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {p.uploaderName}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
