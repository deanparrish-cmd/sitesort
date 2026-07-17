import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function ReportsTab() {
  const {
    photos,
    reports,
    openReportDetail,
    openTodaysDiary,
    caps,
  } = useDetail();

  return (
    <>
        {caps.isInternal && (
          <TabsContent value="reports">
            <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-lg">Daily Site Reports</h3>
              </div>
              {caps.isInternal && (
                <Button variant="accent" size="sm" onClick={openTodaysDiary} className="shrink-0">
                  <Plus className="w-4 h-4 mr-1.5" />Today's site diary
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-6">Auto-generated each evening (~18:00), collating the day's check-ins, document activity and tagged site photos. Add a site diary any time to record weather, labour, work done, delays and H&amp;S.</p>
            {reports.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
                No daily reports yet. The first one appears after today's site activity is collated this evening — or add today's site diary now.
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {[...reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).map(rep => (
                  <Card
                    key={rep.id}
                    onClick={() => openReportDetail(rep.id)}
                    className="flex items-center gap-4 px-4 py-4 cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{formatDate(rep.reportDate)}</p>
                        {rep.hasManagerReport && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary">
                            <Pencil className="w-3 h-3" />Site diary
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {rep.checkinCount} check-in{rep.checkinCount === 1 ? "" : "s"} · {rep.documentEventCount} document update{rep.documentEventCount === 1 ? "" : "s"} · {rep.photoCount} site photo{rep.photoCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}
    </>
  );
}
