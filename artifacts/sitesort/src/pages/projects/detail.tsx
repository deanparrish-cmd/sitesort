import { useState } from "react";
import { useRoute } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { 
  useGetProject, 
  useListDocuments, 
  useListProjectMembers, 
  useUploadDocument,
  DocumentType,
  UploadDocumentRequestType
} from "@workspace/api-client-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useForm } from "react-hook-form";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id || "";
  
  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: documents, refetch: refetchDocs } = useListDocuments(projectId, undefined, { query: { enabled: !!projectId } });
  const { data: members } = useListProjectMembers(projectId, { query: { enabled: !!projectId } });
  
  const uploadMutation = useUploadDocument();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const { register, handleSubmit, reset, watch } = useForm();
  
  const [selectedDocType, setSelectedDocType] = useState<string>("all");

  const onUpload = async (data: any) => {
    try {
      await uploadMutation.mutateAsync({ 
        projectId, 
        data: {
          name: data.name,
          type: data.type as UploadDocumentRequestType,
          fileUrl: data.fileUrl || "https://example.com/dummy.pdf", // MVP placeholder
          fileSize: 1024 * 1024 * 2.5, // 2.5MB dummy
          requiresAcknowledgment: data.requiresAcknowledgment,
        }
      });
      setIsUploadOpen(false);
      reset();
      refetchDocs();
    } catch (e) {
      console.error(e);
    }
  };

  if (projectLoading) return <SidebarLayout><div className="animate-pulse h-32 bg-muted rounded-xl"></div></SidebarLayout>;
  if (!project) return <SidebarLayout>Project not found</SidebarLayout>;

  return (
    <SidebarLayout>
      {/* Project Header */}
      <div className="bg-card border rounded-2xl p-6 md:p-8 shadow-sm mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-display font-extrabold text-primary">{project.name}</h1>
                <Badge variant={project.status === 'active' ? 'success' : 'secondary'} className="text-sm">
                  {project.status.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-muted-foreground">
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4"/> {project.address}</span>
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4"/> Started {formatDate(project.startDate)}</span>
              </div>
            </div>
            <Button variant="outline">Edit Details</Button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/50">
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Progress</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-success" style={{ width: `${project.progressPercent}%` }}></div>
                </div>
                <span className="font-bold">{project.progressPercent}%</span>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Team Size</p>
              <p className="font-bold text-lg">{project.memberCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Target End</p>
              <p className="font-bold text-lg">{formatDate(project.targetEndDate)}</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="documents">
        <TabsList className="mb-6 w-full justify-start overflow-x-auto bg-transparent border-b rounded-none p-0 h-auto">
          {["overview", "documents", "team", "photos", "permits"].map(tab => (
            <TabsTrigger 
              key={tab} 
              value={tab} 
              className="capitalize px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
            >
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
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
        </TabsContent>

        <TabsContent value="documents">
          <div className="flex justify-between items-center mb-6">
            <div className="flex gap-2 overflow-x-auto pb-2">
              <Button 
                variant={selectedDocType === 'all' ? 'default' : 'secondary'} 
                size="sm" onClick={() => setSelectedDocType('all')}
              >All Docs</Button>
              {Object.values(DocumentType).map(type => (
                <Button 
                  key={type}
                  variant={selectedDocType === type ? 'default' : 'secondary'} 
                  size="sm" 
                  onClick={() => setSelectedDocType(type)}
                  className="capitalize"
                >
                  {type.replace('_', ' ')}s
                </Button>
              ))}
            </div>
            <Button variant="accent" onClick={() => setIsUploadOpen(true)}>
              <Upload className="w-4 h-4 mr-2" /> Upload Document
            </Button>
          </div>

          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                <tr>
                  <th className="px-6 py-4 font-semibold">Document</th>
                  <th className="px-6 py-4 font-semibold">Type</th>
                  <th className="px-6 py-4 font-semibold">Status / Ver</th>
                  <th className="px-6 py-4 font-semibold">Distribution</th>
                  <th className="px-6 py-4 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {documents?.filter(d => selectedDocType === 'all' || d.type === selectedDocType).map(doc => {
                  const isSuperseded = doc.status === 'superseded';
                  return (
                    <tr key={doc.id} className={cn("border-b transition-colors", isSuperseded ? "bg-muted/30 opacity-70" : "hover:bg-muted/10")}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", isSuperseded ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <p className={cn("font-bold text-base", isSuperseded ? "line-through text-muted-foreground" : "text-foreground")}>{doc.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(doc.fileSize)} • By {doc.uploaderName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 capitalize">{doc.type.replace('_', ' ')}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">v{doc.version}</span>
                          {isSuperseded ? (
                            <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/> SUPERSEDED</Badge>
                          ) : (
                            <Badge variant="success" className="text-[10px]">CURRENT</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1 text-success"><CheckCircle2 className="w-4 h-4"/> {doc.distributionSummary.acknowledged}</div>
                          <div className="flex items-center gap-1 text-primary"><Eye className="w-4 h-4"/> {doc.distributionSummary.viewed}</div>
                          <div className="flex items-center gap-1 text-muted-foreground"><EyeOff className="w-4 h-4"/> {doc.distributionSummary.pending}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {formatDate(doc.createdAt)}
                      </td>
                    </tr>
                  )
                })}
                {documents?.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No documents uploaded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
        
        {/* MVP Placeholder for other tabs */}
        <TabsContent value="team">
          <div className="bg-card p-8 rounded-xl border text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-bold">Team Roster</h3>
            <p className="text-muted-foreground">Manage project members and subcontractors here.</p>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onUpload)} className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1 block">Document Name</label>
            <Input {...register("name", { required: true })} placeholder="e.g. Ground Floor Plan" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Category</label>
            <select {...register("type")} className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm">
              <option value="drawing">Drawing</option>
              <option value="method_statement">Method Statement (RAMS)</option>
              <option value="permit">Permit</option>
              <option value="safety">Safety Document</option>
              <option value="general">General</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">File URL (MVP)</label>
            <Input {...register("fileUrl")} placeholder="https://..." />
          </div>
          <div className="flex items-center gap-2 p-4 bg-muted/30 border rounded-lg mt-4">
            <input type="checkbox" id="reqAck" {...register("requiresAcknowledgment")} className="w-4 h-4 text-accent rounded border-input focus:ring-accent" />
            <label htmlFor="reqAck" className="text-sm font-medium">Require team members to digitally sign-off</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={uploadMutation.isPending}>Upload</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </SidebarLayout>
  );
}
