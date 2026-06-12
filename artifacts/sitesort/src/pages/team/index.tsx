import { useState, useEffect } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users, Search, Mail, Phone, ShieldCheck, Share2, MessageCircle,
  MessageSquare, StickyNote, Send, Loader2, Clock, UserPlus, FolderOpen, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  createdAt: string;
  lastActiveAt: string | null;
};

type UserNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

type Project = {
  id: string;
  name: string;
};

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 border-purple-200",
  project_manager: "bg-blue-100 text-blue-700 border-blue-200",
  site_worker: "bg-emerald-100 text-emerald-700 border-emerald-200",
  subcontractor: "bg-orange-100 text-orange-700 border-orange-200",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge className={cn("text-[10px] capitalize border", ROLE_STYLES[role] ?? "bg-muted text-muted-foreground border-border")}>
      {role.replace(/_/g, " ")}
    </Badge>
  );
}

function formatLastActive(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Never";
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatNoteTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function authHeaders() {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

export default function TeamPage() {
  const caps = useCapabilities();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add member dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("site_worker");
  const [addPhone, setAddPhone] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

  // Notes dialog state
  const [notesTarget, setNotesTarget] = useState<TeamMember | null>(null);
  const [notesList, setNotesList] = useState<UserNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/users", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .finally(() => setLoading(false));
  }, []);

  async function openNotes(member: TeamMember) {
    setNotesTarget(member);
    setNotesList([]);
    setNoteDraft("");
    setNotesLoading(true);
    const res = await fetch(`/api/users/${member.id}/notes`, { headers: authHeaders() });
    if (res.ok) setNotesList(await res.json());
    setNotesLoading(false);
  }

  async function addNote() {
    if (!notesTarget || !noteDraft.trim()) return;
    setNoteSubmitting(true);
    const res = await fetch(`/api/users/${notesTarget.id}/notes`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteDraft.trim() }),
    });
    if (res.ok) {
      const created = await res.json();
      setNotesList(prev => [created, ...prev]);
      setNoteDraft("");
    }
    setNoteSubmitting(false);
  }

  function closeNotes() {
    setNotesTarget(null);
    setNotesList([]);
    setNoteDraft("");
  }

  async function openAdd() {
    setAddName(""); setAddEmail(""); setAddRole("site_worker"); setAddPhone(""); setAddError("");
    setSelectedProjects(new Set());
    setAddOpen(true);
    const res = await fetch("/api/projects", { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      setProjects((data.projects ?? data).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    }
  }

  function toggleProject(id: string) {
    setSelectedProjects(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function addMember() {
    if (!addName.trim() || !addEmail.trim()) { setAddError("Name and email are required."); return; }
    setAddSubmitting(true);
    setAddError("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: addName.trim(), email: addEmail.trim(), role: addRole, phone: addPhone.trim() || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddError(data.message ?? "Failed to add team member.");
      setAddSubmitting(false);
      return;
    }
    const created = await res.json();
    setMembers(prev => [...prev, created]);
    // Link to selected projects (fire-and-forget, best effort)
    await Promise.allSettled(
      Array.from(selectedProjects).map(projectId =>
        fetch(`/api/projects/${projectId}/members`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ userId: created.id, role: addRole }),
        })
      )
    );
    setAddOpen(false);
    setAddSubmitting(false);
  }

  const q = search.toLowerCase();
  const filtered = members.filter(m =>
    !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
  );

  const byRole = (role: string) => filtered.filter(m => m.role === role);
  const ROLES = ["admin", "project_manager", "site_worker", "subcontractor"];
  const otherRoles = Array.from(new Set(filtered.map(m => m.role).filter(r => !ROLES.includes(r))));

  return (
    <SidebarLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">In House Team</h1>
          <p className="text-muted-foreground">All staff and users in your company account.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground bg-muted px-3 py-1.5 rounded-full border">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
          {caps.canManageTeam && (
            <Button variant="accent" onClick={openAdd}>
              <UserPlus className="w-4 h-4 mr-2" /> Add Team Member
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm mb-8">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name, email or role…"
          className="pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-36 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="font-semibold text-muted-foreground">{q ? "No results match your search." : "No team members found."}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {[...ROLES, ...otherRoles].map(role => {
            const group = byRole(role);
            if (group.length === 0) return null;
            return (
              <section key={role}>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-bold text-sm uppercase tracking-wide text-muted-foreground capitalize">{role.replace(/_/g, " ")}s</h2>
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{group.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map(m => {
                    const cleanPhone = m.phone?.replace(/\D/g, "") ?? null;
                    return (
                      <Card key={m.id} className="p-4 hover:shadow-md transition-shadow">
                        {/* Header row: avatar + name + role badge */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="font-extrabold text-primary text-sm">
                              {m.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm truncate">{m.name}</p>
                            <RoleBadge role={m.role} />
                          </div>
                        </div>

                        {/* Contact details */}
                        <div className="space-y-1 mb-3">
                          <a href={`mailto:${m.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                            <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{m.email}</span>
                          </a>
                          {m.phone && (
                            <a href={`tel:${m.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                              <Phone className="w-3 h-3 shrink-0" /><span className="truncate">{m.phone}</span>
                            </a>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center justify-between gap-1 border-t pt-2.5">
                          <div className="flex items-center gap-0.5">
                            {m.phone && (
                              <>
                                <a
                                  href={`tel:${m.phone}`}
                                  title={`Call ${m.phone}`}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                >
                                  <Phone className="w-4 h-4" />
                                </a>
                                <a
                                  href={`sms:${m.phone}`}
                                  title={`Text ${m.phone}`}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                >
                                  <MessageSquare className="w-4 h-4" />
                                </a>
                                <a
                                  href={`https://wa.me/${cleanPhone}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`WhatsApp ${m.phone}`}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-[#25D366] hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors"
                                >
                                  <WhatsAppIcon className="w-4 h-4" />
                                </a>
                              </>
                            )}
                            <a
                              href={`mailto:${m.email}`}
                              title={`Email ${m.email}`}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            >
                              <Mail className="w-4 h-4" />
                            </a>
                          </div>

                          <div className="flex items-center gap-0.5">
                            {/* Notes */}
                            <button
                              onClick={() => openNotes(m)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                              title="Notes & reminders"
                            >
                              <StickyNote className="w-4 h-4" />
                            </button>

                            {/* Share */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Share contact">
                                  <Share2 className="w-4 h-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => {
                                    const subject = encodeURIComponent(`Contact – ${m.name}`);
                                    const body = encodeURIComponent(`Hi,\n\nHere are the contact details for ${m.name}:\n\nRole: ${m.role.replace(/_/g, " ")}\nEmail: ${m.email}${m.phone ? `\nPhone: ${m.phone}` : ""}`);
                                    window.open(`mailto:?subject=${subject}&body=${body}`);
                                  }}
                                >
                                  <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={() => {
                                    const text = encodeURIComponent(`${m.name} (${m.role.replace(/_/g, " ")})\nEmail: ${m.email}${m.phone ? `\nPhone: ${m.phone}` : ""}`);
                                    window.open(`https://wa.me/?text=${text}`, "_blank");
                                  }}
                                >
                                  <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        <p className="text-[10px] text-muted-foreground/60 mt-2.5">Last active: {formatLastActive(m.lastActiveAt)}</p>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Add Team Member dialog */}
      <Dialog open={addOpen} onOpenChange={open => { if (!open) setAddOpen(false); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" /> Add Team Member
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">An invitation email with login credentials will be sent automatically.</p>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Full name <span className="text-destructive">*</span></label>
              <Input value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Jane Smith" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Email <span className="text-destructive">*</span></label>
              <Input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Role</label>
              <select
                value={addRole}
                onChange={e => setAddRole(e.target.value)}
                className="w-full h-11 rounded-lg border-2 border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:border-primary"
              >
                <option value="admin">Admin</option>
                <option value="project_manager">Project Manager</option>
                <option value="site_worker">Site Worker</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Phone <span className="text-muted-foreground text-xs">(optional)</span></label>
              <Input type="tel" value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="+44 7700 900000" />
            </div>
            {projects.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" /> Add to projects <span className="text-muted-foreground text-xs">(optional)</span>
                </label>
                <div className="rounded-lg border bg-muted/30 divide-y max-h-44 overflow-y-auto">
                  {projects.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProject(p.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/60 transition-colors text-left"
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                        selectedProjects.has(p.id) ? "bg-primary border-primary" : "border-input bg-background"
                      )}>
                        {selectedProjects.has(p.id) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </div>
                      <span className="text-sm truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
                {selectedProjects.size > 0 && (
                  <p className="text-xs text-muted-foreground mt-1.5">{selectedProjects.size} project{selectedProjects.size !== 1 ? "s" : ""} selected</p>
                )}
              </div>
            )}
          </div>
          {addError && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{addError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="accent" onClick={addMember} disabled={addSubmitting || !addName.trim() || !addEmail.trim()}>
            {addSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending invite…</> : <><UserPlus className="w-3.5 h-3.5 mr-1.5" />Add & Invite</>}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Notes dialog */}
      <Dialog open={!!notesTarget} onOpenChange={open => { if (!open) closeNotes(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-amber-600" /> Notes & Reminders
          </DialogTitle>
        </DialogHeader>
        {notesTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {notesTarget.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{notesTarget.name}</p>
                <p className="text-xs text-muted-foreground truncate capitalize">{notesTarget.role.replace(/_/g, " ")}</p>
              </div>
            </div>

            <div className="space-y-2">
              <textarea
                placeholder="e.g. Discussed H&S responsibilities on site visit…"
                rows={3}
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); addNote(); } }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex justify-end">
                <Button variant="accent" size="sm" onClick={addNote} disabled={noteSubmitting || !noteDraft.trim()}>
                  {noteSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Send className="w-3.5 h-3.5 mr-1.5" />Add Note</>}
                </Button>
              </div>
            </div>

            <div className="border-t pt-3 max-h-72 overflow-y-auto -mr-1 pr-1">
              {notesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : notesList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <StickyNote className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notesList.map(n => (
                    <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-[13px] text-foreground whitespace-pre-wrap break-words mb-1">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />{formatNoteTime(n.createdAt)} · {n.authorName}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={closeNotes}>Close</Button>
        </DialogFooter>
      </Dialog>
    </SidebarLayout>
  );
}
