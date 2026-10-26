import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  FileText,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  UploadCloud,
  QrCode,
  Plus,
  Minus,
  ClipboardCheck,
  HardHat,
  AlertTriangle,
  Smartphone,
  Users,
  Share2,
  Quote,
  UserRound,
} from "lucide-react";
import { captureAttribution, withAttribution } from "@/lib/attribution";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import builtForBeam from "@assets/built_for_beam_nobg.webp";
import founderPhoto from "@assets/founder-dean-parrish.webp";

// One landing page (Dean, 2026-10-26): www and /info merged; /info now
// redirects here. Untouched copies of both: landing.original.tsx and
// info.original.tsx. Every claim here must be true of the product today
// (CLAUDE.md "what a sign-off record can't prove").

// The founder's photo beside his signature, sized for its 60px display
// (served at 2x), from founder-dean-parrish.png (Dean, 2026-10-26).
const FOUNDER_PHOTO: string | null = founderPhoto;

const testimonials = [
  {
    quote:
      "At Concept Project Solutions Ltd, managing our construction projects efficiently while maintaining high standards of compliance is a key priority for us. SiteSort gives us a straightforward, practical way of doing it: project information organised and accessible, and structured reporting across the whole delivery team on the day to day running of a live site. It lets us focus on delivering the project while maintaining the standards our clients expect. We'd happily recommend it to other construction businesses looking to simplify their compliance and site management.",
    name: "Paul Duggan",
    role: "Director and Project Manager",
    company: "Concept Project Solutions Ltd",
  },
  {
    quote:
      "We work from ground level right up to traditional roofs, so timing is everything. SiteSort's been spot on for tracking completions so I can shift trades in exactly when they're needed, without people tripping over each other. Nobody's building off out-of-date drawings, and the compliance is sorted without the usual paper trail. Simple to use, and it actually works on a live site.",
    name: "Dave Hippsley",
    role: "Director",
    company: "Joinrite Joinery",
  },
];

const whatYouGet = [
  {
    icon: FileText,
    title: "Version-controlled documents",
    body: "The current drawing is always obvious, old ones marked superseded, so nobody builds off the wrong set by mistake.",
  },
  {
    icon: ClipboardCheck,
    title: "Digital sign-offs, and how much each one is worth",
    body: "See who's opened and signed. A signature given with the person's own 4-digit PIN is marked differently from a tap on a signed-in phone, so you know which ones carry weight.",
  },
  {
    icon: ShieldCheck,
    title: "Insurance checks at the gate",
    body: "The gate checks the firm's public liability cover and holds anyone it can't confirm, so nobody with lapsed cover is signed on unless a manager decides to let them on and says why. The site manager is alerted straight away, and every decision lands on the register with its reason.",
  },
  {
    icon: Share2,
    title: "Targeted distribution",
    body: "Send the right document to the right trade or person in a few taps. Share to a trade once and new joiners get it automatically.",
  },
  {
    icon: QrCode,
    title: "QR site board and Check-Ins",
    body: "Print a code for the gate. Anyone on site scans it to see the live permits, the current documents and anything you've pinned to the board. Check-Ins record entry with a photo and time. No login needed.",
  },
  {
    icon: AlertTriangle,
    title: "Safety alerts from site",
    body: "A worker logs a hazard or a snag with a photo from their phone, and when they submit it the project's managers are alerted in SiteSort straight away. No chasing, and a record that it was flagged.",
  },
];

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
    body: "Invite your subcontractors and staff. Each gets their own login on their own phone, with invited projects available in Your projects. No app store, no faff.",
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
    body: "New version? They're notified. Hazard spotted on site? You're alerted as soon as it's submitted. Everything's recorded as you go.",
  },
];

const faqs = [
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
  {
    q: "How do digital sign-offs work?",
    a: "You choose which documents need signing off. The signer has to open the document first, and for a PDF or image reach the end of it, before they can sign. Their name and the time are recorded. Drawings, RAMS, permits and safety packs always require the signer's personal 4-digit PIN, and you can switch PIN protection on for any other document too. Every sign-off shows plainly whether it was signed with a PIN or acknowledged with a tap.",
  },
];

