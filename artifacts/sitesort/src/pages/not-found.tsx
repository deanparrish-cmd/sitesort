import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Compass, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md text-center bg-card border rounded-2xl shadow-sm p-10">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 text-accent flex items-center justify-center mx-auto mb-6">
          <Compass className="w-7 h-7" />
        </div>
        <p className="text-5xl font-extrabold text-primary mb-2">404</p>
        <h1 className="text-xl font-bold text-foreground mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button variant="accent" className="w-full sm:w-auto gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" className="w-full sm:w-auto">
              Go to dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
