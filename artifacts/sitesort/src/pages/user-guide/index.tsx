import { useState } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { PageHeader } from "@/components/ui/page-header";
import { GuideSectionGrid, GuideFaqAccordion, AudiencePill } from "@/components/user-guide-view";
import { cn } from "@/lib/utils";
import { HardHat, User, HelpCircle } from "lucide-react";
import { PM_GUIDE, WORKER_GUIDE, FAQ, PM_GUIDE_TITLE, WORKER_GUIDE_TITLE } from "@workspace/user-guide";

type Audience = "pm" | "worker";

export default function UserGuidePage() {
  const [audience, setAudience] = useState<Audience>("pm");
  const sections = audience === "pm" ? PM_GUIDE : WORKER_GUIDE;

  return (
    <SidebarLayout>
      <PageHeader
        title="User Guide"
        description="How to use SiteSort, for project managers and site workers."
        icon={
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent/10 text-accent shrink-0">
            <HelpCircle className="w-5 h-5" />
          </span>
        }
      />

      <div className="flex gap-2 mt-6 mb-6">
        <button
          onClick={() => setAudience("pm")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors",
            audience === "pm"
              ? "bg-blue-600 border-blue-600 text-white shadow-sm"
              : "border-border text-muted-foreground hover:border-blue-300 hover:text-blue-700"
          )}
        >
          <User className="w-4 h-4" /> {PM_GUIDE_TITLE}
        </button>
        <button
          onClick={() => setAudience("worker")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors",
            audience === "worker"
              ? "bg-accent border-accent text-white shadow-sm"
              : "border-border text-muted-foreground hover:border-accent/50 hover:text-accent"
          )}
        >
          <HardHat className="w-4 h-4" /> {WORKER_GUIDE_TITLE}
        </button>
      </div>

      <div className="mb-4">
        <AudiencePill audience={audience} />
      </div>

      <GuideSectionGrid sections={sections} />

      <div className="mt-8">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-accent" /> FAQ
        </h2>
        <GuideFaqAccordion items={FAQ} />
      </div>
    </SidebarLayout>
  );
}
