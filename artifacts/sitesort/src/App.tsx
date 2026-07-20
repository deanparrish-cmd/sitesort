import { lazy, type ComponentType, Suspense } from "react";
import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { setupApiInterceptor } from "@/lib/api-setup";
import { SubscriptionProvider } from "@/contexts/subscription";

// NotFound stays eager (tiny) so 404s render instantly without a Suspense flash.
import NotFound from "@/pages/not-found";

// A route's chunk is fetched by an exact hashed filename embedded in the bundle
// the browser already has loaded. If a deploy happens while that bundle is
// sitting in a tab (the browser never re-fetches JS on its own — only on a
// real navigation), the old hash no longer exists on the server: a client-side
// route change (e.g. redirecting into the portal right after a successful
// invite-accept) then throws "Failed to fetch dynamically imported module",
// uncaught, straight past any component-level try/catch into the error
// boundary — even though the action that triggered the navigation succeeded.
// A plain reload fixes this (fresh index.html → current chunk hashes), so do
// that automatically, once, instead of showing a dead end. The sessionStorage
// flag stops a genuinely broken/missing chunk from reload-looping forever;
// it's cleared on the next successful chunk load so a later real deploy can
// still trigger one more auto-reload.
const CHUNK_RELOAD_FLAG = "sitesort_chunk_reload_attempted";
function lazyWithRetry<T extends { default: ComponentType<any> }>(factory: () => Promise<T>) {
  return lazy(() =>
    factory()
      .then((mod) => {
        try { sessionStorage.removeItem(CHUNK_RELOAD_FLAG); } catch { /* private mode etc. */ }
        return mod;
      })
      .catch((err) => {
        let alreadyReloaded = false;
        try { alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === "1"; } catch { /* noop */ }
        if (!alreadyReloaded) {
          try { sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1"); } catch { /* noop */ }
          window.location.reload();
          // The reload is already underway — never resolve so nothing else runs.
          return new Promise<T>(() => {});
        }
        throw err;
      }),
  );
}

// Pages — lazy-loaded so each route ships as its own chunk (code splitting).
const LandingPage = lazyWithRetry(() => import("@/pages/landing"));
const Login = lazyWithRetry(() => import("@/pages/auth/login"));
const Register = lazyWithRetry(() => import("@/pages/auth/register"));
const VerifyEmail = lazyWithRetry(() => import("@/pages/auth/verify-email"));
const ForgotPassword = lazyWithRetry(() => import("@/pages/auth/forgot-password"));
const ResetPassword = lazyWithRetry(() => import("@/pages/auth/reset-password"));
const Dashboard = lazyWithRetry(() => import("@/pages/dashboard"));
const ProjectsList = lazyWithRetry(() => import("@/pages/projects"));
const ProjectDetail = lazyWithRetry(() => import("@/pages/projects/detail"));
const QrPage = lazyWithRetry(() => import("@/pages/qr"));
const SiteBoard = lazyWithRetry(() => import("@/pages/site-board"));
const AdminDashboard = lazyWithRetry(() => import("@/pages/admin"));
const InvoicesPage = lazyWithRetry(() => import("@/pages/invoices"));
const SubcontractorsPage = lazyWithRetry(() => import("@/pages/subcontractors"));
const CompliancePage = lazyWithRetry(() => import("@/pages/compliance"));
const TeamPage = lazyWithRetry(() => import("@/pages/team"));
const MessagesPage = lazyWithRetry(() => import("@/pages/messages"));
const NotificationsPage = lazyWithRetry(() => import("@/pages/notifications"));
const SettingsPage = lazyWithRetry(() => import("@/pages/settings"));
const IssuesPage = lazyWithRetry(() => import("@/pages/issues"));
const CheckinsPage = lazyWithRetry(() => import("@/pages/checkins"));
const DailyReportsPage = lazyWithRetry(() => import("@/pages/daily-reports"));

// Team Portal — separate member-facing app section (own login + stripped shell).
// This is exactly the route pair where the bug was found: accept a fresh
// invite (its own chunk, loaded once) then land on /portal/:section (a
// DIFFERENT chunk, fetched for the first time by that client-side redirect).
const PortalLogin = lazyWithRetry(() => import("@/pages/portal/login"));
const PortalAccept = lazyWithRetry(() => import("@/pages/portal/accept"));
const PortalSection = lazyWithRetry(() => import("@/pages/portal/section"));

// Set up the fetch interceptor for auth
setupApiInterceptor();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // Don't retry on 401s
      refetchOnWindowFocus: false,
    }
  }
});

// Full-screen fallback shown while a route chunk loads. Responsive on all
// viewports — fills the viewport and centers the spinner on mobile/tablet/desktop.
function PageLoader() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
      {/* Public Routes */}
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />

      {/* Authenticated Routes */}
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/projects" component={ProjectsList} />
      <Route path="/projects/:id" component={ProjectDetail} />

      <Route path="/subcontractors" component={SubcontractorsPage} />
      <Route path="/compliance" component={CompliancePage} />
      <Route path="/qr" component={QrPage} />
      <Route path="/site/:token" component={SiteBoard} />
      <Route path="/team" component={TeamPage} />
      <Route path="/messages" component={MessagesPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/settings" component={SettingsPage} />

      <Route path="/invoices" component={InvoicesPage} />
      <Route path="/daily-reports" component={DailyReportsPage} />
      <Route path="/issues" component={IssuesPage} />
      <Route path="/checkins" component={CheckinsPage} />

      {/* Admin */}
      <Route path="/admin" component={AdminDashboard} />

      {/* Team Portal (member-facing). Login/accept must precede /portal/:section. */}
      <Route path="/portal/login" component={PortalLogin} />
      <Route path="/portal/accept/:token" component={PortalAccept} />
      <Route path="/portal" ><Redirect to="/portal/overview" /></Route>
      <Route path="/portal/:section" component={PortalSection} />

      {/* Fallback */}
      <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SubscriptionProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Suspense fallback={<PageLoader />}>
              <Router />
            </Suspense>
          </WouterRouter>
          <Toaster />
        </SubscriptionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
