import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";
import { Flame, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

// Fire-roll readiness (#125) for one project, on its Overview: everything the
// Team Portal Site Register needs to be right on the day, checked by the
// system. Shown to the project's approvers (the endpoint refuses others).
export type FireRollCheck = { key: string; status: "green" | "amber" | "red"; label: string; fix?: string };
export type FireRollReadiness = {
  projectId: string; projectName: string; status: "green" | "amber" | "red" | "not_in_use"; checks: FireRollCheck[]; siteDate: string;
};

const STATUS_TEXT = { green: "Ready", amber: "Check", red: "Not ready", not_in_use: "Not in use" } as const;
const STATUS_PILL = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  not_in_use: "bg-muted text-muted-foreground",
} as const;

// Where each problem is fixed, on this project.
function fixHref(projectId: string, key: string): string | null {
  if (key === "who" || key === "cover") return `/projects/${projectId}?tab=team`;
  if (key === "access") return `/projects/${projectId}?tab=teamportal`;
  if (key === "qr" || key === "board") return `/projects/${projectId}?tab=qr`;
  return null;
}

function CheckIcon({ status }: { status: FireRollCheck["status"] }) {
  if (status === "green") return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />;
  if (status === "amber") return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />;
  return <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />;
}

export function FireRollCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<FireRollReadiness | null>(null);
  useEffect(() => {
    let alive = true;
    const t = localStorage.getItem("sitesort_token");
    fetch(`/api/projects/${projectId}/fire-roll`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  if (!data) return null;
  return (
    <Card id="fire-roll" className={cn("scroll-mt-24", data.status === "red" && "border-destructive/50", data.status === "amber" && "border-amber-300")} data-testid="card-fire-roll" data-status={data.status}>
      <CardContent className="pt-5 space-y-3">
        <PageHeader
          level="section"
          icon={<Flame className="w-5 h-5 text-orange-600" />}
          title="Fire roll"
          description="Can the site manager or PM cover see who's on site from their phone today?"
          badge={<Pill className={STATUS_PILL[data.status]}>{STATUS_TEXT[data.status]}</Pill>}
        />
        <ul className="space-y-2">
          {data.checks.map(c => {
            const href = c.status !== "green" ? fixHref(projectId, c.key) : null;
            return (
              <li key={c.key} className="flex gap-2 text-sm min-w-0">
                <CheckIcon status={c.status} />
                <div className="min-w-0">
                  <p className={cn("break-words", c.status === "red" && "font-semibold")}>{c.label}</p>
                  {c.status !== "green" && c.fix && (
                    <p className="text-muted-foreground break-words">
                      {c.fix}{" "}
                      {href && <Link href={href} className="text-primary underline whitespace-nowrap">Open</Link>}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {data.status === "red" && (
          <p className="text-xs text-muted-foreground">While this is red, you and the site manager get one alert a day.</p>
        )}
      </CardContent>
    </Card>
  );
}
