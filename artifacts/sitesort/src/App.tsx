import { lazy, Suspense } from "react";
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

// Pages — lazy-loaded so each route ships as its own chunk (code splitting).
const LandingPage = lazy(() => import("@/pages/landing"));
const Login = lazy(() => import("@/pages/auth/login"));
const Register = lazy(() => import("@/pages/auth/register"));
const VerifyEmail = lazy(() => import("@/pages/auth/verify-email"));
const ForgotPassword = lazy(() => import("@/pages/auth/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/auth/reset-password"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const ProjectsList = lazy(() => import("@/pages/projects"));
const ProjectDetail = lazy(() => import("@/pages/projects/detail"));
const QrPage = lazy(() => import("@/pages/qr"));
const SiteBoard = lazy(() => import("@/pages/site-board"));
const AdminDashboard = lazy(() => import("@/pages/admin"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const SubcontractorsPage = lazy(() => import("@/pages/subcontractors"));
const CompliancePage = lazy(() => import("@/pages/compliance"));
const TeamPage = lazy(() => import("@/pages/team"));
const MessagesPage = lazy(() => import("@/pages/messages"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const IssuesPage = lazy(() => import("@/pages/issues"));
const CheckinsPage = lazy(() => import("@/pages/checkins"));
const DailyReportsPage = lazy(() => import("@/pages/daily-reports"));

// Team Portal — separate member-facing app section (own login + stripped shell).
const PortalLogin = lazy(() => import("@/pages/portal/login"));
const PortalAccept = lazy(() => import("@/pages/portal/accept"));
const PortalSection = lazy(() => import("@/pages/portal/section"));

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
