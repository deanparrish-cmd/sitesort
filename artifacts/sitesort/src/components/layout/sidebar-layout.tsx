import { useState, useEffect, useRef, useCallback } from "react";
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
  MessageSquare,
  AlertCircle,
  AlertTriangle,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useSubscription } from "@/contexts/subscription";
import { CheckoutGate } from "@/components/checkout-gate";
import { CompanySwitcher } from "@/components/company-switcher";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function Avatar({ src, name, size }: { src?: string | null; name?: string | null; size: "sm" | "md" }) {
  const cls = size === "sm" ? "w-8 h-8 text-sm" : "w-10 h-10 text-base";
  if (src) return <img src={src} alt={name ?? ""} className={`${cls} rounded-full object-cover border border-border`} />;
  return (
    <div className={`${cls} rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold`}>
      {name?.charAt(0) || "U"}
    </div>
  );
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { data: user, isLoading, error } = useGetMe();
  const logoutMutation = useLogout();
  const { toast } = useToast();
  const { isCancelled, needsCheckout } = useSubscription();
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const prevUnreadRef = useRef(0);

  const fetchUnread = useCallback(async () => {
    try {
      const [msgRes, notifRes] = await Promise.all([
        fetch("/api/messages/unread-count", { headers: authHeaders() }),
        fetch("/api/notifications", { headers: authHeaders() }),
      ]);
      if (msgRes.ok) {
        const { count } = await msgRes.json();
        if (count > prevUnreadRef.current && prevUnreadRef.current !== -1) {
          const diff = count - prevUnreadRef.current;
          if (localStorage.getItem("sitesort_notif_toast") !== "false") {
            toast({
              title: `${diff} new message${diff > 1 ? "s" : ""}`,
              description: "You have unread messages from your team.",
            });
          }
          if (localStorage.getItem("sitesort_notif_os") !== "false" && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification(`${diff} new message${diff > 1 ? "s" : ""}`, {
              body: "You have unread messages from your team.",
              icon: "/images/logo.png",
            });
          }
        }
        prevUnreadRef.current = count;
        setUnreadMsgCount(count);
      }
      if (notifRes.ok) {
        const notifs = await notifRes.json();
        setUnreadNotifCount(notifs.filter((n: { read: boolean }) => !n.read).length);
      }
    } catch { /* silent */ }
  }, [toast]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    prevUnreadRef.current = -1;
    fetchUnread().then(() => {
      setUnreadMsgCount(c => { prevUnreadRef.current = c; return c; });
    });
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Clear message badge when on messages page
  useEffect(() => {
    if (location.startsWith("/messages")) {
      setUnreadMsgCount(0);
      prevUnreadRef.current = 0;
    }
  }, [location]);

  // Clear notification badge when on notifications page
  useEffect(() => {
    if (location.startsWith("/notifications")) {
      setUnreadNotifCount(0);
    }
  }, [location]);

  useEffect(() => {
    // Redirect to login if unauthenticated, preserving ?checkout= so the
    // login page can show the appropriate post-registration message.
    if (error) {
      const params = new URLSearchParams(window.location.search);
      const checkout = params.get("checkout");
      setLocation(checkout ? `/login?checkout=${checkout}` : "/login");
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

  const mainNavItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, badge: 0 },
    { name: "Projects", href: "/projects", icon: Building2, badge: 0 },
    { name: "Contacts", href: "/subcontractors", icon: Users, badge: 0 },
    { name: "In House Team", href: "/team", icon: Users, badge: 0 },
    { name: "Messages", href: "/messages", icon: MessageSquare, badge: unreadMsgCount },
  ];

  const adminNavItems = [
    { name: "Compliance Centre", href: "/compliance", icon: ShieldCheck, badge: 0 },
    { name: "Invoices", href: "/invoices", icon: Receipt, badge: 0 },
    { name: "QR Codes", href: "/qr", icon: QrCode, badge: 0 },
    ...(user?.role === "admin"
      ? [{ name: "Admin", href: "/admin", icon: ShieldAlert, badge: 0 }]
      : []),
    { name: "Settings", href: "/settings", icon: Settings, badge: 0 },
  ];

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  }

  // Registered but never completed Stripe Checkout → hard-block the app until
  // they add a payment method. Closes the "abandon Stripe, use the app free" hole.
  if (needsCheckout) {
    return <CheckoutGate />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2">
          <Link href="/dashboard">
            <img src={`${import.meta.env.BASE_URL}images/logo.png?v=5`} alt="SiteSort" className="w-auto shrink-0 object-contain" style={{ height: '72px' }} />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/notifications" className="relative p-2 text-muted-foreground hover:text-foreground">
            <Bell className="w-6 h-6" />
            {unreadNotifCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-0.5 bg-destructive text-white rounded-full text-[9px] font-bold flex items-center justify-center border border-card">
                {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
              </span>
            )}
          </Link>
          <Avatar src={(user as any)?.avatarUrl} name={user?.name} size="sm" />
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

        {/* Multi-company users: switch the active company (renders nothing for single-company users) */}
        <div className="pt-4 md:pt-0">
          <CompanySwitcher />
        </div>

        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <div className="space-y-1">
            {mainNavItems.map((item) => {
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
                  <span className="flex-1">{item.name}</span>
                  {item.badge > 0 && (
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                      isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                    )}>{item.badge}</span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="my-4 border-t border-border" />

          <div className="space-y-1">
            {adminNavItems.map((item) => {
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
                  <span className="flex-1">{item.name}</span>
                  {item.badge > 0 && (
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                      isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                    )}>{item.badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-4 px-2">
            <Avatar src={(user as any)?.avatarUrl} name={user?.name} size="md" />
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
            {unreadNotifCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-0.5 bg-destructive text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
              </span>
            )}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl hover:bg-muted transition-colors focus:outline-none">
                <Avatar src={(user as any)?.avatarUrl} name={user?.name} size="sm" />
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
        {isCancelled && (
          <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium truncate">
                Your subscription has ended — new projects and edits are restricted.
              </span>
            </div>
            <button
              onClick={() => setLocation("/settings?tab=billing")}
              className="shrink-0 text-sm font-semibold underline underline-offset-2 hover:no-underline whitespace-nowrap"
            >
              Upgrade now
            </button>
          </div>
        )}
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
