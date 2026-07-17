import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProjectTeamActivity, RecentActivityGlance } from "../../team-activity";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function OverviewTab() {
  const {
    projectId,
    project,
    todayNotes,
    noteBody,
    setNoteBody,
    noteSubmitting,
    setOpeningNote,
    setSharingNote,
    ovPhotoOpen,
    setOvPhotoOpen,
    ovPhotoUrl,
    setOvPhotoUrl,
    ovPhotoNote,
    setOvPhotoNote,
    ovPhotoKey,
    ovPhotoSubmitting,
    submitDailyNote,
    submitOverviewPhoto,
    setIsUploadOpen,
    caps,
  } = useDetail();

  return (
    <>
        <TabsContent value="overview">
          <div className="space-y-6">
            <RecentActivityGlance projectId={projectId} canManage={caps.canManageProjects} />
            {(caps.canLogPhoto || caps.canUploadDocument) && (
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <h3 className="font-semibold text-sm text-foreground">Post an update</h3>
                  <Textarea
                    value={noteBody}
                    onChange={e => setNoteBody(e.target.value)}
                    placeholder="Write a site update…"
                    rows={3}
                  />
                  {ovPhotoOpen && (
                    <div className="space-y-2">
                      <FileDropZone
                        key={ovPhotoKey}
                        accept=".jpg,.jpeg,.png,.webp"
                        onUploaded={f => setOvPhotoUrl(f.url)}
                        onCleared={() => setOvPhotoUrl(null)}
                      />
                      {ovPhotoUrl && noteBody.trim() ? (
                        <p className="text-xs text-primary flex items-center gap-1.5">
                          <Paperclip className="w-3.5 h-3.5" /> Photo will be attached to this update.
                        </p>
                      ) : (
                        <Input
                          value={ovPhotoNote}
                          onChange={e => setOvPhotoNote(e.target.value)}
                          placeholder="Caption (optional)"
                        />
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex gap-2">
                      {caps.canUploadDocument && (
                        <button
                          type="button"
                          onClick={() => setIsUploadOpen(true)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" /> Document
                        </button>
                      )}
                      {caps.canLogPhoto && (
                        <button
                          type="button"
                          onClick={() => setOvPhotoOpen(o => !o)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors",
                            ovPhotoOpen
                              ? "border-primary/25 bg-primary/5 text-primary hover:bg-primary/15"
                              : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                        >
                          <Camera className="w-3.5 h-3.5" /> Photo
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {ovPhotoOpen && ovPhotoUrl && !noteBody.trim() && (
                        <Button size="sm" variant="outline" onClick={submitOverviewPhoto} isLoading={ovPhotoSubmitting}>
                          Log photo
                        </Button>
                      )}
                      {caps.canLogPhoto && (
                        <Button size="sm" onClick={() => submitDailyNote(noteBody)} disabled={!noteBody.trim() || noteSubmitting}>
                          {noteSubmitting ? "Saving…" : "Save update"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {todayNotes.length > 0 && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Posted today</p>
                      {todayNotes.map(n => (
                        <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-sm text-foreground whitespace-pre-wrap">{n.body}</p>
                          {n.photoUrl && (
                            <img
                              src={n.photoUrl.replace(/^\/uploads\//, "/api/uploads/")}
                              alt="Update attachment"
                              className="mt-2 rounded-md border max-h-44 object-cover cursor-pointer"
                              onClick={() => setOpeningNote(n)}
                            />
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-[10px] text-muted-foreground">{n.authorName} · {formatDate(n.createdAt)}</p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                title="Open"
                                onClick={() => setOpeningNote(n)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />Open
                              </button>
                              <button
                                type="button"
                                title="Share"
                                onClick={() => setSharingNote(n)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />Share
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-bold text-lg mb-4">Recent Activity</h3>
                  <div className="space-y-4">
                    {project.recentActivity?.map(act => (
                      <div key={act.id} className="flex gap-3 text-sm">
                        <div className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0"></div>
                        <div>
                          <p className="font-medium text-foreground">{act.description}</p>
                          <p className="text-muted-foreground text-xs">{formatDate(act.createdAt)} by {act.userName || 'System'}</p>
                        </div>
                      </div>
                    ))}
                    {(!project.recentActivity || project.recentActivity.length === 0) && (
                      <p className="text-muted-foreground">No recent activity.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
    </>
  );
}
