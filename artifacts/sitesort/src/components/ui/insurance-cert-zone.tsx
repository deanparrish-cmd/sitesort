import { useState, useRef, useCallback, useEffect } from "react";
import { ShieldCheck, Upload, Loader2, AlertTriangle, ExternalLink, X, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InsuranceCertZoneProps {
  memberId: string;
  projectId: string;
  existingCertUrl?: string | null;
  existingExpiryDate?: string | null;
  onSaved: () => void;
}

export function InsuranceCertZone({ memberId, projectId, existingCertUrl, existingExpiryDate, onSaved }: InsuranceCertZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState(existingExpiryDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Upload failed"); }
      const data = await res.json();
      setUploadedUrl(data.url);
      setUploadedName(file.name);
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  // Paste anywhere on the zone when it has focus
  const onPaste = useCallback((e: ClipboardEvent) => {
    const file = e.clipboardData?.files[0];
    if (file) { e.preventDefault(); uploadFile(file); }
  }, [uploadFile]);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    zone.addEventListener("paste", onPaste);
    return () => zone.removeEventListener("paste", onPaste);
  }, [onPaste]);

  const save = async () => {
    if (!uploadedUrl && !existingCertUrl) { setError("Please upload a certificate first."); return; }
    if (!expiryDate) { setError("Please enter an expiry date."); return; }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}/insurance-cert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ certificateUrl: uploadedUrl ?? existingCertUrl, expiryDate }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Save failed"); }
      setUploadedUrl(null);
      setUploadedName(null);
      setExpanded(false);
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const hasCert = !!(uploadedUrl || existingCertUrl);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors",
          hasCert
            ? "bg-success/5 border-success/30 text-success hover:bg-success/10"
            : "bg-muted/30 border-dashed border-input text-muted-foreground hover:border-primary/40 hover:text-primary"
        )}
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        {hasCert ? (
          <span className="flex-1 text-left truncate">PLI Certificate {existingExpiryDate ? `· expires ${existingExpiryDate}` : ""}</span>
        ) : (
          <span className="flex-1 text-left">Add PLI Certificate</span>
        )}
        {hasCert && existingCertUrl && (
          <a href={existingCertUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="hover:text-primary">
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </button>
    );
  }

  return (
    <div className="border rounded-xl p-4 bg-muted/10 space-y-3" ref={zoneRef} tabIndex={0}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Public Liability Insurance
        </p>
        <button onClick={() => setExpanded(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Drop / paste zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={cn(
          "flex items-center gap-3 p-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors text-sm",
          isDragging ? "border-primary bg-primary/5" : "border-input hover:border-primary/40 hover:bg-muted/20",
          uploading && "opacity-60 cursor-not-allowed"
        )}
      >
        {uploading ? (
          <><Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" /><span className="text-muted-foreground">Uploading…</span></>
        ) : uploadedUrl ? (
          <><ShieldCheck className="w-4 h-4 text-success shrink-0" /><span className="flex-1 truncate text-success font-medium">{uploadedName}</span><button onClick={e => { e.stopPropagation(); setUploadedUrl(null); setUploadedName(null); }} className="text-muted-foreground hover:text-destructive ml-auto"><X className="w-3.5 h-3.5" /></button></>
        ) : existingCertUrl && !uploadedUrl ? (
          <><ShieldCheck className="w-4 h-4 text-success shrink-0" /><span className="flex-1 text-success font-medium">Certificate on file</span><a href={existingCertUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground hover:text-primary ml-auto"><ExternalLink className="w-3.5 h-3.5" /></a></>
        ) : (
          <><Upload className="w-4 h-4 text-muted-foreground shrink-0" /><span className="text-muted-foreground">Drop, paste or <span className="text-primary underline">browse</span></span></>
        )}
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
      </div>

      <div>
        <label className="text-xs font-semibold mb-1 block text-muted-foreground">Expiry Date</label>
        <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} icon={<Calendar className="w-3.5 h-3.5" />} className="h-9 text-sm" />
      </div>

      {error && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</p>}

      <Button size="sm" variant="accent" className="w-full" onClick={save} isLoading={saving}>Save Certificate</Button>
    </div>
  );
}
