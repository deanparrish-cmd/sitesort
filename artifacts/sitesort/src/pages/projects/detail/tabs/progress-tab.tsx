import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function ProgressTab() {
  const {
    projectId,
    project,
    milestones,
    milestoneTitle,
    setMilestoneTitle,
    milestoneDue,
    setMilestoneDue,
    milestoneAdding,
    setMilestoneAdding,
    authHeaders,
    fetchMilestones,
    isCancelled,
    toast,
    caps,
  } = useDetail();

  return (
    <>
        <TabsContent value="progress">
          {(() => {
            const total = milestones.length;
            const done = milestones.filter(m => m.completedAt).length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);

            // Gantt helpers
            const start = project.startDate ? new Date(project.startDate) : null;
            const end = project.targetEndDate ? new Date(project.targetEndDate) : null;
            const spanDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000)) : null;
            const positionPct = (dateStr: string) => {
              if (!start || !spanDays) return null;
              const d = new Date(dateStr);
              const offset = Math.round((d.getTime() - start.getTime()) / 86400000);
              return Math.min(100, Math.max(0, Math.round((offset / spanDays) * 100)));
            };
            const todayPct = start && spanDays ? positionPct(new Date().toISOString().slice(0, 10)) : null;

            return (
              <div className="space-y-6">
                {/* Progress summary */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-lg">Overall Progress</h3>
                      <span className="text-3xl font-bold text-primary">{pct}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
                      <div
                        className="h-4 rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {done} of {total} milestone{total !== 1 ? "s" : ""} completed
                    </p>
                  </CardContent>
                </Card>

                {/* Milestones checklist */}
                <Card>
                  <CardContent className="pt-6">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                      <Flag className="w-5 h-5 text-primary" /> Milestones
                    </h3>

                    <div className="space-y-2 mb-4">
                      {milestones.length === 0 && (
                        <p className="text-muted-foreground text-sm">No milestones yet. Add one below.</p>
                      )}
                      {milestones.map(m => (
                        <div key={m.id} className={cn("flex items-center gap-3 p-3 rounded-lg border transition-colors", m.completedAt ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-card border-border")}>
                          <button
                            disabled={!caps.canManageProjects}
                            onClick={async () => {
                              if (!caps.canManageProjects) return;
                              if (isCancelled) { toast({ title: "Subscription required", variant: "destructive" }); return; }
                              await fetch(`/api/projects/${projectId}/milestones/${m.id}`, {
                                method: "PATCH", headers: authHeaders(),
                                body: JSON.stringify({ completed: !m.completedAt }),
                              });
                              fetchMilestones();
                            }}
                            className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors", m.completedAt ? "border-green-500 bg-green-500 text-white" : "border-muted-foreground hover:border-primary", !caps.canManageProjects && "cursor-default opacity-60")}
                          >
                            {m.completedAt && <CheckCircle2 className="w-4 h-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={cn("font-medium text-sm", m.completedAt && "line-through text-muted-foreground")}>{m.title}</p>
                            <p className="text-xs text-muted-foreground">Due {new Date(m.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                          {!isCancelled && caps.canManageProjects && (
                            <button onClick={async () => {
                              await fetch(`/api/projects/${projectId}/milestones/${m.id}`, { method: "DELETE", headers: authHeaders() });
                              fetchMilestones();
                            }} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {!isCancelled && caps.canManageProjects && (
                      <div className="flex gap-2 pt-2 border-t">
                        <Input
                          placeholder="Milestone title"
                          value={milestoneTitle}
                          onChange={e => setMilestoneTitle(e.target.value)}
                          className="flex-1 min-w-0"
                          onKeyDown={e => e.key === "Enter" && !milestoneAdding && document.getElementById("ms-add-btn")?.click()}
                        />
                        <Input
                          type="date"
                          value={milestoneDue}
                          onChange={e => setMilestoneDue(e.target.value)}
                          className="w-40"
                        />
                        <Button
                          id="ms-add-btn"
                          size="sm"
                          disabled={!milestoneTitle.trim() || !milestoneDue || milestoneAdding}
                          onClick={async () => {
                            setMilestoneAdding(true);
                            await fetch(`/api/projects/${projectId}/milestones`, {
                              method: "POST", headers: authHeaders(),
                              body: JSON.stringify({ title: milestoneTitle.trim(), dueDate: milestoneDue }),
                            });
                            setMilestoneTitle(""); setMilestoneDue("");
                            fetchMilestones();
                            setMilestoneAdding(false);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Gantt timeline */}
                {start && end && (
                  <Card>
                    <CardContent className="pt-6">
                      <h3 className="font-bold text-lg mb-4">Timeline</h3>
                      <div className="relative">
                        {/* Date labels */}
                        <div className="flex justify-between text-xs text-muted-foreground mb-2">
                          <span>{start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                          <span>{end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                        </div>
                        {/* Track */}
                        <div className="relative h-8 bg-muted rounded-full overflow-visible mb-6">
                          {/* Filled portion */}
                          <div className="absolute inset-y-0 left-0 bg-primary/20 rounded-full" style={{ width: `${pct}%` }} />
                          {/* Today marker */}
                          {todayPct !== null && todayPct >= 0 && todayPct <= 100 && (
                            <div className="absolute top-[-4px] bottom-[-4px] w-0.5 bg-orange-500 z-10" style={{ left: `${todayPct}%` }}>
                              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-orange-500 font-semibold whitespace-nowrap">Today</div>
                            </div>
                          )}
                          {/* Milestone markers */}
                          {milestones.map(m => {
                            const pos = positionPct(m.dueDate);
                            if (pos === null) return null;
                            return (
                              <div
                                key={m.id}
                                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20"
                                style={{ left: `${pos}%` }}
                                title={`${m.title} — ${new Date(m.dueDate).toLocaleDateString("en-GB")}`}
                              >
                                <div className={cn(
                                  "w-4 h-4 rotate-45 border-2 transition-colors",
                                  m.completedAt ? "bg-green-500 border-green-600" : "bg-background border-primary"
                                )} />
                              </div>
                            );
                          })}
                        </div>
                        {/* Legend */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                          {milestones.map(m => {
                            const pos = positionPct(m.dueDate);
                            if (pos === null) return null;
                            return (
                              <div key={m.id} className="flex items-center gap-1 text-xs">
                                <div className={cn("w-2.5 h-2.5 rotate-45 border", m.completedAt ? "bg-green-500 border-green-600" : "bg-background border-primary")} />
                                <span className={cn(m.completedAt ? "text-green-600 line-through" : "text-foreground")}>{m.title}</span>
                              </div>
                            );
                          })}
                          {todayPct !== null && <div className="flex items-center gap-1 text-xs"><div className="w-0.5 h-3 bg-orange-500" /><span className="text-orange-500">Today</span></div>}
                        </div>
                        {milestones.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center mt-2">Add milestones above to see them on the timeline.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {!start && (
                  <p className="text-sm text-muted-foreground">Set a project start date and target end date to see the Gantt timeline.</p>
                )}
              </div>
            );
          })()}
        </TabsContent>
    </>
  );
}