const plans = [
  { id: "solo", name: "Single site", price: "£29", detail: "One active project.", best: "Best for: builders running one job at a time." },
  { id: "team", name: "Up to 5 sites", price: "£79", detail: "Up to 5 active projects, managed from one dashboard.", best: "Best for: contractors running 2 to 5 projects.", popular: true },
  { id: "pro", name: "Unlimited sites", price: "£149", detail: "Unlimited active projects.", best: "Best for: firms running six or more sites." },
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

export default function LandingPage() {
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
              <Button variant="ghost" className="font-semibold">Sign in</Button>
            </Link>
            <Link href={registerHref}>
              <Button variant="accent">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main id="top" className="pt-32 pb-16 lg:pt-44 lg:pb-24 overflow-hidden">
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
                  Start free trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
              >
                See pricing
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-5">
              14-day free trial. No charge until it ends. Cancel any time.
            </p>
          </div>

          {/* Girder image */}
          <img
            src={builtForBeam}
            alt="Built for UK construction SMEs"
            className="mx-auto w-full max-w-md sm:max-w-lg md:max-w-xl h-auto mt-14 lg:mt-16 drop-shadow-xl"
          />

          {/* Before/after slider */}
          <div className="mt-8 sm:mt-10 relative mx-auto max-w-5xl fade-in" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
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
              with the client you didn't want to have. Nobody's sure how it happened, because
              the "system" is four WhatsApp groups, a shared email account and a folder on
              someone's desktop.
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
              SiteSort gives every job one home. Drawings, RAMS, permits, insurance
              certificates, sign-offs, all in one place, all version-controlled, all pointing
              at what's current. You decide what each team sees, and it lands on their phone.
              Upload a new revision and the old one is marked superseded, so nobody builds off
              the wrong set by mistake.
            </p>
            <p>
              Every view, share and sign-off carries a name, a date and a time. Not a shoebox
              of paperwork six months later, but an answer to "who was told, and when." The
              rebuilds stop. The chasing stops.
            </p>
          </div>
        </div>
      </section>

      {/* Why we built it (Dean, 2026-10-26: the founder note) */}
      <section className="py-20 bg-muted/50 border-b">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background border border-border text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-6">
            <UserRound className="w-3.5 h-3.5" />
            Why we built it
          </div>
          <div className="space-y-5 text-lg text-foreground leading-relaxed">
            <p>
              I've spent over twenty years as an insurance broker working with construction SMEs.
              Long enough to see the same claims and the same arguments again and again: work
              built off a superseded drawing, RAMS nobody could prove were issued, a subcontractor
              on site whose public liability had lapsed months earlier.
            </p>
            <p>
              Almost none of it is bad work. It's paperwork nobody can find when it matters.
              Those years also taught me which parts of it genuinely wind contractors up, so
              SiteSort is built to keep the record straight while the job is running, without
              becoming another job in itself.
            </p>
          </div>
          <div className="mt-8 flex items-center gap-4">
            {FOUNDER_PHOTO && (
              <img
                src={FOUNDER_PHOTO}
                alt="Dean Parrish, founder of SiteSort"
                width={60}
                height={60}
                loading="lazy"
                className="w-[60px] h-[60px] rounded-full object-cover shrink-0 border border-border"
              />
            )}
            <p className="text-base font-semibold text-foreground">Dean Parrish, founder</p>
          </div>
        </div>
      </section>

      {/* What people are saying */}
      <section className="py-20 border-b bg-muted/50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">What people are saying</h2>
          </div>
          <div className="grid md:grid-cols-2 auto-rows-fr gap-6">
            {testimonials.map(t => (
              <figure key={t.name} className="rounded-2xl border bg-card shadow-sm p-8 flex flex-col">
                <Quote className="w-7 h-7 text-accent mb-4 shrink-0" aria-hidden="true" />
                <blockquote className="text-foreground leading-relaxed flex-1">"{t.quote}"</blockquote>
                <figcaption className="mt-6 pt-5 border-t">
                  <p className="font-bold text-foreground">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.role}, {t.company}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* What you get */}
      <section id="features" className="py-20 border-b">
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
          <p className="mt-8 text-center text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            Also included: site diary and daily reports, plant and materials with voice input,
            subcontractor ratings and payment holds, project calendar, and a home-screen app for
            every phone.
          </p>
        </div>
      </section>

      {/* Team portal */}
      <section id="team-portal" className="py-24 border-b bg-muted/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase tracking-wide mb-6">
                <Smartphone className="w-3.5 h-3.5" />
                Team portal
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-primary mb-5">
                Your site team gets their own simple view
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Workers and subcontractors log in to a stripped-back mobile portal built for
                muddy hands and patchy signal, just what they need, nothing they don't. You
                stay in control of exactly what each person can see and do.
              </p>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-accent/20 to-primary/10 rounded-3xl blur-2xl opacity-60"></div>
              <div className="relative rounded-2xl border bg-card shadow-xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
                    <HardHat className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-foreground">Built for the whole site</p>
                    <p className="text-sm text-muted-foreground">Simple for site teams</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm">
                  {[
                    "Works on any phone, nothing to install",
                    "Each person only sees what you've shared",
                    "Sign-offs recorded with name, time and version",
                    "Daily reports flow straight back to the office",
                    "Internal messaging, so site chat isn't scattered across WhatsApp groups",
                  ].map(t => (
                    <li key={t} className="flex items-center gap-2.5 text-foreground">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20 border-b">
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

      {/* Who this is for */}
      <section className="py-20 border-b bg-muted/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Who this is for</h2>
          </div>
          {/* Equal height at every width, stacked on a phone too (Dean, 2026-10-26). */}
          <div className="grid md:grid-cols-2 auto-rows-fr gap-6">
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
            <div className="rounded-2xl border bg-card shadow-sm p-8 flex flex-col justify-center">
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

      {/* The offer and pricing */}
      <section id="pricing" className="py-20 border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">The offer</h2>
            <p className="text-lg text-muted-foreground">Get SiteSort for your site and you get:</p>
          </div>
          <ul className="space-y-4 mb-12 max-w-3xl mx-auto">
            {[
              "Unlimited team members and subcontractors on every project. You're never charged per person.",
              "Every feature above, on the web and on your team's phones.",
              "Your documents, sign-offs and record of who was told, all in one place.",
              "Setup that takes minutes, not a consultant.",
            ].map(point => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span className="text-foreground leading-relaxed text-lg">{point}</span>
              </li>
            ))}
          </ul>

          <div className="grid gap-6 md:grid-cols-3 mb-6 [&>*]:min-w-0">
            {plans.map(p => (
              <div
                key={p.id}
                className={`relative flex flex-col rounded-2xl bg-card p-6 text-center ${p.popular ? "border-2 border-accent shadow-lg md:-translate-y-2" : "border border-border"}`}
              >
                {p.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wide text-white whitespace-nowrap">
                    Most popular
                  </span>
                )}
                <h3 className="text-sm font-bold uppercase tracking-widest text-primary">{p.name}</h3>
                <p className="mt-3 text-4xl font-bold text-primary">
                  {p.price}<span className="text-base font-medium text-muted-foreground">/month</span>
                </p>
                <p className="mt-4 text-foreground leading-relaxed">{p.detail}</p>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed flex-1">{p.best}</p>
                <Link href={withAttribution(`/register?plan=${p.id}`)} className="mt-6 block">
                  <Button className={`w-full h-12 ${p.popular ? "bg-accent hover:bg-accent/90 text-white" : ""}`} variant={p.popular ? "default" : "outline"}>
                    Start free trial
                  </Button>
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-muted-foreground leading-relaxed mb-10 max-w-xl mx-auto">
            Card details are taken at sign-up, and you won't be charged until the trial ends.
            Cancel any time before then and you pay nothing.
          </p>

          <p className="text-center text-lg text-foreground leading-relaxed">
            <strong>Try it free for 14 days.</strong> No commitment. If it doesn't save you
            time and hassle on your first job, walk away. You've lost nothing.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 border-b bg-muted/40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Questions people ask</h2>
          </div>
          <div className="space-y-3">
            {faqs.map(f => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
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

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div className="flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}images/logo.webp?v=5`} alt="SiteSort" className="h-12 w-auto" />
            </div>
            <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
              <a href="#features" className="hover:text-foreground transition-colors">Features</a>
              <a href="#team-portal" className="hover:text-foreground transition-colors">Team portal</a>
              <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
              <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
              <Link href={loginHref} className="hover:text-foreground transition-colors">Sign in</Link>
            </nav>
          </div>
          <div className="mt-8 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} SiteSort. Built by OnyxSorts for UK construction SMEs. Built by an insurance broker with twenty years in UK construction insurance.</p>
            <p>Document control, sign-offs, compliance, daily reports &amp; QR site boards.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
