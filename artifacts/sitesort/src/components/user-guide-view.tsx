import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { GuideSection, FaqItem } from "@workspace/user-guide";

// Shared visual language for the User Guide across all three surfaces
// (dashboard /user-guide, portal Help, public /guide) — numbered accent-orange
// step badges, colored tip/note asides, and an audience pill. Pure
// presentation; content always comes from @workspace/user-guide.

export function AudiencePill({ audience }: { audience: "pm" | "worker" }) {
  return audience === "pm" ? (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
      Project managers
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-accent/10 text-accent">
      Site workers
    </span>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-accent text-white text-xs font-bold shrink-0">
      {n}
    </span>
  );
}

function Callout({ tone, text }: { tone: "tip" | "note"; text: string }) {
  return (
    <div
      className={cn(
        "border-l-4 rounded-r-lg px-3 py-2 mt-2 text-xs leading-relaxed",
        tone === "tip"
          ? "bg-accent/10 border-accent text-foreground/90"
          : "bg-blue-50 border-blue-400 text-blue-950 dark:bg-blue-950/30 dark:text-blue-200"
      )}
    >
      <span className={cn("font-bold uppercase tracking-wide mr-1.5", tone === "tip" ? "text-accent" : "text-blue-600 dark:text-blue-400")}>
        {tone === "tip" ? "Tip" : "Note"}
      </span>
      {text}
    </div>
  );
}

export function GuideSectionGrid({ sections, columns = true }: { sections: GuideSection[]; columns?: boolean }) {
  return (
    <div className={cn("grid gap-4", columns && "sm:grid-cols-2")}>
      {sections.map((section) => (
        <Card key={section.id} className="p-5 border-t-4 border-t-accent/50">
          <h3 className="font-display font-bold text-base mb-3">{section.title}</h3>
          <div className="space-y-4">
            {section.steps.map((step, i) => (
              <div key={i}>
                <p className="text-sm font-semibold flex items-start gap-2">
                  <StepNumber n={i + 1} />
                  <span className="pt-0.5">{step.heading}</span>
                </p>
                <div className="pl-8">
                  {step.body.map((line, j) => (
                    <p key={j} className="text-sm text-muted-foreground mt-1">{line}</p>
                  ))}
                  {step.callout && <Callout tone={step.callout.tone} text={step.callout.text} />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function GuideFaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <Card className="p-2 border-t-4 border-t-blue-400/50">
      <Accordion type="single" collapsible>
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id} className="px-3">
            <AccordionTrigger className="text-sm hover:text-accent">
              <span className="flex items-center gap-2">
                <span className="text-accent font-bold">Q.</span>
                {item.question}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground pl-6">{item.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Card>
  );
}
