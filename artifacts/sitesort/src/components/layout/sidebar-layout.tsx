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
  Mic,
  MicOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useSubscription } from "@/contexts/subscription";
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
  const { isCancelled } = useSubscription();
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);

  // Voice commands
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState(false);
  const recognitionRef = useRef<any>(null);

  const VOICE_COMMANDS: Record<string, string> = {
    "dashboard": "/dashboard", "home": "/dashboard",
    "new project": "/projects?new=1", "create project": "/projects?new=1", "add project": "/projects?new=1",
    "log safety issue": "/projects?safety=1", "report safety issue": "/projects?safety=1", "log hazard": "/projects?safety=1", "report hazard": "/projects?safety=1", "safety issue": "/projects?safety=1",
    "add permit": "/projects?permit=1", "new permit": "/projects?permit=1", "create permit": "/projects?permit=1",
    "upload photo": "/projects?photo=1", "log photo": "/projects?photo=1", "new photo": "/projects?photo=1", "take photo": "/projects?photo=1", "add photo": "/projects?photo=1",
    "recall photos": "/projects?viewphoto=1", "find photos": "/projects?viewphoto=1", "view photos": "/projects?viewphoto=1", "photo log": "/projects?viewphoto=1", "photos": "/projects?viewphoto=1",
    "projects": "/projects", "project": "/projects",
    "new message": "/messages?new=1", "send message": "/messages?new=1", "compose message": "/messages?new=1",
    "dictate message": "/messages?dictate=1", "dictate a message": "/messages?dictate=1",
    "new subcontractor": "/subcontractors?new=1", "add subcontractor": "/subcontractors?new=1",
    "subcontractors": "/subcontractors", "subcontractor": "/subcontractors",
    "compliance": "/compliance", "compliance center": "/compliance", "insurance": "/compliance",
    "new invoice": "/invoices?new=1", "create invoice": "/invoices?new=1", "add invoice": "/invoices?new=1",
    "find invoice": "/invoices?recall=1", "recall invoice": "/invoices?recall=1", "search invoices": "/invoices?recall=1",
    "invoices": "/invoices", "invoice": "/invoices",
    "qr": "/qr", "qr codes": "/qr",
    "team": "/team",
    "messages": "/messages", "message": "/messages", "chat": "/messages",
    "notifications": "/notifications", "alerts": "/notifications",
    "settings": "/settings", "profile": "/settings",
    "billing": "/settings?tab=billing", "subscription": "/settings?tab=billing",
    "admin": "/admin",
  };

  const matchVoiceCommand = (raw: string): string | null => {
    const text = raw.toLowerCase()
      .replace(/^(go to|navigate to|open|show|show me|take me to|visit|switch to|view|see|list|my)\s+/i, "")
      .trim();

    // "project [name]" — after prefix strip, navigate to a specific project by name
    const projectByName = text.match(/^project\s+(.+)/i);
    if (projectByName) return `/projects?openproject=${encodeURIComponent(projectByName[1].trim())}`;

    // "find/search [for] subcontractor[s] [optional term]" — encode inline term if present
    const subFind = text.match(/^(?:find|search(?:\s+for)?)\s+(?:subcontractors?|subs?|contractors?)\s*(.*)/i);
    if (subFind) {
      const term = subFind[1].trim();
      return term ? `/subcontractors?q=${encodeURIComponent(term)}` : `/subcontractors?find=1`;
    }

    // "upload/add compliance/certificate/insurance cert" → prompt upload on compliance page
    const compUpload = text.match(/^(?:upload|add)\s+(?:compliance|certificate|cert|insurance cert(?:ificate)?)\b/i);
    if (compUpload) return "/compliance?upload=1";

    // "find/recall/search compliance/certificate [optional term]"
    const compFind = text.match(/^(?:find|recall|search(?:\s+for)?)\s+(?:compliance|certificate|cert|insurance)\s*(.*)/i);
    if (compFind) {
      const term = compFind[1].trim();
      return term ? `/compliance?q=${encodeURIComponent(term)}` : `/compliance?find=1`;
    }

    // "find/recall/search permit[s] [optional term]" → compliance page filtered
    const permitFind = text.match(/^(?:find|recall|search(?:\s+for)?)\s+(?:permits?)\s*(.*)/i);
    if (permitFind) {
      const term = permitFind[1].trim();
      return term ? `/compliance?q=${encodeURIComponent(term)}` : `/compliance?q=permit`;
    }

    // "find/recall/search photo[s] [optional term]"
    const photoFind = text.match(/^(?:find|recall|search(?:\s+for)?|view)\s+(?:photos?)\s*(.*)/i);
    if (photoFind) return "/projects?viewphoto=1";

    // "send/write/compose [a] message to [name]"
    const msgTo = text.match(/^(?:send|write|compose)\s+(?:a\s+)?message\s+to\s+(.+)/i);
    if (msgTo) return `/messages?to=${encodeURIComponent(msgTo[1].trim())}`;

    if (VOICE_COMMANDS[text]) return VOICE_COMMANDS[text];
    for (const [key, path] of Object.entries(VOICE_COMMANDS)) {
      if (text.includes(key)) return path;
    }
    return null;
  };

  const stopVoiceCommand = useCallback(() => {
    recognitionRef.current?.stop();
    setVoiceListening(false);
    setVoiceHint(false);
  }, []);

  const startVoiceCommand = useCallback(() => {
    if (!voiceSupported) return;
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRec();
    recognition.lang = "en-GB";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const transcript: string = event.results[0][0].transcript;
      const path = matchVoiceCommand(transcript);
      if (path) {
        setLocation(path);
        setIsMobileOpen(false);
        const label = Object.entries(VOICE_COMMANDS).find(([, p]) => p === path)?.[0] ?? path;
        toast({ title: `Navigating to ${label}`, description: `Heard: "${transcript}"` });
      } else {
        toast({ title: "Command not recognised", description: `"${transcript}" — try "go to projects" or "open compliance"`, variant: "destructive" });
      }
      setVoiceListening(false);
      setVoiceHint(false);
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        toast({ title: "Voice error", description: "Could not hear a command. Please try again.", variant: "destructive" });
      }
      setVoiceListening(false);
      setVoiceHint(false);
    };

    recognition.onend = () => {
      setVoiceListening(false);
      setVoiceHint(false);
    };

    recognition.start();
    setVoiceListening(true);
    setVoiceHint(true);
  }, [voiceSupported, setLocation, toast]);

  const toggleVoiceCommand = useCallback(() => {
    if (voiceListening) stopVoiceCommand();
    else startVoiceCommand();
  }, [voiceListening, startVoiceCommand, stopVoiceCommand]);

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);
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
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, badge: 0 },
    { name: "Projects", href: "/projects", icon: Building2, badge: 0 },
    { name: "Subcontractors", href: "/subcontractors", icon: Users, badge: 0 },
    { name: "Compliance Center", href: "/compliance", icon: ShieldCheck, badge: 0 },
    { name: "Invoices", href: "/invoices", icon: Receipt, badge: 0 },
    { name: "QR Codes", href: "/qr", icon: QrCode, badge: 0 },
    { name: "Team", href: "/team", icon: Users, badge: 0 },
    { name: "Messages", href: "/messages", icon: MessageSquare, badge: unreadMsgCount },
    ...(user?.role === "admin"
      ? [{ name: "Admin", href: "/admin", icon: ShieldAlert, badge: 0 }]
      : []),
    { name: "Settings", href: "/settings", icon: Settings, badge: 0 },
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
            <img src={`${import.meta.env.BASE_URL}images/logo.png?v=5`} alt="SiteSort" className="h-16 w-auto shrink-0 object-contain" />
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
                <span className="flex-1">{item.name}</span>
                {item.badge > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                    isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                  )}>{item.badge}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {voiceSupported && (
          <div className="px-4 pb-3">
            <button
              onClick={toggleVoiceCommand}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                voiceListening
                  ? "bg-orange-500 text-white"
                  : "bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              {voiceListening
                ? <MicOff className="w-5 h-5 shrink-0" />
                : <Mic className="w-5 h-5 shrink-0" />}
              <span className="flex-1 text-left">
                {voiceListening ? "Listening…" : "Voice Command"}
              </span>
              {voiceListening && (
                <span className="flex gap-0.5 items-end h-4">
                  {[0, 150, 300].map(d => (
                    <span key={d} className="w-1 bg-white rounded-full animate-bounce" style={{ height: "60%", animationDelay: `${d}ms` }} />
                  ))}
                </span>
              )}
            </button>
          </div>
        )}

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
          {voiceSupported && (
            <button
              onClick={toggleVoiceCommand}
              title={voiceListening ? "Stop listening" : "Voice command"}
              className={cn(
                "p-2 rounded-lg transition-colors",
                voiceListening
                  ? "bg-orange-500 text-white animate-pulse"
                  : "text-muted-foreground hover:text-primary hover:bg-muted"
              )}
            >
              {voiceListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
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

      {/* Voice command hint overlay */}
      {voiceHint && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-2xl shadow-2xl px-6 py-4 max-w-sm w-[calc(100vw-3rem)] animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0 animate-pulse">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <p className="font-semibold text-sm">Listening for a command…</p>
            <button onClick={stopVoiceCommand} className="ml-auto text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Try: <span className="text-gray-200">"new project"</span>, <span className="text-gray-200">"upload photo"</span>, <span className="text-gray-200">"log safety issue"</span>, <span className="text-gray-200">"recall photos"</span>, <span className="text-gray-200">"open compliance"</span>
          </p>
        </div>
      )}
    </div>
  );
}
