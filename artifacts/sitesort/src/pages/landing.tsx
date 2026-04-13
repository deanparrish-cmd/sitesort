import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Building2, ShieldCheck, FileText, ArrowRight, CheckCircle2 } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b bg-card/80 backdrop-blur-md fixed w-full top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-36 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="SiteSort" className="h-28 w-auto" style={{ filter: 'hue-rotate(-50deg) saturate(3) contrast(1.5)' }} />
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
            <div className="bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-700 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 text-orange-500 shadow-lg shadow-white/10">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Version Control</h3>
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-inside font-bold">
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
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-inside font-bold">
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
              <ul className="text-gray-300 leading-relaxed space-y-1 list-disc list-inside font-bold">
                <li>Generate dynamic QR codes for site boards</li>
                <li>Instant access to public safety documents</li>
                <li>No app download required to scan</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
