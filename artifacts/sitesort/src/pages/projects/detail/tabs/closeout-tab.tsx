import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { LinkRow } from "@/components/ui/link-row";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function CloseoutTab() {
  const {
    project,
    permits,
    setIssueStatusFilter,
    openTab,
    isCancelled,
    caps,
    closeout,
    reopenSubmitting,
    openCloseout,
    reopenProject,
  } = useDetail();

  return (
    <>
        <TabsContent value="closeout">
          <div className="max-w-2xl space-y-6">
            {closeout?.isComplete && closeout.closeout ? (
              <Card>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Project closed out</h3>
                      <p className="text-sm text-muted-foreground">This project has been signed off and marked Complete.</p>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-1.5">
                    <div><span className="text-muted-foreground">Signed off by:</span>{" "}<span className="font-medium">{closeout.closeout.signedOffByName}</span> <span className="text-xs text-muted-foreground">({closeout.closeout.signedOffByRole.replace(/_/g, " ")})</span></div>
                    <div><span className="text-muted-foreground">When:</span>{" "}<span className="font-medium">{new Date(closeout.closeout.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
                    {closeout.closeout.note && <div className="pt-1 break-words"><span className="text-muted-foreground">Note:</span> {closeout.closeout.note}</div>}
                  </div>
                  {caps.canManageProjects && (
                    <Button variant="outline" onClick={reopenProject} isLoading={reopenSubmitting}>
                      <RefreshCw className="w-4 h-4 mr-2" />Re-open project
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-6 space-y-5">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2"><ClipboardCheck className="w-5 h-5" />Close-out readiness</h3>
                    <p className="text-sm text-muted-foreground mt-1">Review these before signing off the handover. You can still close out with outstanding items.</p>
                  </div>
                  {closeout ? (
                    <>
                      <div className="space-y-2">
                        {[
                          {
                            label: "Open snags & safety issues",
                            ok: closeout.checks.openIssues.ok,
                            detail: closeout.checks.openIssues.ok ? "All resolved" : `${closeout.checks.openIssues.count} open`,
                            onClick: () => {
                              const st = closeout.checks.openIssues.ok ? "all" : "open";
                              setIssueStatusFilter(st);
                              openTab("issues", { issueStatus: st });
                            },
                          },
                          {
                            label: "Subcontractor insurance",
                            ok: closeout.checks.insurance.ok,
                            detail: closeout.checks.insurance.subsTotal === 0 ? "No subcontractors" : closeout.checks.insurance.ok ? "All valid" : `${closeout.checks.insurance.subsWithIssues} of ${closeout.checks.insurance.subsTotal} need attention`,
                            onClick: () => openTab("permits", { section: "insurance" }, "section-insurance"),
                          },
                          {
                            label: "Permits",
                            ok: closeout.checks.permits.ok,
                            detail: closeout.checks.permits.ok ? "None expired" : `${closeout.checks.permits.expiredCount} expired`,
                            onClick: () => openTab("permits", { section: "expired" }, "section-expired"),
                          },
                          {
                            label: "Document sign-offs",
                            ok: closeout.checks.signOffs.ok,
                            detail: closeout.checks.signOffs.ok ? "All complete" : `${closeout.checks.signOffs.pendingCount} pending`,
                            onClick: () => openTab("finances", { signoff: "pending" }, "section-docstatus"),
                          },
                        ].map(row => (
                          <LinkRow
                            key={row.label}
                            onClick={row.onClick}
                            icon={row.ok
                              ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                              : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                            label={row.label}
                            detail={row.detail}
                            tone={row.ok ? "success" : "warning"}
                            quiet={row.ok}
                            ariaLabel={`${row.label}: ${row.detail}`}
                          />
                        ))}
                      </div>
                      <div className={cn("rounded-lg p-3 text-sm font-medium", closeout.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                        {closeout.ready ? "Everything looks ready for close-out." : "Some items are still outstanding — you can proceed, but review them first."}
                      </div>
                      {caps.canManageProjects ? (
                        <Button variant="accent" onClick={openCloseout} disabled={isCancelled}>
                          <ClipboardCheck className="w-4 h-4 mr-2" />Sign off &amp; mark Complete
                        </Button>
                      ) : (
                        <p className="text-sm text-muted-foreground">Only an admin or project manager can close out a project.</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading readiness…</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
    </>
  );
}
