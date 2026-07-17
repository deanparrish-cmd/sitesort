import { useState, useRef, useCallback } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QrCode, Download, Printer, Plus, RefreshCw, Building2, MapPin } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useListProjects } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function buildSiteUrl(token: string): string {
  return `${window.location.origin}${BASE}/site/${token}`;
}

function ProjectQrCard({ project }: { project: any }) {
  const [qrData, setQrData] = useState<{ token: string; siteUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const existing = await fetch(`/api/projects/${project.id}/qr-codes`, { headers }).then(r => r.json());
      if (Array.isArray(existing) && existing.length > 0) {
        const qr = existing.find((q: any) => q.category === "site_board") ?? existing[0];
        setQrData({ token: qr.token, siteUrl: buildSiteUrl(qr.token) });
        setFetched(true);
        return;
      }

      const res = await fetch(`/api/projects/${project.id}/qr-codes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ categories: ["site_board"] }),
      });
      const created = await res.json();
      if (Array.isArray(created) && created.length > 0) {
        const qr = created[0];
        setQrData({ token: qr.token, siteUrl: buildSiteUrl(qr.token) });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [project.id]);

  const downloadSvg = () => {
    if (!svgRef.current) return;
    const svg = svgRef.current.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, "-")}-site-board-qr.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const print = () => {
    if (!qrData) return;
    const win = window.open("", "_blank");
    if (!win || !svgRef.current) return;
    const svg = svgRef.current.querySelector("svg");
    win.document.write(`
      <html><head><title>${project.name} — Site Board QR</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; padding: 40px; text-align: center; background: white; }
        h2 { font-size: 24px; font-weight: 800; margin-bottom: 4px; color: #1f2937; }
        p { color: #6b7280; font-size: 14px; margin: 4px 0; }
        .url { font-size: 11px; color: #9ca3af; word-break: break-all; margin-top: 12px; }
        .badge { display: inline-block; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; border-radius: 9999px; padding: 4px 12px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
        svg { margin: 20px auto; display: block; }
      </style></head><body>
      <span class="badge">SiteSort — Site Board</span>
      <h2>${project.name}</h2>
      <p>${project.address}</p>
      ${svg?.outerHTML ?? ""}
      <p class="url">Scan to view site information: ${qrData.siteUrl}</p>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base leading-snug">{project.name}</CardTitle>
            <p className="text-muted-foreground text-xs mt-1 flex items-center gap-1 truncate">
              <MapPin className="w-3 h-3 shrink-0" /> {project.address}
            </p>
          </div>
          <Badge variant={project.status === "active" ? "success" : "secondary"} className="shrink-0 text-xs">
            {project.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center gap-4">
        {!fetched ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6 gap-3 w-full">
            <div className="w-24 h-24 rounded-xl bg-muted flex items-center justify-center opacity-40">
              <QrCode className="w-10 h-10 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Generate a QR code for the<br />site information board
            </p>
            <Button onClick={load} disabled={loading} size="sm">
              {loading ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</> : <><Plus className="w-3.5 h-3.5 mr-1.5" />Generate QR Code</>}
            </Button>
          </div>
        ) : qrData ? (
          <>
            <div ref={svgRef} className="p-3 bg-white border rounded-xl shadow-sm">
              <QRCodeSVG
                value={qrData.siteUrl}
                size={160}
                level="H"
                includeMargin
              />
            </div>
            <p className="text-xs text-muted-foreground text-center break-all px-2 leading-relaxed">
              {qrData.siteUrl}
            </p>
            <div className="flex gap-2 w-full">
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={downloadSvg}>
                <Download className="w-3.5 h-3.5 mr-1" /> Download
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={print}>
                <Printer className="w-3.5 h-3.5 mr-1" /> Print
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-destructive py-4">Failed to generate QR code</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function QrPage() {
  const { data: projects, isLoading } = useListProjects();

  const activeProjects = projects?.filter(p => p.status === "active") ?? [];

  return (
    <SidebarLayout>
      <PageHeader
        className="mb-8"
        title="QR Code Site Boards"
        description="Generate a QR code for each project. Print and post it on site — workers can scan it to view live site information without needing an account."
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map(i => <div key={i} className="h-80 bg-muted rounded-xl" />)}
        </div>
      ) : activeProjects.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-40" />
          <h3 className="text-lg font-bold">No active projects</h3>
          <p className="text-muted-foreground">Create a project first, then generate its QR code here.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {activeProjects.map(project => (
            <ProjectQrCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </SidebarLayout>
  );
}
