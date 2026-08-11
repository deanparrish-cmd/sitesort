import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  FileText,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  UploadCloud,
  QrCode,
  BellRing,
  Plus,
  Minus,
  ClipboardCheck,
  ShieldCheck,
  Wrench,
  NotebookPen,
  AlertTriangle,
  Smartphone,
  Mic,
  Users,
  Share2,
  Camera,
  Star,
  Calendar,
} from "lucide-react";
import { captureAttribution, withAttribution } from "@/lib/attribution";
import { BeforeAfterSlider } from "@/components/before-after-slider";

const howItWorks = [
  {
    step: "1",
    icon: UploadCloud,
    title: "Set up your site.",
    body: "Create a project, upload your drawings, permits and documents. Each one carries its revision.",
  },
  {
    step: "2",
    icon: Users,
    title: "Add your team.",
    body: "Invite your subcontractors and staff. Each gets their own login on their own phone. No app store, no faff.",
  },
  {
    step: "3",
    icon: Share2,
    title: "Share what they need.",
    body: "Send a document to everyone, a whole trade, or one person. They see only what's theirs.",
  },
  {
    step: "4",
    icon: CheckCircle2,
    title: "Get on with the job.",
    body: "New version? They're notified. Hazard spotted on site? You're alerted instantly. Everything's recorded as you go.",
  },
];

const whatYouGet = [
  {
    icon: FileText,
    title: "Version-controlled documents",
    body: "The current drawing is always obvious, old ones marked superseded. Nobody builds off the wrong set.",
  },
  {
    icon: Share2,
    title: "Targeted distribution",
    body: "Send the right document to the right trade or person in a few taps. Share to a trade once and new joiners get it automatically.",
  },
  {
    icon: BellRing,
    title: "Instant notifications",
    body: "When something new lands, your crew knows. No \"did you get my message?\"",
  },
  {
    icon: AlertTriangle,
    title: "Automatic safety alerts",
    body: "When a worker logs a hazard or snag photo on site, every manager is alerted by app and email straight away. No manual chasing, and a record that it was flagged.",
  },
  {
    icon: Camera,
    title: "Timestamped photo & activity log",
    body: "Site progress and compliance, captured with a name and time. Your proof if anything's ever questioned.",
  },
  {
    icon: ClipboardCheck,
    title: "Digital sign-offs",
    body: "Know exactly who's read the method statement or acknowledged the drawing, with a record to show for it.",
  },
  {
    icon: ShieldCheck,
    title: "Permit & insurance expiry tracking",
    body: "Get warned before a permit lapses or a subcontractor's insurance runs out, instead of finding out too late.",
  },
  {
    icon: Star,
    title: "Subcontractor ratings & payment holds",
    body: "Keep a reliability rating on every subbie and flag payment holds, so the whole team's on the same page about who's who.",
  },
  {
    icon: QrCode,
    title: "QR site board",
    body: "Print a code for the gate. Anyone on site scans it to see permits, rules, current documents and what's coming up. No login needed.",
  },
  {
    icon: Mic,
    title: "Site diary with voice input",
    body: "Fill in daily reports and H&S notes by talking instead of typing, straight from your phone on site.",
  },
  {
    icon: Calendar,
    title: "Project calendar",
    body: "Company-wide and per-project events, visible to the team and shown on the site board.",
  },
  {
    icon: Smartphone,
    title: "Installable on any phone",
    body: "Your crew adds SiteSort to their home screen and it works like an app. Nothing to download from an app store.",
  },
];

const salesFaqs = [
  {
    q: "Do my workers need to download an app?",
    a: "No. They get a link, set a password, and add SiteSort to their home screen. It works like an app but there's nothing to install from an app store. Works on any phone.",
  },
  {
    q: "Is it complicated to set up?",
    a: "No. Create a project, upload your documents, invite your team. Most people are up and running in an afternoon. It's built for busy site managers, not IT departments.",
  },
  {
    q: "What if my subcontractors aren't tech-savvy?",
    a: "The team portal is deliberately simple. Big buttons, clear labels, made for a phone on site with muddy hands. If they can use WhatsApp, they can use this.",
  },
  {
    q: "Can I control who sees what?",
    a: "Yes, that's the point. You choose whether a document goes to everyone, a specific trade, or one person. Workers only ever see what's shared with them.",
  },
  {
    q: "What happens to my data if I stop using it?",
    a: "It's yours. Your documents and records stay accessible, and you can export what you need. No lock-in.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-foreground">{q}</span>
        {open ? (
          <Minus className="w-5 h-5 text-accent shrink-0" />
        ) : (
          <Plus className="w-5 h-5 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-6 pb-5 -mt-1 text-muted-foreground leading-relaxed">{a}</div>
      )}
    </div>
  );
}

