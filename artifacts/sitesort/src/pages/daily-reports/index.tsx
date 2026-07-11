import { useState, useEffect, useCallback } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ClipboardList, FileText, ChevronRight, RefreshCw, CalendarDays, Plus, PencilLine, X,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";
import { DailyReportDetail, type DailyReportDetailData } from "@/components/daily-report-detail";

type ReportRow = {
  id: string;
  projectId: string;
  projectName: string;
  reportDate: string;
  generatedAt: string;
  checkinCount: number;
  documentEventCount: number;
  photoCount: number;
  hasManagerReport: boolean;
  authoredAt: string | null;
};

type ProjectOpt = { id: string; name: string; status?: string };

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const EMPTY_DATA: DailyReportDetailData["data"] = {
  subcontractorsOnSite: [],
  documentActivity: { uploaded: [], amended: [], viewed: [], signedOff: [] },
  sitePhotos: [],
  siteManagerNotes: [],
};

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function DailyReportsPage() {
  const caps = useCapabilities();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [openReport, setOpenReport] = useState<DailyReportDetailData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [initialEditing, setInitialEditing] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [newDate, setNewDate] = useState(londonToday());

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (projectFilter !== "all") params.set("projectId", projectFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    const res = await fetch(`/api/daily-reports${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, [projectFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/projects", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list: ProjectOpt[] = Array.isArray(d) ? d : (d.projects ?? d.data ?? []);
        setProjects(list);
        if (list[0] && !newProject) setNewProject(list[0].id);
      })
      .catch(() => { /* filter dropdown just stays empty */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReportDetail = async (id: string) => {
    setReportLoading(true);
    setInitialEditing(false);
    setOpenReport(null);
    const r = await fetch(`/api/daily-reports/${id}`, { headers: authHeaders() });
    setReportLoading(false);
    if (r.ok) setOpenReport(await r.json());
  };

  const startNewDiary = () => {
    const proj = projects.find((p) => p.id === newProject);
    if (!proj) return;
    setNewOpen(false);
    setInitialEditing(true);
    setOpenReport({
      id: "",
      projectId: proj.id,
      projectName: proj.name,
      reportDate: newDate,
      generatedAt: "",
      checkinCount: 0,
      documentEventCount: 0,
      photoCount: 0,
      data: EMPTY_DATA,
      managerReport: null,
      authorName: null,
      authoredAt: null,
    });
  };

  const cutoff = (() => {
    const d = new Date(`${londonToday()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const total = rows.length;
  const withDiary = rows.filter((r) => r.hasManagerReport).length;
  const thisWeek = rows.filter((r) => r.reportDate >= cutoff).length;

  return (
    <SidebarLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ClipboardList className="w-7 h-7 text-primary" /> Daily Site Reports
          </h1>
          <p className="text-muted-foreground">Every project's daily report in one place — auto-collated activity plus the site diary.</p>
        </div>
        {caps.isInternal && projects.length > 0 && (
          <Button variant="accent" onClick={() => setNewOpen(true)} className="shrink-0">
            <Plus className="w-4 h-4 mr-1.5" />New site diary
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Reports</p>
          <p className="text-2xl font-extrabold">{total}</p>
        </Card>
        <Card className="p-4 border-primary/30 bg-primary/5">
          <p className="text-xs font-medium text-primary mb-1">With site diary</p>
          <p className="text-2xl font-extrabold text-primary">{withDiary}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Last 7 days</p>
          <p className="text-2xl font-extrabold">{thisWeek}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6 [&>*]:min-w-0">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="flex h-11 rounded-lg border-2 border-input bg-background px-3 py-2 text-sm max-w-xs"
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[10rem]" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[10rem]" />
        </div>
        {(from || to || projectFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setProjectFilter("all"); }}>
            <X className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* List */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <CalendarDays className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="font-semibold text-muted-foreground">No daily reports found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Reports are collated automatically each evening (~18:00), or start one now with “New site diary”.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((rep) => (
              <div
                key={rep.id}
                onClick={() => openReportDetail(rep.id)}
                className="flex items-center gap-4 px-4 py-4 hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{formatDate(rep.reportDate)}</p>
                    <span className="text-xs text-muted-foreground truncate max-w-[220px]">{rep.projectName}</span>
                    {rep.hasManagerReport && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary">
                        <PencilLine className="w-3 h-3" />Site diary
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rep.checkinCount} check-in{rep.checkinCount === 1 ? "" : "s"} · {rep.documentEventCount} document update{rep.documentEventCount === 1 ? "" : "s"} · {rep.photoCount} site photo{rep.photoCount === 1 ? "" : "s"}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Report detail / edit modal */}
      <Dialog open={!!openReport || reportLoading} onOpenChange={(v) => { if (!v) { setOpenReport(null); setInitialEditing(false); } }}>
        <DialogHeader>
          <DialogTitle>{openReport ? `Daily site report — ${formatDate(openReport.reportDate)}` : "Loading report…"}</DialogTitle>
        </DialogHeader>
        {reportLoading && !openReport ? (
          <div className="py-10 flex justify-center"><RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" /></div>
        ) : openReport ? (
          <DailyReportDetail
            report={openReport}
            canEdit={caps.isInternal}
            initialEditing={initialEditing}
            onSaved={(mr) => {
              setOpenReport((prev) => (prev ? { ...prev, managerReport: mr } : prev));
              load();
            }}
          />
        ) : null}
      </Dialog>

      {/* New site diary picker */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogHeader>
          <DialogTitle>New site diary</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold block mb-1.5">Project</label>
            <select
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Date</label>
            <Input type="date" value={newDate} max={londonToday()} onChange={(e) => setNewDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button variant="accent" onClick={startNewDiary} disabled={!newProject || !newDate}>Continue</Button>
        </DialogFooter>
      </Dialog>
    </SidebarLayout>
  );
}
