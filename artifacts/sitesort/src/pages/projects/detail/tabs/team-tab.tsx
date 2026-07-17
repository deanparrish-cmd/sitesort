import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SubcontractorPeople, PortalInvitePill } from "../../portal-people";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { InsuranceCertZone } from "@/components/ui/insurance-cert-zone";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function TeamTab() {
  const {
    projectId,
    project,
    members,
    queryClient,
    caps,
    toggleFolder,
    isFolderOpen,
    addingTrade,
    setAddingTrade,
    newTradeName,
    setNewTradeName,
    submitAddTrade,
    editingPhoneId,
    setEditingPhoneId,
    phoneInput,
    setPhoneInput,
    savePhone,
    openFromDirectory,
    setSharingContact,
    openSubNotes,
    openSubDocs,
    setRemoveTarget,
    DAYS,
    openSchedule,
  } = useDetail();

  return (
    <>
        <TabsContent value="team">
          {caps.canManageTeam && (
            <div className="flex justify-end mb-4">
              <Button variant="outline" size="sm" onClick={openFromDirectory}>
                <UserPlus className="w-4 h-4 mr-2" /> Add from Contacts Directory
              </Button>
            </div>
          )}
          {(!members || members.length === 0) ? (
            <div className="bg-card p-12 rounded-xl border text-center border-dashed border-2">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-bold">No team members yet</h3>
              <p className="text-muted-foreground">Add contacts from your directory using the button above.</p>
            </div>
          ) : (() => {
            const allMembers = members as any[];
            const projectTrades: string[] = (project as any)?.trades ?? [];
            const memberTrades = allMembers.flatMap((m: any) => m.trades?.length ? m.trades : []);
            const hasStaff = allMembers.some((m: any) => !m.trades?.length);
            const allTrades = Array.from(new Set([...projectTrades, ...memberTrades, ...(hasStaff ? ["Site Staff"] : [])])).sort((a, b) => a === "Site Staff" ? 1 : b === "Site Staff" ? -1 : a.localeCompare(b)) as string[];
            const membersByTrade = (trade: string) => allMembers.filter((m: any) => trade === "Site Staff" ? !m.trades?.length : m.trades?.includes(trade));

            return (
              <div className="space-y-3">
                {allTrades.map(trade => {
                  const tradeMembers = membersByTrade(trade);
                  const open = isFolderOpen(trade);
                  return (
                    <div key={trade} className="bg-card border rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => toggleFolder(trade)}
                        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                      >
                        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <FolderOpen className="w-5 h-5 text-orange-500 shrink-0" />
                        <span className="font-bold capitalize flex-1">{trade}</span>
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{tradeMembers.length} {tradeMembers.length === 1 ? "person" : "people"}</span>
                      </button>
                      {open && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 pt-0 border-t">
                          {tradeMembers.map((member: any) => {
                const isSubcontractor = !!member.subcontractorId;
                const complianceBadge = member.complianceStatus === "ok"
                  ? <Badge variant="success" className="text-[10px]"><UserCheck className="w-3 h-3 mr-1"/>Compliant</Badge>
                  : member.complianceStatus === "warning"
                  ? <Badge variant="warning" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>Insurance Expiring</Badge>
                  : member.complianceStatus === "hold"
                  ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>Site Access Denied</Badge>
                  : null;

                return (
                  <div key={member.id} className="bg-card border rounded-xl p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow min-w-0 overflow-hidden">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 min-w-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <label className={cn("relative shrink-0", caps.canManageTeam ? "cursor-pointer group" : "cursor-default")} title={caps.canManageTeam ? "Click to upload photo" : undefined}>
                          {caps.canManageTeam && (
                          <input type="file" accept="image/*" className="hidden" onChange={async e => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const token = localStorage.getItem("sitesort_token");
                            const fd = new FormData(); fd.append("file", file);
                            const up = await fetch("/api/upload", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
                            if (!up.ok) return;
                            const { url } = await up.json();
                            await fetch(`/api/projects/${projectId}/members/${member.id}/avatar`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ avatarUrl: url }) });
                            await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
                          }} />
                          )}
                          <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center shrink-0 overflow-hidden", isSubcontractor ? "bg-orange-500/10" : "bg-primary/10")}>
                            {member.avatarUrl ? (
                              <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className={cn("text-lg font-extrabold", isSubcontractor ? "text-orange-500" : "text-primary")}>
                                {member.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                              </span>
                            )}
                          </div>
                          {caps.canManageTeam && (
                            <div className="absolute inset-0 rounded-xl bg-black/40 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Camera className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </label>
                        <div className="min-w-0">
                          <p className="font-bold text-base leading-tight break-words">{member.name}</p>
                          {isSubcontractor && member.contactName && (
                            <p className="text-xs text-muted-foreground break-words">Contact: {member.contactName}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
                          <Badge variant="secondary" className="text-[10px] capitalize">{member.role.replace('_', ' ')}</Badge>
                          {caps.canManageTeam && (
                            <PortalInvitePill
                              projectId={projectId}
                              personName={isSubcontractor ? (member.contactName || member.name) : member.name}
                              personEmail={member.email}
                              source={isSubcontractor ? { kind: "subcontractor", subcontractorId: member.subcontractorId } : { kind: "in_house" }}
                              canManage={caps.canManageTeam}
                            />
                          )}
                          {isSubcontractor && (
                            <button
                              type="button"
                              onClick={() => openSubNotes(member.subcontractorId, member.name)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                              title="Notes & reminders"
                            >
                              <StickyNote className="w-3.5 h-3.5" />Notes
                            </button>
                          )}
                          {isSubcontractor && (
                            <button
                              type="button"
                              onClick={() => openSubDocs(member.subcontractorId, member.name)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                              title="Documents"
                            >
                              <FileText className="w-3.5 h-3.5" />Docs
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSharingContact({
                              id: member.id,
                              name: member.name,
                              text: `${member.name} (${member.role.replace(/_/g, " ")})${member.trades?.length ? `\nTrades: ${member.trades.join(", ")}` : ""}\nEmail: ${member.email ?? "N/A"}${member.phone ? `\nPhone: ${member.phone}` : ""}`,
                            })}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                            title="Share contact"
                          >
                            <Share2 className="w-3.5 h-3.5" />Share
                          </button>
                          {caps.canManageTeam && (() => {
                            const isCompanyRow = !!member.subcontractorId && !member.personId;
                            return (
                              <button
                                type="button"
                                onClick={() => setRemoveTarget({
                                  kind: isCompanyRow ? "company" : "member",
                                  id: isCompanyRow ? member.subcontractorId : member.id,
                                  name: member.name,
                                  isPortal: !!member.personId,
                                })}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                title={isCompanyRow ? "Remove company from project" : "Remove from project"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />Remove
                              </button>
                            );
                          })()}
                        </div>
                        {complianceBadge}
                      </div>
                    </div>

                    {member.trades?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {member.trades.map((trade: string) => (
                          <span key={trade} className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-500/10 text-orange-600 text-xs font-semibold rounded-full capitalize">
                            <HardHat className="w-3 h-3" />{trade}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5 pt-1 border-t border-border/50">
                      {member.email && (
                        <a href={`mailto:${member.email}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
                          <Mail className="w-4 h-4 shrink-0" />
                          <span className="truncate">{member.email}</span>
                        </a>
                      )}
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 shrink-0 text-muted-foreground" />
                        {editingPhoneId === member.id ? (
                          <div className="flex items-center gap-1 flex-1">
                            <input
                              autoFocus
                              value={phoneInput}
                              onChange={e => setPhoneInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") savePhone(member.id); if (e.key === "Escape") setEditingPhoneId(null); }}
                              placeholder="+44 7700 000000"
                              className="flex-1 text-sm bg-muted rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-primary/30 min-w-0"
                            />
                            <button onClick={() => savePhone(member.id)} className="text-success hover:text-success/80 shrink-0"><CheckCircle2 className="w-4 h-4" /></button>
                            <button onClick={() => setEditingPhoneId(null)} className="text-muted-foreground hover:text-destructive shrink-0"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-1 min-w-0 group/phone">
                            {member.phone ? (
                              <a href={`tel:${member.phone}`} className="text-sm text-muted-foreground hover:text-primary transition-colors truncate">{member.phone}</a>
                            ) : (
                              <span className="text-sm text-muted-foreground italic">Add phone number</span>
                            )}
                            {caps.canManageTeam && (
                              <button
                                onClick={() => { setEditingPhoneId(member.id); setPhoneInput(member.phone ?? ""); }}
                                className="ml-1 opacity-100 lg:opacity-0 lg:group-hover/phone:opacity-100 transition-opacity text-muted-foreground hover:text-primary shrink-0"
                              ><Pencil className="w-3 h-3" /></button>
                            )}
                          </div>
                        )}
                      </div>
                      {!member.email && !member.phone && editingPhoneId !== member.id && (
                        <p className="text-xs text-muted-foreground italic">No email on file</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <div className="flex-1">
                        {(member.scheduledDays?.length > 0 || member.siteStartTime) ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            {member.scheduledDays?.length > 0 && (
                              <div className="flex gap-1 flex-wrap">
                                {[...member.scheduledDays].sort((a: string, b: string) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((d: string) => (
                                  <span key={d} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded">{d}</span>
                                ))}
                              </div>
                            )}
                            {member.siteStartTime && member.siteEndTime && (
                              <span className="text-xs text-muted-foreground">{member.siteStartTime.slice(0,5)}–{member.siteEndTime.slice(0,5)}</span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No site schedule set</p>
                        )}
                      </div>
                      {caps.canManageTeam && (
                        <button
                          onClick={() => openSchedule(member)}
                          className="ml-2 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors shrink-0"
                          title="Edit schedule"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isSubcontractor && (
                      <InsuranceCertZone
                        memberId={member.id}
                        projectId={projectId}
                        existingCertUrl={member.pliCertUrl ?? null}
                        existingExpiryDate={member.pliExpiryDate ?? null}
                        onSaved={() => queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] })}
                      />
                    )}
                    {isSubcontractor && caps.canManageTeam && (
                      <SubcontractorPeople
                        subcontractorId={member.subcontractorId}
                        projectId={projectId}
                        primaryContactEmail={member.email}
                        canManage={caps.canManageTeam}
                      />
                    )}
                      </div>
                    );
                  })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {caps.canManageProjects && (addingTrade ? (
                  <div className="flex items-center gap-2 px-2">
                    <input
                      autoFocus
                      value={newTradeName}
                      onChange={e => setNewTradeName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") submitAddTrade(); if (e.key === "Escape") { setAddingTrade(false); setNewTradeName(""); } }}
                      placeholder="e.g. Electrical, Roofing…"
                      className="flex-1 text-sm bg-muted rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 border border-input"
                    />
                    <Button size="sm" variant="accent" onClick={submitAddTrade}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingTrade(false); setNewTradeName(""); }}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTrade(true)}
                    className="flex items-center gap-2 px-4 py-3 w-full text-sm font-semibold text-muted-foreground hover:text-primary border-2 border-dashed border-muted hover:border-primary/40 rounded-xl transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />+ Add Trade Folder
                  </button>
                ))}
              </div>
            );
          })()}
        </TabsContent>
    </>
  );
}