export default function InfoPage() {
  useEffect(() => {
    captureAttribution();
  }, []);

  const registerHref = useMemo(() => withAttribution("/register"), []);
  const loginHref = useMemo(() => withAttribution("/login"), []);

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b bg-card/80 backdrop-blur-md fixed w-full top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 sm:h-24 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}images/logo.webp?v=5`} alt="SiteSort" className="h-16 sm:h-20 w-auto" />
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href={loginHref}>
              <Button variant="ghost" className="font-semibold hidden sm:inline-flex">Sign in</Button>
            </Link>
            <Link href={registerHref}>
              <Button variant="accent">Start free trial</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main id="top" className="pt-28 pb-16 lg:pt-40 lg:pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-3xl mx-auto slide-up">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-primary tracking-tight mb-8 leading-tight">
              Right drawing.<br />
              Right hands.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-800 to-orange-400">No costly mistakes.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed max-w-2xl mx-auto italic">
              SiteSort keeps every drawing, permit and sign-off in one place, and puts the
              current version in your crew's hands automatically. No more rebuilds because
              someone worked off Rev B.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href={registerHref} className="w-full sm:w-auto">
                <Button size="lg" variant="accent" className="w-full sm:w-auto group">
                  Start your free 14-day trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
            <p className="text-sm text-muted-foreground mt-5">
              No commitment. Cancel any time before the trial ends.
            </p>
          </div>

          {/* Before/after slider */}
          <div className="mt-12 sm:mt-14 relative mx-auto max-w-5xl fade-in" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
            <div className="absolute -inset-1 bg-gradient-to-r from-accent/30 to-primary/30 rounded-2xl blur-2xl opacity-50"></div>
            <BeforeAfterSlider />
            <p className="relative mt-4 text-center text-sm text-muted-foreground italic">
              No site offices were burgled in the making of this image. That's just SiteSort.
            </p>
          </div>
        </div>
      </main>

      {/* The problem */}
      <section className="py-20 bg-muted/50 border-y">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold uppercase tracking-wide mb-6">
            <AlertTriangle className="w-3.5 h-3.5" />
            The problem
          </div>
          <div className="space-y-5 text-lg text-foreground leading-relaxed">
            <p>
              You sent the updated drawing. You're sure you did. But the wall's gone up two
              courses wrong, and the brickie's holding a set that's three revisions old, the
              one that was in the WhatsApp group before the new one, or maybe the one still
              in the van.
            </p>
            <p>
              Now it's coming down. That's a day gone, materials wasted, and a conversation
              with the client you didn't want to have. And the honest bit? Nobody's exactly
              sure how it happened, because the "system" is four WhatsApp groups, a shared
              email account, and a folder on someone's desktop.
            </p>
            <p>
              Every hour your team spends checking they've got the right version, chasing
              you for a document, or standing around because the paperwork isn't sorted, is
              an hour off the tools. Multiply that across a crew, across a job, across a
              year. The mistakes are expensive. The wasted time is worse, because you can't
              see it.
            </p>
          </div>
        </div>
      </section>

      {/* The solution */}
      <section className="py-20 border-b">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold uppercase tracking-wide mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            The solution
          </div>
          <div className="space-y-5 text-lg text-foreground leading-relaxed">
            <p>
              SiteSort gives every job one home. Drawings, method statements, permits,
              insurance certificates, sign-offs, all in one place, all version-controlled,
              all pointing at what's current.
            </p>
            <p>
              You decide what each team sees, and it lands on their phone. When you upload a
              new revision, the old one is marked superseded and your crew gets the new one.
              No group message, no "did everyone get that?", no doubt. The right people,
              working to the right version, without you chasing anyone.
            </p>
            <p>
              And because every view, share and sign-off is stamped with a name, a date and a
              time, you've got a record. Not a shoebox of paperwork six months later, but an
              actual answer to "who was told, and when." The rebuilds stop. The chasing
              stops. Your evenings come back.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 border-b bg-muted/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">How it works</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {howItWorks.map(item => (
              <div key={item.step} className="relative p-8 rounded-2xl border bg-card shadow-sm">
                <span className="absolute top-6 right-6 text-4xl font-extrabold text-muted/70">{item.step}</span>
                <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-6">
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-[15px]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="py-20 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">What you get</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {whatYouGet.map(card => (
              <div key={card.title} className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md hover:border-gray-600 transition-all">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                  <card.icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold mb-3 text-white">{card.title}</h3>
                <p className="text-gray-300 leading-relaxed text-[15px] font-medium">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who this is for */}
      <section className="py-20 border-b bg-muted/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Who this is for</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border bg-card shadow-sm p-8">
              <h3 className="text-lg font-bold text-foreground mb-5">This is for you if:</h3>
              <ul className="space-y-4">
                {[
                  "You run construction projects and you're tired of being the human filing cabinet.",
                  "Your drawings and documents live across WhatsApp, email and a desktop folder, and you've been bitten by it.",
                  "You've had work built off an outdated revision, and paid for the privilege.",
                  "You want to prove your team was told, not just hope they were.",
                  "You're an SME builder or PM who found the big-name software too complicated and too expensive.",
                ].map(point => (
                  <li key={point} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="text-foreground leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border bg-card shadow-sm p-8">
              <h3 className="text-lg font-bold text-foreground mb-5">This probably isn't for you if:</h3>
              <p className="text-muted-foreground leading-relaxed">
                you're a national contractor already running an enterprise platform with a
                full-time admin team to feed it. SiteSort is built for the firms that don't
                have that, and don't want it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials / trust (placeholders) */}
      <section className="py-20 border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">What people are saying</h2>
          </div>
          <div className="space-y-5">
            <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Placeholder, to fill in</p>
              <p className="text-muted-foreground leading-relaxed italic">
                Testimonial placeholder: add 2 to 3 quotes from your first real users. Aim
                for specifics, such as "saved us a rebuild in the first week," "the lads
                actually use it," or "I stopped being the bottleneck." Include name,
                trade or role, and company.
              </p>
            </div>
            <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Placeholder, to fill in</p>
              <p className="text-muted-foreground leading-relaxed italic">
                Trust indicators placeholder: number of active sites, documents managed, or
                a recognisable early customer once you have them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The offer */}
      <section className="py-20 border-b bg-muted/50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">The offer</h2>
            <p className="text-lg text-muted-foreground">Get SiteSort for your site and you get:</p>
          </div>
          <ul className="space-y-4 mb-10">
            {[
              "Unlimited team members and subcontractors on every project. You're never charged per person.",
              "Every feature above, on the web and on your team's phones.",
              "Your documents, sign-offs and audit trail, all in one place.",
              "Setup that takes minutes, not a consultant.",
            ].map(point => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span className="text-foreground leading-relaxed text-lg">{point}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center mb-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Placeholder, to fill in</p>
            <p className="text-muted-foreground leading-relaxed italic">
              Pricing: £29/month single site, £79/month up to 5 sites, £149/month unlimited.
            </p>
          </div>

          <p className="text-center text-lg text-foreground leading-relaxed">
            <strong>Try it free for 14 days.</strong> No commitment. If it doesn't save you
            time and hassle on your first job, walk away. You've lost nothing.
          </p>
        </div>
      </section>

      {/* Ready to sort your site */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground px-8 py-16 text-center">
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-accent/20 rounded-full blur-3xl"></div>
            <h2 className="relative text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
              Ready to sort your site?
            </h2>
            <Link href={registerHref} className="relative inline-block mb-6">
              <Button size="lg" variant="accent" className="group">
                Start your free 14-day trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <p className="relative text-primary-foreground/80 text-lg max-w-xl mx-auto">
              Set up your first project today. The next time a drawing changes, your whole
              crew will have it before they've had their brew.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 border-b bg-muted/40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Questions people ask</h2>
          </div>
          <div className="space-y-3">
            {salesFaqs.map(f => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA bar, always reachable without scrolling back up */}
      <div className="sticky bottom-0 z-40 border-t bg-card/95 backdrop-blur-md py-3 px-4 sm:hidden">
        <Link href={registerHref} className="block">
          <Button size="lg" variant="accent" className="w-full group">
            Start your free 14-day trial
            <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Button>
        </Link>
      </div>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div className="flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}images/logo.webp?v=5`} alt="SiteSort" className="h-12 w-auto" />
            </div>
            <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
              <Link href={loginHref} className="hover:text-foreground transition-colors">Sign in</Link>
              <Link href={registerHref} className="hover:text-foreground transition-colors">Start free trial</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
