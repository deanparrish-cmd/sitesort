import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Building, MapPin, Calendar, Mic, MicOff } from "lucide-react";
import { useListProjects, useCreateProject } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { formatDate, cn } from "@/lib/utils";

export default function ProjectsList() {
  const { data: projects, isLoading } = useListProjects();
  const createMutation = useCreateProject();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { register, handleSubmit, reset } = useForm();

  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const voiceSupported = typeof window !== "undefined" && !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  function toggleVoiceSearch() {
    if (listening) { recognitionRef.current?.stop(); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onstart = () => setListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join("");
      setSearch(transcript);
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    rec.start();
    recognitionRef.current = rec;
  }

  const filteredProjects = projects?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.address.toLowerCase().includes(search.toLowerCase())
  );

  const onSubmit = async (data: any) => {
    setCreateError(null);
    try {
      await createMutation.mutateAsync({ data });
      await queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      setIsModalOpen(false);
      reset();
      setLocation("/dashboard");
    } catch (e: any) {
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
        <Button variant="accent" onClick={() => setIsModalOpen(true)}>
          <Plus className="w-5 h-5 mr-2" /> New Project
        </Button>
      </div>

      <div className="bg-card border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={listening ? "Listening…" : "Search projects by name or address…"}
              className={cn("pl-9", voiceSupported ? "pr-10" : "", listening && "border-orange-400 ring-1 ring-orange-400/60")}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoiceSearch}
                title={listening ? "Stop listening" : "Search by voice"}
                className={cn(
                  "absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors",
                  listening ? "text-orange-500 animate-pulse" : "text-muted-foreground hover:text-primary"
                )}
              >
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-4 font-semibold">Project Name & Address</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Start Date</th>
                <th className="px-6 py-4 font-semibold">Team</th>
                <th className="px-6 py-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading projects...</td></tr>
              ) : filteredProjects?.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No projects found.</td></tr>
              ) : (
                filteredProjects?.map((project) => (
                  <tr key={project.id} className="bg-card border-b hover:bg-muted/30 transition-colors group">
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
                    <td className="px-6 py-4 text-right">
                      <Link href={`/projects/${project.id}`}>
                        <Button variant="outline" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          View Site
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
          <div className="grid grid-cols-2 gap-4">
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
    </SidebarLayout>
  );
}
