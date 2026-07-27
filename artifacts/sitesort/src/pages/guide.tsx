import { GuideSectionGrid, GuideFaqAccordion, AudiencePill } from "@/components/user-guide-view";
import { WORKER_GUIDE, workerFaq, WORKER_GUIDE_TITLE } from "@workspace/user-guide";

// Public, unauthenticated worker guide — the same page portal members reach
// via Help under Settings, but reachable before they've logged in (linked
// from the "Invite to Portal" email, which a brand-new member opens before
// they have a password). Deliberately outside SidebarLayout/PortalLayout:
// no auth check, matching the /site/:token public site-board pattern.
export default function Guide() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-56 h-56 bg-accent/10 rounded-full blur-3xl" />
        <div className="max-w-2xl mx-auto px-4 py-6 flex items-center gap-3 relative">
          <img src={`${import.meta.env.BASE_URL}images/logo.webp?v=5`} alt="SiteSort" className="h-12 w-auto" />
          <div>
            <p className="font-display font-bold text-lg leading-tight">{WORKER_GUIDE_TITLE}</p>
            <p className="text-sm text-muted-foreground">Using SiteSort on site</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <AudiencePill audience="worker" />

        <GuideSectionGrid sections={WORKER_GUIDE} columns={false} />

        <div>
          <h2 className="font-display font-bold text-lg mb-3">FAQ</h2>
          <GuideFaqAccordion items={workerFaq()} />
        </div>
      </div>
    </div>
  );
}
