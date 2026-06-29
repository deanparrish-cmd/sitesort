import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Building2,
  ShieldCheck,
  FileText,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  CreditCard,
  UploadCloud,
  QrCode,
  BellRing,
  Plus,
  Minus,
} from "lucide-react";
import { captureAttribution, withAttribution } from "@/lib/attribution";
import builtForBeam from "@assets/built_for_beam_nobg.webp";

const faqs = [
  {
    q: "Do I need to install anything on site?",
    a: "No. SiteSort runs in any browser on phone, tablet or desktop. Site teams and subcontractors scan a QR code to open the latest documents — no app download or login required.",
  },
  {
    q: "How does the free trial work?",
    a: "Every plan starts with a 14-day free trial. You add your card at sign-up but we don't charge until the trial ends, and you can cancel any time before then at no cost.",
  },
  {
    q: "Can I control who sees which documents?",
    a: "Yes. You decide what's published to public site boards and what stays internal. Sign-off tracking shows exactly who has acknowledged each drawing or method statement.",
  },
  {
    q: "What happens when a drawing is superseded?",
    a: "Upload a new version and SiteSort automatically flags the old one as superseded, warns anyone working from it, and keeps a full version history for your records.",
  },
  {
    q: "Is my data secure?",
    a: "Documents are stored securely and access is scoped to your company. Public site boards only ever expose the specific documents you choose to share.",
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
      <main id="top" className="pt-32 pb-16 lg:pt-44 lg:pb-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-3xl mx-auto slide-up">
            <img
              src={builtForBeam}
              alt="Built for UK construction SMEs"
              className="mx-auto w-full max-w-xl md:max-w-2xl h-auto mb-10 drop-shadow-xl"
            />
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-primary tracking-tight mb-8 leading-tight">
              Control the chaos of <br className="hidden sm:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-800 to-orange-400">site information.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed max-w-2xl mx-auto">
              All of your site information in one place. Distribute the right documents,
              track compliance and progress without the paperwork headache. Never work from
              the wrong drawings again.
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
              14-day free trial · No charge until it ends · Cancel any time
            </p>
          </div>

          {/* Hero Image */}
          <div className="mt-16 lg:mt-20 relative mx-auto max-w-5xl fade-in" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
            <div className="absolute -inset-1 bg-gradient-to-r from-accent/30 to-primary/30 rounded-2xl blur-2xl opacity-50"></div>
            <img
              src={`${import.meta.env.BASE_URL}images/construction-hero.webp`}
              alt="A steel-frame construction site at dusk, managed with SiteSort"
              className="relative rounded-2xl shadow-2xl border border-border/50 object-cover w-full aspect-video"
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </div>
      </main>

      {/* Social proof / trust */}
      <section className="border-y bg-card/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-8">
            Trusted by site teams replacing WhatsApp groups and overflowing inboxes
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { stat: "10,000+", label: "Documents kept current" },
              { stat: "100%", label: "Version-controlled drawings" },
              { stat: "Zero", label: "Sales meetings, hidden costs or lengthy onboarding" },
              { stat: "14 days", label: "Free on every plan" },
            ].map(item => (
              <div key={item.label}>
                <div className="text-2xl sm:text-3xl font-extrabold text-primary">{item.stat}</div>
                <div className="text-sm text-muted-foreground mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-muted/50 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Everything you need to run a safe site</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Replace disjointed WhatsApp groups, overflowing email inboxes and paper files with
              purpose-built tools, showing only relevant and up to date information.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Version control</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-outside pl-5 font-medium">
                <li>Never build from the wrong drawing again</li>
                <li>Automatic superseded warnings</li>
                <li>Digital sign-off tracking</li>
              </ul>
            </div>
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Compliance hub</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-outside pl-5 font-medium">
                <li>Monitor subcontractor insurance in real time</li>
                <li>Track active permits across all sites</li>
                <li>Automated alerts before they expire</li>
              </ul>
            </div>
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">QR site boards</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-outside pl-5 font-medium">
                <li>Generate dynamic QR codes for site boards</li>
                <li>Instant access to public safety documents</li>
                <li>No app download required to scan</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Up and running in an afternoon</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              No lengthy onboarding or IT project. Three steps from sign-up to a controlled site.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                icon: UploadCloud,
                step: "01",
                title: "Upload your documents",
                body: "Add your drawings, RAMS, permits and insurance certificates. SiteSort versions everything automatically.",
              },
              {
                icon: QrCode,
                step: "02",
                title: "Print your QR site boards",
                body: "Generate a QR code for each site. Pin it up so anyone can scan to the latest approved documents.",
              },
              {
                icon: BellRing,
                step: "03",
                title: "Stay ahead of expiries",
                body: "Track sign-offs and get automated alerts before insurance or permits lapse — nothing slips through.",
              },
            ].map(item => (
              <div key={item.step} className="relative p-8 rounded-2xl border bg-card shadow-sm">
                <span className="absolute top-6 right-6 text-4xl font-extrabold text-muted/70">{item.step}</span>
                <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-6">
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              14-day free trial on every plan — no charge until it ends
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Simple, transparent pricing</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">Pick the plan that fits your workload. Upgrade or cancel any time.</p>
          </div>

          <div className="grid gap-6 max-w-[480px] mx-auto lg:max-w-5xl lg:grid-cols-3 mt-12">
            {[
              {
                name: "Solo",
                tagline: "Perfect for a single site",
                price: "£29",
                image: "plan-solo.jpeg",
                features: ["1 active project", "Unlimited team members", "Document version control", "QR site boards", "Compliance tracking"],
              },
              {
                name: "Team",
                tagline: "For growing contractors",
                price: "£79",
                image: "plan-team.jpeg",
                features: ["Up to 5 active projects", "Unlimited team members", "Document version control", "QR site boards", "Compliance tracking"],
                highlight: true,
              },
              {
                name: "Pro",
                tagline: "Full access to every feature",
                price: "£149",
                image: "plan-pro.jpeg",
                features: ["Unlimited projects", "Unlimited team members", "Document version control", "QR site boards", "Compliance tracking"],
              },
            ].map(plan => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl border p-8 ${plan.highlight ? "border-2 border-primary/40 bg-gradient-to-br from-orange-50/50 to-amber-50/30 shadow-lg" : "bg-card shadow-sm"}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 right-6 text-[10px] font-semibold uppercase tracking-wide bg-orange-500 text-white px-3 py-1 rounded-full">
                    Most popular
                  </div>
                )}
                <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center mb-4 ring-1 ring-primary/30">
                  <img
                    src={`${import.meta.env.BASE_URL}images/${plan.image}?v=4`}
                    alt={`SiteSort ${plan.name}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-lg font-bold text-foreground">SiteSort {plan.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">{plan.tagline}</p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </div>
                <ul className="space-y-2 text-sm text-foreground mb-8 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <a href={withAttribution(`/register?plan=${plan.name.toLowerCase()}`)}>
                  <Button variant={plan.highlight ? "default" : "outline"} className="w-full gap-2">
                    <CreditCard className="w-4 h-4" />
                    Start free trial
                  </Button>
                </a>
                <p className="text-[11px] text-muted-foreground text-center mt-2">Then {plan.price}/month. Cancel any time.</p>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-10">
            Card details required at sign-up. Secure checkout powered by Stripe.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 border-b bg-muted/40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Frequently asked questions</h2>
            <p className="text-muted-foreground text-lg">Everything you need to know before you start your trial.</p>
          </div>
          <div className="space-y-3">
            {faqs.map(f => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground px-8 py-16 text-center">
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-accent/20 rounded-full blur-3xl"></div>
            <h2 className="relative text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
              Bring order to your sites today
            </h2>
            <p className="relative text-primary-foreground/80 text-lg max-w-xl mx-auto mb-8">
              Start your 14-day free trial. Your whole team can be on the latest documents this afternoon.
            </p>
            <Link href={registerHref} className="relative inline-block">
              <Button size="lg" variant="accent" className="group">
                Start free trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
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
              <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
              <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
              <Link href={loginHref} className="hover:text-foreground transition-colors">Sign in</Link>
            </nav>
          </div>
          <div className="mt-8 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} SiteSort. Built for UK construction SMEs.</p>
            <p>Document control, compliance &amp; QR site boards.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
