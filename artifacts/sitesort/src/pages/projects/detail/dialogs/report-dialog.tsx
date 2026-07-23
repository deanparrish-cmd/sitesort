import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { DailyReportDetail, type ManagerReport } from "@/components/daily-report-detail";
import { ShareModal } from "@/components/share-modal";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function ReportDialog() {
  const {
    projectId,
    reports,
    setReports,
    openReport,
    setOpenReport,
    reportLoading,
    reportInitialEditing,
    authHeaders,
    caps,
  } = useDetail();
  const [shareOpen, setShareOpen] = useState(false);

  const reportShareText = (rep: NonNullable<typeof openReport>) => {
    const lines = [
      `Daily site report — ${formatDate(rep.reportDate)}`,
      `Project: ${rep.projectName}`,
      `${rep.checkinCount} check-in${rep.checkinCount === 1 ? "" : "s"} · ${rep.documentEventCount} document update${rep.documentEventCount === 1 ? "" : "s"} · ${rep.photoCount} site photo${rep.photoCount === 1 ? "" : "s"}`,
      rep.managerReport ? "Includes a site diary entry." : "",
      "Full report available in SiteSort.",
    ].filter(Boolean);
    return lines.join("\n");
  };

  return (
    <>
      <Dialog open={!!openReport || reportLoading} onOpenChange={v => { if (!v) setOpenReport(null); }}>
        <DialogHeader>
          <DialogTitle>{openReport ? `Daily site report — ${formatDate(openReport.reportDate)}` : "Loading report…"}</DialogTitle>
        </DialogHeader>
        {openReport && openReport.id && (
          <div className="flex justify-end -mt-1 mb-1">
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
              <Share2 className="w-3.5 h-3.5 mr-1.5" />Share
            </Button>
          </div>
        )}
        {reportLoading && !openReport ? (
          <div className="py-10 flex justify-center"><RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" /></div>
        ) : openReport ? (
          <DailyReportDetail
            report={openReport}
            canEdit={caps.isInternal}
            initialEditing={reportInitialEditing}
            onSaved={(mr) => {
              setOpenReport(prev => prev ? { ...prev, managerReport: mr } : prev);
              fetch(`/api/projects/${projectId}/daily-reports`, { headers: authHeaders() })
                .then(r => r.ok ? r.json() : []).then(setReports).catch(() => {});
            }}
          />
        ) : null}
      </Dialog>
      {openReport && openReport.id && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          entityType="daily_report"
          entityId={openReport.id}
          entityName={`Daily site report — ${formatDate(openReport.reportDate)} (${openReport.projectName})`}
          projectId={projectId}
          shareText={reportShareText(openReport)}
        />
      )}
    </>
  );
}
