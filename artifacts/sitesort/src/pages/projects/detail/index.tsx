import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProjectTeamActivity, RecentActivityGlance } from "../team-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useProjectDetailState } from "./use-project-detail";
import { ProjectDetailProvider, useDetail, type ProjectDetailReady } from "./context";
import { buildManagementTabs, buildActivityTabs } from "./tab-config";
import { OverviewTab } from "./tabs/overview-tab";
import { ProgressTab } from "./tabs/progress-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { TeamTab } from "./tabs/team-tab";
import { IssuesTab } from "./tabs/issues-tab";
import { ReportsTab } from "./tabs/reports-tab";
import { PermitsTab } from "./tabs/permits-tab";
import { FinancesTab } from "./tabs/finances-tab";
import { QrTab } from "./tabs/qr-tab";
import { CheckinsTab } from "./tabs/checkins-tab";
import { CloseoutTab } from "./tabs/closeout-tab";
import { CloseoutDialog } from "./dialogs/closeout-dialog";
import { ReportDialog } from "./dialogs/report-dialog";
import { DocumentDialogs } from "./dialogs/document-dialogs";
import { ProjectDialogs } from "./dialogs/project-dialogs";
import { ShareAndNoteDialogs } from "./dialogs/share-and-note-dialogs";
import { TeamDialogs } from "./dialogs/team-dialogs";
import { PermitDialogs } from "./dialogs/permit-dialogs";
import { PhotoOverlay } from "./dialogs/photo-overlay";

export default function ProjectDetail() {
  const state = useProjectDetailState();

  if (state.projectLoading) return <SidebarLayout><div className="animate-pulse h-32 bg-muted rounded-xl"></div></SidebarLayout>;
  if (!state.project) return <SidebarLayout>Project not found</SidebarLayout>;

  return (
    <ProjectDetailProvider value={state as ProjectDetailReady}>
      <ProjectDetailInner />
    </ProjectDetailProvider>
  );
}

function ProjectDetailInner() {
  const {
    projectId,
    project,
    documents,
    permits,
    photos,
    checkins,
    reports,
    activeTab,
    openTab,
    caps,
    closeout,
    openEdit,
    generateReport,
  } = useDetail();

  return (
    <SidebarLayout>
      {/* Project Header */}
      <div className="bg-card border rounded-2xl p-6 md:p-8 shadow-sm mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2 min-w-0">
                <h1 className="text-3xl md:text-4xl font-display font-extrabold text-primary min-w-0 break-words">{project.name}</h1>
                <Badge variant={project.status === 'active' ? 'success' : 'secondary'} className="text-sm shrink-0">
                  {project.status.toUpperCase()}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground min-w-0">
                <span className="flex items-center gap-1 min-w-0"><MapPin className="w-4 h-4 shrink-0"/><span className="truncate">{project.address}</span></span>
                <span className="flex items-center gap-1 whitespace-nowrap shrink-0"><Calendar className="w-4 h-4"/> Started {formatDate(project.startDate)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={generateReport}>
                <FileDown className="w-4 h-4 mr-2" /> Export Report
              </Button>
              {caps.canManageProjects && (
                <Button variant="outline" onClick={openEdit}>Edit Details</Button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/50">
            <button type="button" onClick={() => openTab("progress")} className="group text-left min-w-0 rounded-lg transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">Progress <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" /></p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-success" style={{ width: `${project.progressPercent}%` }}></div>
                </div>
                <span className="font-bold">{project.progressPercent}%</span>
              </div>
            </button>
            <button type="button" onClick={() => openTab("team")} className="group text-left min-w-0 rounded-lg transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">Team Size <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" /></p>
              <p className="font-bold text-lg">{project.memberCount}</p>
            </button>
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Target End</p>
              <p className="font-bold text-lg">{formatDate(project.targetEndDate)}</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={t => openTab(t)}>
        <TabsList className="mb-6 w-full h-auto flex flex-wrap justify-start gap-1.5 bg-muted p-1.5 rounded-xl">
          {/* Group 1: Project management */}
          {buildManagementTabs(caps, photos.filter(p => (p.category === "snag" || p.category === "safety_concern") && (!p.status || p.status === "open")).length).map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 sm:flex-none justify-center rounded-lg py-2 px-3 sm:px-4 text-sm whitespace-nowrap">
              {tab.label}
            </TabsTrigger>
          ))}
          {/* Divider */}
          <div className="w-px self-stretch bg-border/60 mx-0.5 my-0.5" />
          {/* Group 2: Site activity */}
          {buildActivityTabs(caps, checkins.length).map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 sm:flex-none justify-center rounded-lg py-2 px-3 sm:px-4 text-sm whitespace-nowrap">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <OverviewTab />
        <ProgressTab />
        <DocumentsTab />
        <TeamTab />
        <IssuesTab />
        <ReportsTab />
        <PermitsTab />
        <FinancesTab />
        <QrTab />
        <CheckinsTab />
        <CloseoutTab />

        {caps.canManageProjects && (
          <TabsContent value="teamportal">
            <ProjectTeamActivity projectId={projectId} />
          </TabsContent>
        )}
      </Tabs>

      <CloseoutDialog />
      <ReportDialog />
      <DocumentDialogs />
      <ProjectDialogs />
      <ShareAndNoteDialogs />
      <TeamDialogs />
      <PermitDialogs />
      <PhotoOverlay />
    </SidebarLayout>
  );
}
