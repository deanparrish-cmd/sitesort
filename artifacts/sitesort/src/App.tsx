import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupApiInterceptor } from "@/lib/api-setup";

// Pages
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import Login from "@/pages/auth/login";
import Register from "@/pages/auth/register";
import VerifyEmail from "@/pages/auth/verify-email";
import ForgotPassword from "@/pages/auth/forgot-password";
import ResetPassword from "@/pages/auth/reset-password";
import Dashboard from "@/pages/dashboard";
import ProjectsList from "@/pages/projects";
import ProjectDetail from "@/pages/projects/detail";
import QrPage from "@/pages/qr";
import SiteBoard from "@/pages/site-board";
import AdminDashboard from "@/pages/admin";
import InvoicesPage from "@/pages/invoices";
import SubcontractorsPage from "@/pages/subcontractors";
import CompliancePage from "@/pages/compliance";
import TeamPage from "@/pages/team";
import MessagesPage from "@/pages/messages";
import NotificationsPage from "@/pages/notifications";

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

// Placeholder components for unimplemented routes to ensure app runs without errors
const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-center p-8 bg-card border rounded-2xl shadow-sm max-w-md w-full">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-muted-foreground">This feature is currently under construction.</p>
      <a href="/dashboard" className="text-primary mt-4 inline-block hover:underline font-semibold">Return to Dashboard</a>
    </div>
  </div>
);

function Router() {
  return (
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
      <Route path="/settings">
        <PlaceholderPage title="Company Settings" />
      </Route>

      <Route path="/invoices" component={InvoicesPage} />

      {/* Admin */}
      <Route path="/admin" component={AdminDashboard} />

      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
