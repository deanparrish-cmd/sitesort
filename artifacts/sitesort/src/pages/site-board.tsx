import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { MapPin, Calendar, FileText, HardHat, ShieldCheck, AlertTriangle, Users, Mail, Phone, Clock } from "lucide-react";

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

  const { project, siteManager, teamSize, permits, documents, generatedAt } = data;

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

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-4 pt-2">
          <p>Powered by <span className="font-semibold text-orange-500">SiteSort</span></p>
          <p className="mt-0.5">Last updated {new Date(generatedAt).toLocaleString("en-GB")}</p>
        </div>
      </div>
    </div>
  );
}
