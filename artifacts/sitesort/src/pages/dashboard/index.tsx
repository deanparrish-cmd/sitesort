import { useState } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, AlertTriangle, CheckCircle2, ArrowRight, ShieldAlert, FileSignature, Users, Mail } from "lucide-react";
import { useListProjects, useGetComplianceOverview } from "@workspace/api-client-react";

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: compliance, isLoading: compLoading } = useGetComplianceOverview();

  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function sendTestEmail() {
    setEmailStatus("sending");
    try {
      const res = await fetch("/api/test-email", { method: "POST" });
      const data = await res.json();
      setEmailStatus(data.success ? "sent" : "error");
    } catch {
      setEmailStatus("error");
    }
  }

  return (
    <SidebarLayout>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your sites and compliance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={sendTestEmail}
            disabled={emailStatus === "sending"}
            className="text-xs"
          >
            <Mail className="w-3.5 h-3.5 mr-1.5" />
            {emailStatus === "idle" && "Send Test Email"}
            {emailStatus === "sending" && "Sending…"}
            {emailStatus === "sent" && "✓ Email sent!"}
            {emailStatus === "error" && "✗ Failed — check console"}
          </Button>
          <Link href="/projects">
            <Button variant="accent">New Project</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-primary text-primary-foreground border-primary shadow-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-primary-foreground text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5 opacity-80" /> Active Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-extrabold">{projects?.filter(p => p.status === 'active').length || 0}</div>
          </CardContent>
        </Card>
        
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-warning-foreground text-lg flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-warning" /> Expiring Insurance/Permits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-extrabold text-warning-foreground">
              {(compliance?.expiringInsurance?.length || 0) + (compliance?.expiringPermits?.length || 0)}
            </div>
            <Link href="/compliance" className="text-sm font-semibold text-warning mt-2 inline-flex items-center hover:underline">
              View Compliance Center <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-destructive text-lg flex items-center gap-2">
              <FileSignature className="w-5 h-5" /> Pending Acknowledgments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-extrabold text-destructive">
              {compliance?.pendingAcknowledgments?.reduce((acc, curr) => acc + curr.pendingCount, 0) || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-2xl font-bold mb-4">Active Projects</h2>
      {projectsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-muted rounded-xl"></div>)}
        </div>
      ) : projects?.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-bold">No projects yet</h3>
          <p className="text-muted-foreground mb-6">Create your first project to get started.</p>
          <Link href="/projects"><Button>Create Project</Button></Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.filter(p => p.status === 'active').map(project => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group h-full flex flex-col">
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <Badge variant="success">Active</Badge>
                    {project.alertCount > 0 && (
                      <Badge variant="destructive" className="animate-pulse">
                        <AlertTriangle className="w-3 h-3 mr-1" /> {project.alertCount} Action Req.
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="group-hover:text-accent transition-colors">{project.name}</CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-1">{project.address}</p>
                </CardHeader>
                <CardContent className="mt-auto">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-bold">{project.progressPercent}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-primary h-2.5 rounded-full" 
                      style={{ width: `${project.progressPercent}%` }}
                    ></div>
                  </div>
                  <div className="mt-4 pt-4 border-t flex justify-between text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="w-4 h-4"/> {project.memberCount} Team</span>
                    <span>Started {new Date(project.startDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric'})}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </SidebarLayout>
  );
}
