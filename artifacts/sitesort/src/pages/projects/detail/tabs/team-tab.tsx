import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PortalInvitePill } from "../../portal-people";
import { useCreateSubcontractorPerson, useListPersonCertifications, useCreatePersonCertification } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip, Building2 } from "lucide-react";
import { InsuranceCertZone } from "@/components/ui/insurance-cert-zone";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

// Wherever a company name would render, self-employed contacts show
// "Self-employed" instead — the person IS the entity (Feature: self-employed contacts).
function companyLabel(member: any): string {
  return member.contactType === "self_employed" ? "Self-employed" : (member.companyName ?? "");
}

function complianceBadge(status: string) {
  return status === "ok"
    ? <Badge variant="success" className="text-[10px]"><UserCheck className="w-3 h-3 mr-1"/>Compliant</Badge>
    : status === "warning"
    ? <Badge variant="warning" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>Insurance Expiring</Badge>
    : status === "hold"
    ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>Site Access Denied</Badge>
    : null;
}

// "+ Add person" quick-add on a company strip — creates a new `people` row for
// the firm and immediately adds them to this project (Feature: person-first
// add flow). Portal invite is a separate follow-on step via the pill on their
// new card.
function AddPersonInline({ subcontractorId, onAdded }: { subcontractorId: string; onAdded: (personId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", roleTitle: "" });
  const createPerson = useCreateSubcontractorPerson();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors">
        <UserPlus className="w-3.5 h-3.5" />+ Add person
      </button>
    );
  }
  const valid = form.firstName.trim().length >= 2 && form.lastName.trim().length >= 2 && form.email.trim();
  return (
    <div className="md:col-span-2 grid grid-cols-2 gap-1.5 p-3 rounded-lg border bg-muted/20 [&>*]:min-w-0">
      <Input className="h-8 text-sm" placeholder="First name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
      <Input className="h-8 text-sm" placeholder="Surname" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
      <Input className="h-8 text-sm col-span-2" type="email" placeholder="Email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
      <Input className="h-8 text-sm" placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      <Input className="h-8 text-sm" placeholder="Job title (optional)" value={form.roleTitle} onChange={e => setForm(f => ({ ...f, roleTitle: e.target.value }))} />
      <div className="col-span-2 flex items-center gap-2">
        <Button size="sm" className="h-8" isLoading={createPerson.isPending} disabled={!valid} onClick={async () => {
          const created = await createPerson.mutateAsync({ subcontractorId, data: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, roleTitle: form.roleTitle.trim() || undefined } });
          onAdded((created as { id: string }).id);
          setForm({ firstName: "", lastName: "", email: "", phone: "", roleTitle: "" });
          setOpen(false);
        }}>Add</Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// Individual certifications (CSCS, SSSTS, gas safe, plant tickets, etc.) held by
// this person — distinct from the firm's PLI/insurance (Feature: person-level
// certifications). Shown on every person's card regardless of employment shape.
function PersonCertifications({ personId, canManage }: { personId: string; canManage: boolean }) {
  const { data: certs, refetch } = useListPersonCertifications(personId, { query: { queryKey: ["/api/people", personId, "certifications"] } });
  const create = useCreatePersonCertification();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", expiryDate: "" });

  const statusColor = (status?: string) =>
    status === "expired" ? "bg-red-50 text-red-700 border-red-200" :
    status === "expiring_soon" ? "bg-amber-50 text-amber-700 border-amber-200" :
    "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(certs ?? []).map(c => (
        <span key={c.id} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border", statusColor(c.status))}>
          <ShieldCheck className="w-3 h-3" />{c.name}
        </span>
      ))}
      {canManage && !open && (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground border border-dashed border-border hover:text-primary hover:border-primary/50 transition-colors">
          <Plus className="w-3 h-3" />Add certification
        </button>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 w-full mt-1 [&>*]:min-w-0">
          <Input className="h-7 text-xs flex-1" placeholder="Cert name, e.g. CSCS Card" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input type="date" className="h-7 text-xs rounded-md border border-input bg-background px-2" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
          <Button size="sm" className="h-7 px-2 text-xs" disabled={!form.name.trim() || !form.expiryDate} onClick={async () => {
            await create.mutateAsync({ personId, data: { name: form.name.trim(), expiryDate: form.expiryDate } });
            setForm({ name: "", expiryDate: "" });
            setOpen(false);
            void refetch();
          }}>Add</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

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
    addPersonToProject,
    setSharingContact,
    openSubNotes,
    openSubDocs,
    setRemoveTarget,
    DAYS,
    openSchedule,
  } = useDetail();

  // One card per person; a firm with 2+ people on this project gets a shared
  // strip above its cards (company name, trades, PLI badge, "Remove company
  // from project"). A firm with exactly one person (the common case — most
  // firms start with just their auto-created primary contact) renders as a
  // single card with the company info inline instead, to avoid a redundant
  // strip over one card (Feature: person-first Team tab cards).
  function renderPersonCard(member: any, opts: { showCompanyInline: boolean }) {
    const isSubcontractor = !!member.subcontractorId;
    const badge = complianceBadge(member.complianceStatus);
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
              {isSubcontractor && opts.showCompanyInline && (
                <p className="text-xs text-muted-foreground break-words">{companyLabel(member)}{member.roleTitle ? ` · ${member.roleTitle}` : ""}</p>
              )}
              {isSubcontractor && !opts.showCompanyInline && member.roleTitle && (
                <p className="text-xs text-muted-foreground break-words">{member.roleTitle}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 min-w-0">
            <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
              <Badge variant="secondary" className="text-[10px] capitalize">{member.role.replace('_', ' ')}</Badge>
              {caps.canManageTeam && (
                <PortalInvitePill
                  projectId={projectId}
                  personName={member.name}
                  personEmail={member.email}
                  source={
                    member.personId
                      ? { kind: "person", personId: member.personId, subcontractorId: member.subcontractorId ?? undefined }
                      // Legacy direct-user row (added before Feature: person-first cards,
                      // no `people` row yet) — falls back to the original lazy-create-by-email path.
                      : (isSubcontractor ? { kind: "subcontractor", subcontractorId: member.subcontractorId } : { kind: "in_house" })
                  }
                  canManage={caps.canManageTeam}
                />
              )}
              {isSubcontractor && (
                <button
                  type="button"
                  onClick={() => openSubNotes(member.subcontractorId, companyLabel(member))}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                  title="Notes & reminders"
                >
                  <StickyNote className="w-3.5 h-3.5" />Notes
                </button>
              )}
              {isSubcontractor && (
                <button
                  type="button"
                  onClick={() => openSubDocs(member.subcontractorId, companyLabel(member))}
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
                  text: `${member.name}${isSubcontractor ? ` (${companyLabel(member)})` : ` (${member.role.replace(/_/g, " ")})`}${member.trades?.length ? `\nTrades: ${member.trades.join(", ")}` : ""}\nEmail: ${member.email ?? "N/A"}${member.phone ? `\nPhone: ${member.phone}` : ""}`,
                })}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                title="Share contact"
              >
                <Share2 className="w-3.5 h-3.5" />Share
              </button>
              {caps.canManageTeam && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget({ kind: "member", id: member.id, name: member.name, isPortal: !!member.personId })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Remove from project"
                >
                  <Trash2 className="w-3.5 h-3.5" />Remove
                </button>
              )}
            </div>
            {opts.showCompanyInline && badge}
            {!opts.showCompanyInline && isSubcontractor && member.complianceStatus === "ok" && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Covered by {companyLabel(member)} PLI</span>
            )}
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

        {member.personId && (
          <div className="pt-1 border-t border-border/50">
            <PersonCertifications personId={member.personId} canManage={caps.canManageTeam} />
          </div>
        )}

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

        {isSubcontractor && opts.showCompanyInline && (
          <InsuranceCertZone
            memberId={member.id}
            projectId={projectId}
            existingCertUrl={member.pliCertUrl ?? null}
            existingExpiryDate={member.pliExpiryDate ?? null}
            onSaved={() => queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] })}
          />
        )}
      </div>
    );
  }

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

                  // Group by firm; each group of 2+ gets a shared strip, a lone
                  // primary contact renders as a single self-sufficient card.
                  const bySub = new Map<string, any[]>();
                  const standalone: any[] = [];
                  for (const m of tradeMembers) {
                    if (m.subcontractorId) bySub.set(m.subcontractorId, [...(bySub.get(m.subcontractorId) ?? []), m]);
                    else standalone.push(m);
                  }

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
                          {[...bySub.entries()].map(([subId, groupMembers]) => {
                            if (groupMembers.length === 1) {
                              return (
                                <div key={subId} className="contents">
                                  {renderPersonCard(groupMembers[0], { showCompanyInline: true })}
                                  {caps.canManageTeam && (
                                    <div className="flex items-start">
                                      <AddPersonInline subcontractorId={subId} onAdded={personId => addPersonToProject(personId)} />
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            const first = groupMembers[0];
                            const label = companyLabel(first);
                            return (
                              <div key={subId} className="md:col-span-2 space-y-3">
                                <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-lg bg-muted/40 border border-border/60">
                                  <Building2 className="w-4 h-4 text-orange-500 shrink-0" />
                                  <span className="font-semibold text-sm">{label}</span>
                                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{groupMembers.length} people</span>
                                  {complianceBadge(first.complianceStatus)}
                                  <div className="ml-auto flex items-center gap-2">
                                    {caps.canManageTeam && (
                                      <AddPersonInline subcontractorId={subId} onAdded={personId => addPersonToProject(personId)} />
                                    )}
                                    {caps.canManageTeam && (
                                      <button
                                        type="button"
                                        onClick={() => setRemoveTarget({
                                          kind: "company",
                                          id: subId,
                                          name: label,
                                          isPortal: groupMembers.some((m: any) => !!m.personId),
                                          peopleNames: groupMembers.map((m: any) => m.name),
                                        })}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                        title="Remove company from project"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />Remove company
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {groupMembers.map(m => renderPersonCard(m, { showCompanyInline: false }))}
                                </div>
                              </div>
                            );
                          })}
                          {standalone.map(m => renderPersonCard(m, { showCompanyInline: true }))}
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
