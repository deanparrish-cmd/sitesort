import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { DailyReportDetail, type ManagerReport } from "@/components/daily-report-detail";
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

  return (
    <>
      <Dialog open={!!openReport || reportLoading} onOpenChange={v => { if (!v) setOpenReport(null); }}>
        <DialogHeader>
          <DialogTitle>{openReport ? `Daily site report — ${formatDate(openReport.reportDate)}` : "Loading report…"}</DialogTitle>
        </DialogHeader>
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
    </>
  );
}
