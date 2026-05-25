import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Building2, ShieldCheck, FileText, ArrowRight, CheckCircle2, Sparkles, CreditCard } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b bg-card/80 backdrop-blur-md fixed w-full top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-36 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}images/logo.png?v=5`} alt="SiteSort" className="h-[8.75rem] w-auto" />
          </div>
          <div className="flex gap-4">
            <Link href="/login">
              <Button variant="ghost" className="font-semibold">Log in</Button>
            </Link>
            <Link href="/register">
              <Button variant="accent">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="pt-44 pb-16 lg:pt-56 lg:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-3xl mx-auto slide-up">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-primary tracking-tight mb-8 leading-tight">
              Control the chaos of <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-800 to-orange-400">site information.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed max-w-2xl mx-auto">
              The single source of truth for your site teams. Distribute documents, track compliance, and manage subcontractors without the paperwork headache.<br />
              <span className="font-bold text-foreground">Built for Construction SMEs.</span>
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                variant="accent"
                className="w-full sm:w-auto group"
                onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
              >
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>

          {/* Hero Image */}
          <div className="mt-20 relative mx-auto max-w-5xl fade-in" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
            <div className="absolute -inset-1 bg-gradient-to-r from-accent/30 to-primary/30 rounded-2xl blur-2xl opacity-50"></div>
            <img 
              src={`${import.meta.env.BASE_URL}images/construction-hero.png`} 
              alt="Construction Site Dashboard" 
              className="relative rounded-2xl shadow-2xl border border-border/50 object-cover w-full aspect-video"
            />
          </div>
        </div>
      </main>

      {/* Features */}
      <section className="py-24 bg-muted/50 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Everything you need to run a safe site</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">Replace disjointed WhatsApp groups and overflowing email inboxes with purpose-built tools.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Version Control</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-outside pl-5 font-bold">
                <li>Never build from the wrong drawing again</li>
                <li>Automatic superseded warnings</li>
                <li>Digital sign-off tracking</li>
              </ul>
            </div>
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Compliance Hub</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-outside pl-5 font-bold">
                <li>Monitor subcontractor insurance in real-time</li>
                <li>Track active permits across all sites</li>
                <li>Automated alerts before they expire</li>
              </ul>
            </div>
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">QR Site Boards</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-outside pl-5 font-bold">
                <li>Generate dynamic QR codes for site boards</li>
                <li>Instant access to public safety documents</li>
                <li>No app download required to scan</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              14-day free trial on every plan — no charge until it ends
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Simple, transparent pricing</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">Pick the plan that fits your workload. Upgrade or cancel any time.</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto mt-12">
            {[
              {
                name: "Solo",
                tagline: "Perfect for a single site",
                price: "£29",
                features: ["1 active project", "Unlimited team members", "Document version control", "QR site boards", "Compliance tracking"],
              },
              {
                name: "Team",
                tagline: "For growing contractors",
                price: "£79",
                features: ["Up to 5 active projects", "Unlimited team members", "Document version control", "QR site boards", "Compliance tracking"],
                highlight: true,
              },
              {
                name: "Pro",
                tagline: "Full access to every feature",
                price: "£149",
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
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${plan.highlight ? "bg-gradient-to-br from-orange-500 to-orange-600" : "bg-muted"}`}>
                  <Sparkles className={`w-5 h-5 ${plan.highlight ? "text-white" : "text-muted-foreground"}`} />
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
                <Link href="/register">
                  <Button variant={plan.highlight ? "default" : "outline"} className="w-full gap-2">
                    <CreditCard className="w-4 h-4" />
                    Start free trial
                  </Button>
                </Link>
                <p className="text-[11px] text-muted-foreground text-center mt-2">Then {plan.price}/month. Cancel any time.</p>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-10">
            Card details required at sign-up. Secure checkout powered by Stripe.
          </p>
        </div>
      </section>
    </div>
  );
}
