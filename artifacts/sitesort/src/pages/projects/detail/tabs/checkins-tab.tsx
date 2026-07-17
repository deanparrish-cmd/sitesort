import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { useDetail } from "../context";

export function CheckinsTab() {
  const {
    checkins,
    siteBoardUrl,
    setSharingDoc,
  } = useDetail();

  return (
    <>
        <TabsContent value="checkins">
          <PageHeader
            level="section"
            className="mb-4"
            title="Site Check-Ins"
            description="Workers who checked in on site via the QR code board."
            actions={<>
              {siteBoardUrl && (
                <a
                  href={siteBoardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium"
                >
                  <QrCode className="w-3.5 h-3.5 text-primary" /> View Site Board
                </a>
              )}
              <span className="text-sm text-muted-foreground whitespace-nowrap">{checkins.length} {checkins.length === 1 ? "check-in" : "check-ins"}</span>
            </>}
          />

          {checkins.length === 0 ? (
            <Card className="p-12 text-center border-dashed border-2">
              <p className="text-muted-foreground font-medium">No check-ins yet.</p>
              <p className="text-muted-foreground text-sm mt-1">Workers can check in by scanning the site board QR code.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {checkins.map(ci => {
                const photoSrc = ci.photoUrl.startsWith("/uploads/") ? ci.photoUrl.replace("/uploads/", "/api/uploads/") : ci.photoUrl;
                const dt = new Date(ci.checkedInAt);
                const dateStr = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={ci.id} className="rounded-xl overflow-hidden border bg-card shadow-sm">
                    <div className="aspect-square bg-muted relative cursor-pointer" onClick={() => window.open(photoSrc, '_blank', 'noopener,noreferrer')}>
                      <img src={photoSrc} alt={ci.workerName} className="w-full h-full object-contain" />
                    </div>
                    <div className="p-3">
                      <p className="font-semibold text-sm truncate">{ci.workerName}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{dateStr}</p>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-muted-foreground text-xs">{timeStr}</p>
                        <button
                          type="button"
                          onClick={() => setSharingDoc({ type: "photo", id: ci.id, name: `Check-in: ${ci.workerName}`, version: null, fileUrl: photoSrc })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-primary hover:bg-muted transition-colors shrink-0"
                          title="Share check-in"
                        >
                          <Share2 className="w-3.5 h-3.5" />Share
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
    </>
  );
}
