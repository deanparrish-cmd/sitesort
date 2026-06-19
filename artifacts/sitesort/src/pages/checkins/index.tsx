import { useState, useEffect } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareModal } from "@/components/share-modal";
import {
  ClipboardCheck, Search, MapPin, Building2, Calendar,
  ExternalLink, Share2, X, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

type Checkin = {
  id: string;
  projectId: string;
  projectName: string;
  workerName: string;
  companyName: string | null;
  photoUrl: string;
  checkedInAt: string;
  lat: number | null;
  lng: number | null;
};

function normaliseUrl(url: string) {
  return url.startsWith("/uploads/") ? url.replace("/uploads/", "/api/uploads/") : url;
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function CheckinsPage() {
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [viewing, setViewing] = useState<Checkin | null>(null);
  const [shareItem, setShareItem] = useState<{ id: string; name: string; fileUrl: string; projectId: string } | null>(null);

  useEffect(() => {
    fetch("/api/checkins", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setCheckins)
      .finally(() => setLoading(false));
  }, []);

  const projects = Array.from(new Map(checkins.map(c => [c.projectId, c.projectName])).entries());

  const filtered = checkins.filter(c => {
    if (projectFilter !== "all" && c.projectId !== projectFilter) return false;
    if (q) {
      const lq = q.toLowerCase();
      return (
        c.workerName.toLowerCase().includes(lq) ||
        (c.companyName ?? "").toLowerCase().includes(lq) ||
        c.projectName.toLowerCase().includes(lq)
      );
    }
    return true;
  });

  const today = new Date().toDateString();
  const todayCount = checkins.filter(c => new Date(c.checkedInAt).toDateString() === today).length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekCount = checkins.filter(c => new Date(c.checkedInAt).getTime() >= weekAgo).length;

  return (
    <SidebarLayout>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" /> Site Check-Ins
          </h1>
          <p className="text-muted-foreground text-sm mt-1">All worker check-ins across your projects via QR site boards.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-primary">{checkins.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-orange-600">{todayCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Today</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{weekCount}</p>
          <p className="text-xs text-muted-foreground mt-1">This Week</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex-1 min-w-[180px]">
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search worker, company, project…"
            icon={<Search className="w-4 h-4" />}
          />
        </div>
        <select
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
          className="h-11 min-w-0 max-w-full box-border rounded-lg border-2 border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:border-primary"
        >
          <option value="all">All Projects</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-xl border bg-muted animate-pulse aspect-square" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <ClipboardCheck className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">{q || projectFilter !== "all" ? "No check-ins match your filters." : "No check-ins yet."}</p>
          <p className="text-muted-foreground text-sm mt-1">Workers check in by scanning a QR site board.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(ci => {
            const src = normaliseUrl(ci.photoUrl);
            const dt = new Date(ci.checkedInAt);
            return (
              <div key={ci.id} className="rounded-xl overflow-hidden border bg-card shadow-sm group">
                <div
                  className="aspect-square bg-muted relative cursor-pointer overflow-hidden"
                  onClick={() => setViewing(ci)}
                >
                  <img src={src} alt={ci.workerName} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
                <div className="p-3">
                  <p className="font-semibold text-sm truncate">{ci.workerName}</p>
                  {ci.companyName && <p className="text-xs text-muted-foreground truncate">{ci.companyName}</p>}
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{ci.projectName}</p>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-xs text-muted-foreground">
                      {dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
                        className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                        title="Open photo"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setShareItem({ id: ci.id, name: `Check-in: ${ci.workerName}`, fileUrl: src, projectId: ci.projectId })}
                        className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                        title="Share"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail overlay */}
      {viewing && (() => {
        const src = normaliseUrl(viewing.photoUrl);
        const dt = new Date(viewing.checkedInAt);
        return (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
            <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div className="min-w-0">
                  <p className="font-bold truncate">{viewing.workerName}</p>
                  {viewing.companyName && <p className="text-xs text-muted-foreground truncate">{viewing.companyName}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors text-sm font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </button>
                  <button
                    onClick={() => { setShareItem({ id: viewing.id, name: `Check-in: ${viewing.workerName}`, fileUrl: src, projectId: viewing.projectId }); setViewing(null); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors text-sm font-medium"
                  >
                    <Share2 className="w-3.5 h-3.5" /> Share
                  </button>
                  <button onClick={() => setViewing(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Photo */}
              <img src={src} alt={viewing.workerName} className="w-full object-contain max-h-[55vh]" />

              {/* Details */}
              <div className="px-5 py-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="w-4 h-4 shrink-0" />
                  <span className="truncate">{viewing.projectName}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4 shrink-0" />
                  <span>{dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} at {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {viewing.companyName && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="w-4 h-4 shrink-0" />
                    <span className="truncate">{viewing.companyName}</span>
                  </div>
                )}
                {viewing.lat && viewing.lng && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="w-4 h-4 shrink-0" />
                    <a
                      href={`https://www.google.com/maps?q=${viewing.lat},${viewing.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View on map ({viewing.lat.toFixed(5)}, {viewing.lng.toFixed(5)})
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <ShareModal
        open={!!shareItem}
        onClose={() => setShareItem(null)}
        entityType="photo"
        entityId={shareItem?.id ?? ""}
        entityName={shareItem?.name ?? ""}
        fileUrl={shareItem?.fileUrl}
        projectId={shareItem?.projectId}
      />
    </SidebarLayout>
  );
}
