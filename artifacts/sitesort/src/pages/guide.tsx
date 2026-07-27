import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { WORKER_GUIDE, workerFaq, WORKER_GUIDE_TITLE } from "@workspace/user-guide";

// Public, unauthenticated worker guide — the same page portal members reach
// via Help under Settings, but reachable before they've logged in (linked
// from the "Invite to Portal" email, which a brand-new member opens before
// they have a password). Deliberately outside SidebarLayout/PortalLayout:
// no auth check, matching the /site/:token public site-board pattern.
export default function Guide() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-2xl mx-auto px-4 py-6 flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}images/logo.webp?v=5`} alt="SiteSort" className="h-12 w-auto" />
          <div>
            <p className="font-display font-bold text-lg leading-tight">{WORKER_GUIDE_TITLE}</p>
            <p className="text-sm text-muted-foreground">Using SiteSort on site</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {WORKER_GUIDE.map((section) => (
          <Card key={section.id} className="p-4">
            <h2 className="font-display font-bold text-base mb-3">{section.title}</h2>
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
        ))}

        <div>
          <h2 className="font-display font-bold text-lg mb-3">FAQ</h2>
          <Card className="p-2">
            <Accordion type="single" collapsible>
              {workerFaq().map((item) => (
                <AccordionItem key={item.id} value={item.id} className="px-3">
                  <AccordionTrigger className="text-sm">{item.question}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">{item.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>
        </div>
      </div>
    </div>
  );
}
