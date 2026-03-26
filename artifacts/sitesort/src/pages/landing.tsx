import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Building2, ShieldCheck, FileText, ArrowRight, CheckCircle2 } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b bg-card/80 backdrop-blur-md fixed w-full top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-accent/20">S</div>
            <span className="font-display font-extrabold text-2xl tracking-tight text-primary">SiteSort</span>
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
      <main className="pt-32 pb-16 lg:pt-48 lg:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-3xl mx-auto slide-up">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent font-semibold text-sm mb-6 border border-accent/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              Built for Construction SMEs
            </div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-primary tracking-tight mb-8 leading-tight">
              Control the chaos of <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-amber-500">site information.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed max-w-2xl mx-auto">
              The single source of truth for your site teams. Distribute documents, track compliance, and manage subcontractors without the paperwork headache.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" variant="accent" className="w-full sm:w-auto group">
                  Start Free Trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Book Demo
                </Button>
              </Link>
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
            <div className="bg-card p-8 rounded-2xl shadow-sm border hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6 text-primary">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Version Control</h3>
              <p className="text-muted-foreground leading-relaxed">
                Never build from the wrong drawing again. Automatic superseded warnings and digital sign-off tracking.
              </p>
            </div>
            <div className="bg-card p-8 rounded-2xl shadow-sm border hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center mb-6 text-accent">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Compliance Hub</h3>
              <p className="text-muted-foreground leading-relaxed">
                Monitor subcontractor insurance and active permits in real-time. Automated alerts before they expire.
              </p>
            </div>
            <div className="bg-card p-8 rounded-2xl shadow-sm border hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-success/10 rounded-xl flex items-center justify-center mb-6 text-success">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">QR Site Boards</h3>
              <p className="text-muted-foreground leading-relaxed">
                Generate dynamic QR codes for your site boards. Anyone can scan to access public safety docs instantly.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
