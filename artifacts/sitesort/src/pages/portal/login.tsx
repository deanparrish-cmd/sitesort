import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { usePortalLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Eye, EyeOff, HardHat } from "lucide-react";

// Member portal login — deliberately SEPARATE from the PM /login. Stores a
// project-scoped token under `sitesort_portal_token` (not `sitesort_token`), so
// it never touches a dashboard session in the same browser.
export default function PortalLogin() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  // Return the member to the portal deep link they came from (e.g. a shared
  // document), falling back to the portal home. Only in-portal paths are honoured.
  const nextParam = new URLSearchParams(search).get("next");
  const dest = nextParam && nextParam.startsWith("/portal/") ? nextParam : "/portal/overview";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const login = usePortalLogin();

  const doLogin = async (projectId?: string) => {
    setError(null);
    try {
      const res = await login.mutateAsync({
        data: { email: email.trim().toLowerCase(), password, ...(projectId ? { projectId } : {}) },
      });
      if (res.requiresProjectChoice) {
        setProjects(res.projects ?? []);
        return;
      }
      if (res.token) {
        localStorage.setItem("sitesort_portal_token", res.token);
        setLocation(dest);
      }
    } catch (err: any) {
      const code = err?.data?.error;
      setError(
        code === "use_dashboard"
          ? "This is a full SiteSort account — please use the main login page."
          : err?.data?.message || "Unable to log in. Check your email and password and try again.",
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm p-6 sm:p-8 bg-card rounded-2xl shadow-2xl border border-border/50">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <HardHat className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary text-center">Team Portal</h1>
          <p className="text-muted-foreground mt-2 text-center text-sm">Log in to your project</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
            {error}
          </div>
        )}

        {projects ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center mb-4">Choose your project to continue</p>
            {projects.map(p => (
              <Button
                key={p.id}
                variant="outline"
                className="w-full justify-start"
                size="lg"
                isLoading={login.isPending}
                onClick={() => doLogin(p.id)}
              >
                {p.name}
              </Button>
            ))}
            <button
              onClick={() => { setProjects(null); setError(null); }}
              className="w-full text-sm text-muted-foreground hover:text-foreground mt-2"
            >
              ← Back
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); void doLogin(); }}
            className="space-y-5"
          >
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Email address"
              icon={<Mail className="w-5 h-5" />}
            />
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              icon={<Lock className="w-5 h-5" />}
              rightAction={
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            <Button type="submit" className="w-full" size="lg" isLoading={login.isPending}>
              Log In
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Invited to a project? Use the link your manager shared to set your password.
        </p>
      </div>
    </div>
  );
}
