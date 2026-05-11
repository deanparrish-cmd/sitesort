import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Building2,
  LayoutDashboard,
  Users,
  ShieldCheck,
  Settings,
  Receipt,
  Menu,
  X,
  LogOut,
  Bell,
  QrCode,
  ChevronDown,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { data: user, isLoading, error } = useGetMe();
  const logoutMutation = useLogout();

  useEffect(() => {
    // Redirect to login if unauthenticated
    if (error) {
      setLocation("/login");
    }
  }, [error, setLocation]);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      localStorage.removeItem("sitesort_token");
      setLocation("/login");
    } catch (e) {
      console.error(e);
      // Fallback
      localStorage.removeItem("sitesort_token");
      setLocation("/login");
    }
  };

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Projects", href: "/projects", icon: Building2 },
    { name: "Subcontractors", href: "/subcontractors", icon: Users },
    { name: "Compliance Center", href: "/compliance", icon: ShieldCheck },
    { name: "Invoices", href: "/invoices", icon: Receipt },
    { name: "QR Codes", href: "/qr", icon: QrCode },
    { name: "Team", href: "/team", icon: Users },
    ...(user?.role === "admin"
      ? [{ name: "Admin", href: "/admin", icon: ShieldAlert }]
      : []),
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2">
          <Link href="/dashboard">
            <img src={`${import.meta.env.BASE_URL}images/logo.png?v=5`} alt="SiteSort" className="h-[6.25rem] w-auto" />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/notifications" className="relative p-2 text-muted-foreground hover:text-foreground">
            <Bell className="w-6 h-6" />
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-destructive rounded-full border-2 border-card"></span>
          </Link>
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <button onClick={() => setIsMobileOpen(!isMobileOpen)} className="p-2 text-primary">
            {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-card border-r flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:w-64 lg:w-72",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 hidden md:flex items-center gap-3">
          <Link href="/dashboard">
            <img src={`${import.meta.env.BASE_URL}images/logo.png?v=5`} alt="SiteSort" className="h-[6.25rem] w-auto" />
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/10" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setIsMobileOpen(false)}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                {item.name}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 max-h-screen overflow-y-auto">
        <header className="hidden md:flex h-16 items-center justify-end gap-2 px-8 border-b bg-card/50 backdrop-blur-md sticky top-0 z-30">
          <Link href="/notifications" className="relative p-2 text-muted-foreground hover:text-primary transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full"></span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl hover:bg-muted transition-colors focus:outline-none">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                  {user?.name?.charAt(0) || 'U'}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground leading-tight">{user?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize leading-tight">{user?.role?.replace('_', ' ')}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground ml-1" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <p className="font-semibold text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace('_', ' ')}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <div className="max-w-7xl mx-auto slide-up">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-primary/20 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </div>
  );
}
