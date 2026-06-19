import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Building, MapPin, Calendar, Sparkles, AlertTriangle, CheckCircle2, Camera, Loader2, ClipboardCheck, Lock } from "lucide-react";
import { useListProjects, useCreateProject } from "@workspace/api-client-react";
import { useSubscription } from "@/contexts/subscription";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { formatDate } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";

const PLAN_LIMITS: Record<string, number> = { free: 1, solo: 1, team: 5, pro: Infinity };
const NEXT_PLAN: Record<string, { name: string; projects: string; price: string }> = {
  free:  { name: "Team", projects: "5 projects",        price: "£79/mo" },
  solo:  { name: "Team", projects: "5 projects",        price: "£79/mo" },
  team:  { name: "Pro",  projects: "Unlimited projects", price: "£149/mo" },
};

export default function ProjectsList() {
  const { data: projects, isLoading } = useListProjects();
  const createMutation = useCreateProject();
  const [, setLocation] = useLocation();
  const { isCancelled, tier, betaAccess } = useSubscription();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const caps = useCapabilities();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [search, setSearch] = useState("");
  const { register, handleSubmit, reset } = useForm();

  const planLimit = PLAN_LIMITS[tier] ?? 1;
  const nextPlan = NEXT_PLAN[tier];
  const atLimit = !isCancelled && !betaAccess && planLimit !== Infinity && (projects?.length ?? 0) >= planLimit;

  // Safety issue state
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyProjectId, setSafetyProjectId] = useState("");
  const [safetyDesc, setSafetyDesc] = useState("");
  const [safetyZone, setSafetyZone] = useState("");
  const [safetyPhotoUrl, setSafetyPhotoUrl] = useState<string | null>(null);
  const [safetySubmitting, setSafetySubmitting] = useState(false);
  const [safetyUploading, setSafetyUploading] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [safetyRefNum, setSafetyRefNum] = useState<string | null>(null);
  const safetyFileRef = useRef<HTMLInputElement>(null);

  const closeSafetyModal = useCallback(() => {
    setSafetyOpen(false); setSafetyProjectId(""); setSafetyDesc(""); setSafetyZone("");
    setSafetyPhotoUrl(null); setSafetyError(null); setSafetyRefNum(null);
  }, []);

  const uploadSafetyPhoto = useCallback(async (file: File) => {
    setSafetyUploading(true);
    const token = localStorage.getItem("sitesort_token");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    if (res.ok) { const { url } = await res.json(); setSafetyPhotoUrl(url); }
    setSafetyUploading(false);
  }, []);

  const submitSafetyIssue = useCallback(async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!safetyProjectId || !safetyDesc.trim()) { setSafetyError("Please select a project and describe the issue."); return; }
    setSafetySubmitting(true); setSafetyError(null);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/projects/${safetyProjectId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ category: "safety_concern", description: safetyDesc.trim(), zone: safetyZone.trim() || null, photoUrl: safetyPhotoUrl }),
    });
    if (res.ok) { const d = await res.json(); setSafetyRefNum(d.referenceNumber); }
    else setSafetyError("Failed to log safety issue. Please try again.");
    setSafetySubmitting(false);
  }, [isCancelled, toast, safetyProjectId, safetyDesc, safetyZone, safetyPhotoUrl]);

  // Auto-select project if only one active project (safety)
  useEffect(() => {
    if (safetyOpen && projects && !safetyProjectId) {
      const active = projects.filter((p: any) => p.status === "active");
      if (active.length === 1) setSafetyProjectId(active[0].id);
    }
  }, [safetyOpen, projects, safetyProjectId]);

  // ── Permit modal state ──
  const PERMIT_TYPES = ["CSCS Check", "IPAF Certificate", "Hot Works", "Working at Heights", "Scaffolding Inspection", "Confined Space Entry", "Excavation", "Electrical Isolation", "Demolition", "Asbestos", "Method Statement", "Other"];

  const [permitOpen, setPermitOpen] = useState(false);
  const [permitProjectId, setPermitProjectId] = useState("");
  const [permitType, setPermitType] = useState("Hot Work");
  const [permitDesc, setPermitDesc] = useState("");
  const [permitResponsibleId, setPermitResponsibleId] = useState("");
  const [permitStart, setPermitStart] = useState("");
  const [permitExpiry, setPermitExpiry] = useState("");
  const [permitSubmitting, setPermitSubmitting] = useState(false);
  const [permitError, setPermitError] = useState<string | null>(null);
  const [permitSuccess, setPermitSuccess] = useState(false);
  const [teamUsers, setTeamUsers] = useState<{ id: string; name: string; role: string }[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("sitesort_token");
    fetch("/api/messages/users", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : []).then(setTeamUsers);
  }, []);

  const closePermitModal = useCallback(() => {
    setPermitOpen(false); setPermitProjectId(""); setPermitType("Hot Works");
    setPermitDesc(""); setPermitResponsibleId(""); setPermitStart(""); setPermitExpiry("");
    setPermitError(null); setPermitSuccess(false);
  }, []);

  const submitPermit = useCallback(async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!permitProjectId || !permitDesc.trim() || !permitResponsibleId || !permitStart || !permitExpiry) {
      setPermitError("Please fill in all required fields."); return;
    }
    setPermitSubmitting(true); setPermitError(null);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/projects/${permitProjectId}/permits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ type: permitType, description: permitDesc.trim(), responsibleUserId: permitResponsibleId, startDate: permitStart, expiryDate: permitExpiry }),
    });
    if (res.ok) setPermitSuccess(true);
    else setPermitError("Failed to add permit. Please try again.");
    setPermitSubmitting(false);
  }, [isCancelled, toast, permitProjectId, permitType, permitDesc, permitResponsibleId, permitStart, permitExpiry]);

  // Auto-select project if only one active project (permit)
  useEffect(() => {
    if (permitOpen && projects && !permitProjectId) {
      const active = projects.filter((p: any) => p.status === "active");
      if (active.length === 1) setPermitProjectId(active[0].id);
    }
  }, [permitOpen, projects, permitProjectId]);

  // ── Photo upload modal state ──
  const PHOTO_CATEGORIES = [
    { value: "general", label: "General" },
    { value: "progress", label: "Progress" },
    { value: "snag", label: "Snag" },
    { value: "safety_concern", label: "Safety Concern" },
  ];

  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoProjectId, setPhotoProjectId] = useState("");
  const [photoCategory, setPhotoCategory] = useState("progress");
  const [photoDesc, setPhotoDesc] = useState("");
  const [photoZone, setPhotoZone] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoSubmitting, setPhotoSubmitting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoRefNum, setPhotoRefNum] = useState<string | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  const closePhotoModal = useCallback(() => {
    setPhotoOpen(false); setPhotoProjectId(""); setPhotoCategory("progress");
    setPhotoDesc(""); setPhotoZone(""); setPhotoUrl(null);
    setPhotoError(null); setPhotoRefNum(null);
  }, []);

  const uploadPhotoFile = useCallback(async (file: File) => {
    setPhotoUploading(true);
    const token = localStorage.getItem("sitesort_token");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    if (res.ok) { const { url } = await res.json(); setPhotoUrl(url); }
    setPhotoUploading(false);
  }, []);

  const submitPhoto = useCallback(async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!photoProjectId) { setPhotoError("Please select a project."); return; }
    setPhotoSubmitting(true); setPhotoError(null);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/projects/${photoProjectId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ category: photoCategory, description: photoDesc.trim() || null, zone: photoZone.trim() || null, photoUrl }),
    });
    if (res.ok) { const d = await res.json(); setPhotoRefNum(d.referenceNumber); }
    else setPhotoError("Failed to log photo. Please try again.");
    setPhotoSubmitting(false);
  }, [isCancelled, toast, photoProjectId, photoCategory, photoDesc, photoZone, photoUrl]);

  // Auto-select project if only one active project (photo)
  useEffect(() => {
    if (photoOpen && projects && !photoProjectId) {
      const active = projects.filter((p: any) => p.status === "active");
      if (active.length === 1) setPhotoProjectId(active[0].id);
    }
  }, [photoOpen, projects, photoProjectId]);

  // Auto-open create modal when navigated here (?new=1)
  useEffect(() => {
    if (caps.isLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      if (isLoading) return; // wait for project count before deciding
      window.history.replaceState({}, "", "/projects");
      if (isCancelled) setLocation("/settings?tab=billing");
      else if (atLimit) setShowUpgradeDialog(true);
      else if (caps.canManageProjects) setIsModalOpen(true);
    }
  }, [isCancelled, setLocation, caps.isLoading, caps.canManageProjects, atLimit, isLoading]);

  // Auto-open safety modal (?safety=1)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("safety") === "1") {
      if (caps.isLoading) return;
      window.history.replaceState({}, "", "/projects");
      if (isCancelled) setLocation("/settings?tab=billing");
      else if (caps.canLogPhoto) setSafetyOpen(true);
    }
  }, [isCancelled, setLocation, caps.isLoading, caps.canLogPhoto]);

  // Auto-open permit modal (?permit=1)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("permit") === "1") {
      if (caps.isLoading) return;
      window.history.replaceState({}, "", "/projects");
      if (isCancelled) setLocation("/settings?tab=billing");
      else if (caps.canManageCompliance) setPermitOpen(true);
    }
  }, [isCancelled, setLocation, caps.isLoading, caps.canManageCompliance]);

  // Auto-open photo upload modal (?photo=1)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("photo") === "1") {
      if (caps.isLoading) return;
      window.history.replaceState({}, "", "/projects");
      if (isCancelled) setLocation("/settings?tab=billing");
      else if (caps.canLogPhoto) setPhotoOpen(true);
    }
  }, [isCancelled, setLocation, caps.isLoading, caps.canLogPhoto]);

  // View photo log (?viewphoto=1) — go to first active project's photos tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("viewphoto") === "1" && projects) {
      window.history.replaceState({}, "", "/projects");
      const active = projects.filter((p: any) => p.status === "active");
      if (active.length === 1) setLocation(`/projects/${active[0].id}?tab=photos`);
    }
  }, [projects, setLocation]);

  // Open specific project by name (?openproject=<name>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nameQuery = params.get("openproject");
    if (!nameQuery || !projects) return;
    window.history.replaceState({}, "", "/projects");
    const q = nameQuery.toLowerCase();
    const match = projects.find((p: any) =>
      p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())
    );
    if (match) setLocation(`/projects/${match.id}`);
  }, [projects, setLocation]);

  const filteredProjects = projects?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.address.toLowerCase().includes(search.toLowerCase())
  );

  const onSubmit = async (data: any) => {
    setCreateError(null);
    try {
      const newProject = await createMutation.mutateAsync({ data });
      await queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      setIsModalOpen(false);
      reset();
      setLocation(`/projects/${(newProject as any).id}`);
    } catch (e: any) {
      if (e?.status === 403 && (e?.data as any)?.error === "plan_limit") {
        setIsModalOpen(false);
        reset();
        setShowUpgradeDialog(true);
        return;
      }
      setCreateError(e?.message ?? "Failed to create project. Please try again.");
    }
  };

  return (
    <SidebarLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage all your construction sites.</p>
        </div>
        {caps.canManageProjects && (
          <Button
            variant="accent"
            onClick={() => {
              if (isCancelled) { setLocation("/settings?tab=billing"); return; }
              if (atLimit) { setShowUpgradeDialog(true); return; }
              setIsModalOpen(true);
            }}
            title={isCancelled ? "Subscription ended — upgrade to create projects" : atLimit ? "Project limit reached — upgrade to add more" : undefined}
          >
            <Plus className="w-5 h-5 mr-2" /> New Project
          </Button>
        )}
      </div>

      <div className="bg-card border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search projects by name or address…"
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Mobile card list */}
        <div className="block lg:hidden divide-y">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-muted-foreground">Loading projects...</div>
          ) : filteredProjects?.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">No projects found.</div>
          ) : (
            filteredProjects?.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <div className="px-4 py-4 hover:bg-muted/30 transition-colors active:bg-muted/50">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="font-bold text-base leading-tight min-w-0 flex-1 truncate">{project.name}</div>
                    <Badge variant={project.status === 'active' ? 'success' : project.status === 'complete' ? 'secondary' : 'warning'} className="shrink-0 mt-0.5">
                      {project.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{project.address}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground mb-2">
                    <span><span className="font-medium text-foreground">Start:</span> {formatDate(project.startDate)}</span>
                    {(project as any).targetEndDate && (
                      <span><span className="font-medium text-foreground">End:</span> {formatDate((project as any).targetEndDate)}</span>
                    )}
                    <span>{project.memberCount} members</span>
                  </div>
                  {project.alertCount > 0 && (
                    <Badge variant="destructive" className="mb-2">{project.alertCount} Alerts</Badge>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${project.progressPercent ?? 0}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{project.progressPercent ?? 0}%</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-4 font-semibold">Project Name & Address</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Start Date</th>
                <th className="px-6 py-4 font-semibold">In House Team</th>
                <th className="px-6 py-4 font-semibold">Progress</th>
                <th className="px-6 py-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading projects...</td></tr>
              ) : filteredProjects?.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No projects found.</td></tr>
              ) : (
                filteredProjects?.map((project) => (
                  <tr
                    key={project.id}
                    onClick={() => setLocation(`/projects/${project.id}`)}
                    className="bg-card border-b hover:bg-muted/30 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4">
                      <div className="font-bold text-foreground text-base mb-1">{project.name}</div>
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        <MapPin className="w-3 h-3" /> {project.address}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={project.status === 'active' ? 'success' : project.status === 'complete' ? 'secondary' : 'warning'}>
                        {project.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                      {project.alertCount > 0 && (
                         <Badge variant="destructive" className="ml-2">{project.alertCount} Alerts</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">
                      {formatDate(project.startDate)}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {project.memberCount} members
                    </td>
                    <td className="px-6 py-4 min-w-[120px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                          <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${project.progressPercent ?? 0}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{project.progressPercent ?? 0}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="outline" size="sm" className="opacity-100 xl:opacity-0 xl:group-hover:opacity-100 transition-opacity">
                        View Site
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-destructive" /> Project limit reached
          </DialogTitle>
        </DialogHeader>
        <div className="my-3 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary" className="capitalize">{tier || "Free"} plan</Badge>
            <span className="text-muted-foreground">
              {projects?.length ?? 0} of {planLimit} project{planLimit !== 1 ? "s" : ""} used
            </span>
          </div>
          {nextPlan && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-semibold text-primary">{nextPlan.name} plan — {nextPlan.projects}</p>
              <p className="text-muted-foreground mt-0.5">{nextPlan.price} · More projects, team collaboration, advanced compliance &amp; more.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowUpgradeDialog(false)}>Maybe later</Button>
          <Button variant="accent" onClick={() => { setShowUpgradeDialog(false); setLocation("/settings?tab=billing"); }} className="gap-2">
            <Sparkles className="w-4 h-4" /> Upgrade plan
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={isModalOpen} onOpenChange={v => { setIsModalOpen(v); if (!v) setCreateError(null); }}>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
        </DialogHeader>
        {createError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            {createError}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1 block">Project Name</label>
            <Input {...register("name", { required: true })} placeholder="e.g. Riverside Apartments" icon={<Building className="w-4 h-4"/>} />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Site Address</label>
            <Input {...register("address", { required: true })} placeholder="123 River Road, London" icon={<MapPin className="w-4 h-4"/>} />
          </div>
          <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
            <div>
              <label className="text-sm font-semibold mb-1 block">Start Date</label>
              <Input type="date" {...register("startDate", { required: true })} icon={<Calendar className="w-4 h-4"/>} />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1 block">Target End Date</label>
              <Input type="date" {...register("targetEndDate")} icon={<Calendar className="w-4 h-4"/>} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={createMutation.isPending}>Create Project</Button>
          </DialogFooter>
        </form>
      </Dialog>
      {/* Hidden file input for safety photo */}
      <input ref={safetyFileRef} type="file" accept="image/*,.pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadSafetyPhoto(f); e.target.value = ""; }} />

      {/* Hidden file input for photo upload */}
      <input ref={photoFileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhotoFile(f); e.target.value = ""; }} />

      {/* Upload Photo modal */}
      <Dialog open={photoOpen} onOpenChange={open => { if (!open) closePhotoModal(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Log Photo
          </DialogTitle>
        </DialogHeader>

        {photoRefNum ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="font-semibold text-emerald-600">Photo logged</p>
            <p className="text-sm text-muted-foreground">Reference: <span className="font-mono font-bold">{photoRefNum}</span></p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Project</label>
              <select value={photoProjectId} onChange={e => setPhotoProjectId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select a project…</option>
                {projects?.filter((p: any) => p.status === "active").map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <select value={photoCategory} onChange={e => setPhotoCategory(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                {PHOTO_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <div className="relative">
                <textarea
                  value={photoDesc}
                  onChange={e => setPhotoDesc(e.target.value)}
                  placeholder="Describe what the photo shows…"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Zone / Location <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input value={photoZone} onChange={e => setPhotoZone(e.target.value)} placeholder="e.g. Level 3, North wall" />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Photo</label>
              {photoUrl ? (
                <div className="flex items-center gap-2">
                  <img src={photoUrl} alt="preview" className="w-16 h-16 object-cover rounded-lg border" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Photo attached</span>
                    <button onClick={() => setPhotoUrl(null)} className="text-xs text-muted-foreground hover:text-destructive text-left">Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={photoUploading} onClick={() => photoFileRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-primary border border-dashed border-primary/40 rounded-lg px-4 py-2.5 hover:bg-primary/5 transition-colors w-full justify-center">
                  {photoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {photoUploading ? "Uploading…" : "Choose photo"}
                </button>
              )}
            </div>

            {photoError && <p className="text-sm text-destructive">{photoError}</p>}
          </div>
        )}

        <DialogFooter>
          {photoRefNum ? (
            <Button variant="accent" onClick={closePhotoModal}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={closePhotoModal}>Cancel</Button>
              <Button variant="accent" onClick={submitPhoto} disabled={photoSubmitting}>
                {photoSubmitting ? "Saving…" : "Log Photo"}
              </Button>
            </>
          )}
        </DialogFooter>
      </Dialog>

      {/* Add Permit modal */}
      <Dialog open={permitOpen} onOpenChange={open => { if (!open) closePermitModal(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            Add Permit
          </DialogTitle>
        </DialogHeader>

        {permitSuccess ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="font-semibold text-emerald-600">Permit added successfully</p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Project</label>
              <select value={permitProjectId} onChange={e => setPermitProjectId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select a project…</option>
                {projects?.filter((p: any) => p.status === "active").map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Permit Type</label>
              <select value={permitType} onChange={e => setPermitType(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                {PERMIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <div className="relative">
                <textarea
                  value={permitDesc}
                  onChange={e => setPermitDesc(e.target.value)}
                  placeholder="Describe the work covered by this permit…"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Responsible Person</label>
              <select value={permitResponsibleId} onChange={e => setPermitResponsibleId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select person…</option>
                {teamUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role.replace(/_/g, " ")})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Start Date</label>
                <Input type="date" value={permitStart} onChange={e => setPermitStart(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Expiry Date</label>
                <Input type="date" value={permitExpiry} onChange={e => setPermitExpiry(e.target.value)} />
              </div>
            </div>

            {permitError && <p className="text-sm text-destructive">{permitError}</p>}
          </div>
        )}

        <DialogFooter>
          {permitSuccess ? (
            <Button variant="accent" onClick={closePermitModal}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={closePermitModal}>Cancel</Button>
              <Button variant="accent" onClick={submitPermit} disabled={permitSubmitting}>
                {permitSubmitting ? "Saving…" : "Add Permit"}
              </Button>
            </>
          )}
        </DialogFooter>
      </Dialog>

      {/* Log Safety Issue modal */}
      <Dialog open={safetyOpen} onOpenChange={open => { if (!open) closeSafetyModal(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Log Safety Issue
          </DialogTitle>
        </DialogHeader>

        {safetyRefNum ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="font-semibold text-emerald-600">Safety issue logged</p>
            <p className="text-sm text-muted-foreground">Reference: <span className="font-mono font-bold">{safetyRefNum}</span></p>
            <p className="text-xs text-muted-foreground text-center">Project managers have been notified.</p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Project</label>
              <select value={safetyProjectId} onChange={e => setSafetyProjectId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select a project…</option>
                {projects?.filter((p: any) => p.status === "active").map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <div className="relative">
                <textarea
                  value={safetyDesc}
                  onChange={e => setSafetyDesc(e.target.value)}
                  placeholder="Describe the hazard or safety concern…"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Zone / Location <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input value={safetyZone} onChange={e => setSafetyZone(e.target.value)} placeholder="e.g. Level 2, East stairwell" />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Photo <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              {safetyPhotoUrl ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Photo attached</span>
                  <button onClick={() => setSafetyPhotoUrl(null)} className="ml-2 text-xs text-muted-foreground hover:text-destructive">Remove</button>
                </div>
              ) : (
                <button type="button" disabled={safetyUploading} onClick={() => safetyFileRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-primary border border-dashed border-primary/40 rounded-lg px-4 py-2.5 hover:bg-primary/5 transition-colors w-full justify-center">
                  {safetyUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {safetyUploading ? "Uploading…" : "Attach photo"}
                </button>
              )}
            </div>

            {safetyError && <p className="text-sm text-destructive">{safetyError}</p>}
          </div>
        )}

        <DialogFooter>
          {safetyRefNum ? (
            <Button variant="accent" onClick={closeSafetyModal}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={closeSafetyModal}>Cancel</Button>
              <Button variant="accent" onClick={submitSafetyIssue} disabled={safetySubmitting}>
                {safetySubmitting ? "Logging…" : "Log Safety Issue"}
              </Button>
            </>
          )}
        </DialogFooter>
      </Dialog>
    </SidebarLayout>
  );
}
