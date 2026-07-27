import { useState } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { HardHat, User, HelpCircle } from "lucide-react";
import {
  PM_GUIDE, WORKER_GUIDE, FAQ, PM_GUIDE_TITLE, WORKER_GUIDE_TITLE,
  type GuideSection,
} from "@workspace/user-guide";

type Audience = "pm" | "worker";

function GuideSectionCard({ section }: { section: GuideSection }) {
  return (
    <Card className="p-5">
      <h3 className="font-display font-bold text-base mb-3">{section.title}</h3>
      <div className="space-y-3">
        {section.steps.map((step, i) => (
          <div key={i}>
            <p className="text-sm font-semibold">{step.heading}</p>
            {step.body.map((line, j) => (
              <p key={j} className="text-sm text-muted-foreground mt-1">{line}</p>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function UserGuidePage() {
  const [audience, setAudience] = useState<Audience>("pm");
  const sections = audience === "pm" ? PM_GUIDE : WORKER_GUIDE;

  return (
    <SidebarLayout>
      <PageHeader
        title="User Guide"
        description="How to use SiteSort — for project managers and site workers."
      />

      <div className="flex gap-2 mt-6 mb-6 border-b border-border">
        <button
          onClick={() => setAudience("pm")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            audience === "pm" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <User className="w-4 h-4" /> {PM_GUIDE_TITLE}
        </button>
        <button
          onClick={() => setAudience("worker")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            audience === "worker" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <HardHat className="w-4 h-4" /> {WORKER_GUIDE_TITLE}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <GuideSectionCard key={section.id} section={section} />
        ))}
      </div>

      <div className="mt-8">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-primary" /> FAQ
        </h2>
        <Card className="p-2">
          <Accordion type="single" collapsible>
            {FAQ.map((item) => (
              <AccordionItem key={item.id} value={item.id} className="px-3">
                <AccordionTrigger className="text-sm">{item.question}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Card>
      </div>
    </SidebarLayout>
  );
}
