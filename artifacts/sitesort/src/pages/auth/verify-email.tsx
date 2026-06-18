import { useEffect, useState } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Building2, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "loading" | "success" | "error";

export default function VerifyEmail() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token found in this link.");
      return;
    }

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (r.ok) {
          setStatus("success");
        } else {
          const data = await r.json().catch(() => ({}));
          setStatus("error");
          setMessage(data.message ?? "This verification link is invalid or has expired.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 text-center slide-up">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">SiteSort</h1>
        </div>

        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-muted-foreground">Verifying your email address…</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h2 className="text-xl font-semibold">Email verified!</h2>
            <p className="text-muted-foreground text-sm">Your email address has been confirmed. You can now access all SiteSort features.</p>
            <Button className="mt-2 w-full" onClick={() => setLocation("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <XCircle className="w-12 h-12 text-destructive" />
            <h2 className="text-xl font-semibold">Verification failed</h2>
            <p className="text-muted-foreground text-sm">{message}</p>
            <Button variant="outline" className="mt-2 w-full" onClick={() => setLocation("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
