import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function ProjectDialogs() {
  const {
    project,
    updateMutation,
    isEditOpen,
    setIsEditOpen,
    editError,
    setEditError,
    editRegister,
    editHandleSubmit,
    fromDirOpen,
    setFromDirOpen,
    dirPeople,
    dirSubsLoading,
    dirSearch,
    setDirSearch,
    linkingSubId,
    addPersonToProject,
    onEditSubmit,
  } = useDetail();

  return (
    <>
      <Dialog open={isEditOpen} onOpenChange={v => { setIsEditOpen(v); if (!v) setEditError(null); }}>
        <DialogHeader>
          <DialogTitle>Edit Project Details</DialogTitle>
        </DialogHeader>
        {editError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            {editError}
          </div>
        )}
        <form onSubmit={editHandleSubmit(onEditSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1 block">Project Name</label>
            <Input {...editRegister("name", { required: true })} placeholder="e.g. Riverside Apartments" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Site Address</label>
            <Input {...editRegister("address", { required: true })} placeholder="123 River Road, London" icon={<MapPin className="w-4 h-4" />} />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Status</label>
            <select {...editRegister("status")} className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary">
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Target End Date</label>
            <Input type="date" {...editRegister("targetEndDate")} icon={<Calendar className="w-4 h-4" />} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={updateMutation.isPending}>Save Changes</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={fromDirOpen} onOpenChange={v => { if (!v) setFromDirOpen(false); }}>
        <DialogHeader>
          <DialogTitle>Add from Contacts Directory</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name or company…"
              className="pl-9"
              value={dirSearch}
              onChange={e => setDirSearch(e.target.value)}
            />
          </div>
          {dirSubsLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : (() => {
            const q = dirSearch.toLowerCase();
            const filtered = (dirPeople as any[]).filter(p =>
              !q || p.name.toLowerCase().includes(q) || (p.companyName ?? "").toLowerCase().includes(q)
            );
            // Group by firm for scannability — still one row (and one Add) per person.
            const groups = new Map<string, any[]>();
            for (const p of filtered) {
              const key = p.subcontractorId ? (p.companyName ?? "Unknown") : "In-house";
              groups.set(key, [...(groups.get(key) ?? []), p]);
            }
            return filtered.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">
                {dirPeople.length === 0 ? "No contacts in your directory yet." : "No results match your search."}
              </p>
            ) : (
              <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                {[...groups.entries()].map(([groupName, people]) => (
                  <div key={groupName}>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                      {people[0].contactType === "self_employed" ? "Self-employed" : groupName}
                    </p>
                    <div className="space-y-2">
                      {people.map((person: any) => {
                        const alreadyAdded = !!person.onProject;
                        return (
                          <div key={person.id} className={cn(
                            "flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors",
                            alreadyAdded ? "opacity-50 bg-muted/50" : "hover:bg-muted/30"
                          )}>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{person.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {person.roleTitle ? `${person.roleTitle}` : (person.subcontractorId ? "" : "In-house")}
                                {person.trades?.length ? ` · ${person.trades.join(", ")}` : ""}
                              </p>
                            </div>
                            {alreadyAdded ? (
                              <span className="text-xs text-muted-foreground shrink-0 font-medium">Already on project</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="accent"
                                disabled={linkingSubId === person.id}
                                onClick={() => addPersonToProject(person.id)}
                              >
                                {linkingSubId === person.id ? "Adding…" : "Add"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFromDirOpen(false)}>Done</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
