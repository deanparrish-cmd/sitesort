import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { MapPin, Calendar, FileText, HardHat, ShieldCheck, AlertTriangle, Users, Mail, Phone, Clock, Camera, CheckCircle2, Loader2, Pin } from "lucide-react";

// Stamps date/time, project name and worker name onto the captured image via canvas
async function stampPhoto(file: File, projectName: string, workerName: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const barH = Math.max(64, img.naturalHeight * 0.12);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, img.naturalHeight - barH, img.naturalWidth, barH);

      const fontSize = Math.max(14, Math.floor(barH * 0.28));
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";

      const pad = Math.floor(barH * 0.12);
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

      ctx.fillText(`${workerName}  ·  ${dateStr} ${timeStr}`, pad, img.naturalHeight - barH + pad);
      ctx.font = `${Math.floor(fontSize * 0.8)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(projectName, pad, img.naturalHeight - barH + pad + fontSize + 4);

      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/jpeg", 0.88);
    };
    img.onerror = reject;
    img.src = url;
  });
}

const TYPE_LABELS: Record<string, string> = {
  drawing: "Drawing",
  method_statement: "Method Statement / RAMS",
  permit: "Permit",
  safety: "Safety Document",
  general: "General",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: "Active", color: "bg-green-100 text-green-800" },
    on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-800" },
    complete: { label: "Complete", color: "bg-blue-100 text-blue-800" },
  };
  const s = map[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${s.color}`}>
      {s.label}
    </span>
  );
}

function CheckInCard({ token, projectName }: { token: string; projectName: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "capturing" | "uploading" | "done" | "error">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturedFile(file);
    setPreview(URL.createObjectURL(file));
    setStatus("capturing");
  };

  const handleCheckin = async () => {
    if (!name.trim()) { setErrorMsg("Please enter your name first."); return; }
    if (!capturedFile) { fileRef.current?.click(); return; }

    setStatus("uploading");
    setErrorMsg("");
    try {
      let lat: number | null = null, lng: number | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* GPS optional */ }

      const stamped = await stampPhoto(capturedFile, projectName, name.trim());
      const fd = new FormData();
      fd.append("photo", stamped, "checkin.jpg");
      fd.append("workerName", name.trim());
      if (lat !== null) fd.append("lat", String(lat));
      if (lng !== null) fd.append("lng", String(lng));

      const res = await fetch(`/api/site/${token}/checkin`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      setStatus("done");
    } catch (err) {
      setErrorMsg("Check-in failed. Please try again.");
      setStatus("capturing");
    }
  };

  const reset = () => {
    setStatus("idle");
    setName("");
    setPreview(null);
    setCapturedFile(null);
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  if (status === "done") {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-6 text-center">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-gray-900">Checked In!</h3>
        <p className="text-gray-500 text-sm mt-1">Your attendance has been recorded at {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</p>
        <button onClick={reset} className="mt-4 text-sm text-orange-600 font-medium hover:underline">Check in again</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-5 py-4 flex items-center gap-3">
        <Camera className="w-5 h-5 text-white" />
        <h2 className="text-white font-bold text-base">Site Check-In</h2>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. John Smith"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {preview && (
          <div className="relative rounded-xl overflow-hidden border">
            <img src={preview} alt="Check-in photo" className="w-full object-cover max-h-48" />
            <button
              onClick={() => { setPreview(null); setCapturedFile(null); setStatus("idle"); if (fileRef.current) fileRef.current.value = ""; }}
              className="absolute top-2 right-2 bg-black/50 text-white rounded-full px-2 py-0.5 text-xs"
            >
              Retake
            </button>
          </div>
        )}

        {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />

        {status !== "capturing" ? (
          <button
            onClick={() => { if (!name.trim()) { setErrorMsg("Please enter your name first."); return; } setErrorMsg(""); fileRef.current?.click(); }}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <Camera className="w-5 h-5" /> Take Check-In Photo
          </button>
        ) : (
          <button
            onClick={handleCheckin}
            disabled={status === "uploading"}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {status === "uploading" ? <><Loader2 className="w-5 h-5 animate-spin" /> Submitting…</> : <><CheckCircle2 className="w-5 h-5" /> Confirm Check-In</>}
          </button>
        )}
        <p className="text-xs text-gray-400 text-center">Your photo will be date & time stamped and shared with the site manager.</p>
      </div>
    </div>
  );
}

export default function SiteBoard() {
  const [, params] = useRoute("/site/:token");
  const token = params?.token ?? "";

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/site/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.message ?? "Failed to load site board");
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading site board…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Site Board Not Found</h2>
          <p className="text-gray-500">This QR code may be invalid or the project has been archived.</p>
        </div>
      </div>
    );
  }

  const { project, siteManager, teamSize, permits, documents, pinnedItems = [], generatedAt } = data;

  const activePermits = permits.filter((p: any) => {
    const expiry = new Date(p.expiryDate);
    return expiry >= new Date();
  });

  const expiringPermits = permits.filter((p: any) => {
    const expiry = new Date(p.expiryDate);
    const now = new Date();
    const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil >= 0 && daysUntil <= 30;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white print:bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-700 to-orange-500 text-white px-4 py-8 print:py-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-orange-200 text-sm font-medium uppercase tracking-wider mb-1">SiteSort — Site Board</p>
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">{project.name}</h1>
              <div className="flex items-center gap-2 mt-2 text-orange-100">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="text-sm">{project.address}</span>
              </div>
            </div>
            <StatusBadge status={project.status} />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Key info strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Calendar className="w-3.5 h-3.5" /> Start Date
            </div>
            <p className="font-bold text-gray-900 text-sm">
              {new Date(project.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          {project.targetEndDate && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Clock className="w-3.5 h-3.5" /> Target End
              </div>
              <p className="font-bold text-gray-900 text-sm">
                {new Date(project.targetEndDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          )}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Users className="w-3.5 h-3.5" /> Team Size
            </div>
            <p className="font-bold text-gray-900 text-sm">{teamSize} {teamSize === 1 ? "member" : "members"}</p>
          </div>
        </div>

        {/* Expiring permits alert */}
        {expiringPermits.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 text-sm">Permits expiring soon</p>
              <p className="text-amber-700 text-xs mt-0.5">
                {expiringPermits.map((p: any) => p.type).join(", ")} — check with your site manager
              </p>
            </div>
          </div>
        )}

        {/* Site manager */}
        {siteManager && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <HardHat className="w-4 h-4" /> Site Manager
            </h2>
            <p className="font-bold text-gray-900 text-lg">{siteManager.name}</p>
            <a
              href={`mailto:${siteManager.email}`}
              className="inline-flex items-center gap-2 text-orange-600 font-medium text-sm mt-1.5 hover:underline"
            >
              <Mail className="w-4 h-4" /> {siteManager.email}
            </a>
          </div>
        )}

        {/* Active permits */}
        {activePermits.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Active Permits
            </h2>
            <div className="space-y-3">
              {activePermits.map((p: any) => (
                <div key={p.id} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{p.type}</p>
                    <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{p.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">Expires</p>
                    <p className="text-sm font-bold text-gray-700">
                      {new Date(p.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public documents */}
        {documents.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Documents on Display
            </h2>
            <div className="space-y-2">
              {documents.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{d.name}</p>
                    <p className="text-gray-400 text-xs">{TYPE_LABELS[d.type] ?? d.type} · v{d.version}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trades */}
        {project.trades?.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <HardHat className="w-4 h-4" /> Trades on Site
            </h2>
            <div className="flex flex-wrap gap-2">
              {project.trades.map((t: string) => (
                <span key={t} className="px-3 py-1 bg-orange-50 text-orange-800 rounded-full text-sm font-medium border border-orange-200">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Pinned to this board */}
        {pinnedItems.length > 0 && (() => {
          const pinnedDocs = pinnedItems.filter((p: any) => p.itemType === "document");
          const pinnedPhotos = pinnedItems.filter((p: any) => p.itemType === "photo");
          const pinnedPermits = pinnedItems.filter((p: any) => p.itemType === "permit");
          const statusColors: Record<string, string> = { active: "bg-green-100 text-green-800", expiring_soon: "bg-amber-100 text-amber-800", expired: "bg-red-100 text-red-800" };
          const statusLabels: Record<string, string> = { active: "Active", expiring_soon: "Expiring Soon", expired: "Expired" };
          return (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Pin className="w-4 h-4" /> Pinned to this Board
              </h2>

              {pinnedDocs.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Documents</p>
                  <div className="space-y-0 divide-y">
                    {pinnedDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 text-sm truncate">{doc.name}</p>
                            <p className="text-gray-400 text-xs">{TYPE_LABELS[doc.type] ?? doc.type} · v{doc.version}</p>
                          </div>
                        </div>
                        {doc.fileUrl && (
                          <button onClick={() => window.open(doc.fileUrl)} className="shrink-0 text-orange-600 text-xs font-semibold hover:underline">View</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pinnedPhotos.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Photos</p>
                  <div className="grid grid-cols-2 gap-2">
                    {pinnedPhotos.map((photo: any) => (
                      <div key={photo.id} className="rounded-lg overflow-hidden border bg-gray-50">
                        {photo.photoUrl && (
                          <img
                            src={photo.photoUrl}
                            alt={photo.referenceNumber}
                            className="w-full h-24 object-cover cursor-pointer"
                            onClick={() => window.open(photo.photoUrl)}
                          />
                        )}
                        <div className="px-2 py-1.5">
                          <p className="text-xs font-medium text-gray-700 truncate">{photo.referenceNumber}</p>
                          <p className="text-xs text-gray-400 truncate capitalize">{photo.category}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pinnedPermits.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Permits</p>
                  <div className="space-y-0 divide-y">
                    {pinnedPermits.map((permit: any) => (
                      <div key={permit.id} className="flex items-start justify-between gap-2 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{permit.type}</p>
                          {permit.description && <p className="text-gray-500 text-xs mt-0.5 truncate">{permit.description}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[permit.status] ?? "bg-gray-100 text-gray-700"}`}>
                            {statusLabels[permit.status] ?? permit.status}
                          </span>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(permit.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Check-in */}
        <CheckInCard token={token} projectName={project.name} />

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-4 pt-2">
          <p>Powered by <span className="font-semibold text-orange-500">SiteSort</span></p>
          <p className="mt-0.5">Last updated {new Date(generatedAt).toLocaleString("en-GB")}</p>
        </div>
      </div>
    </div>
  );
}
