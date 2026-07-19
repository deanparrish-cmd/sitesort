import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  Bell,
  MessageSquare,
  FileText,
  AlertTriangle,
  CheckCheck,
  Check,
  CreditCard,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertViewer } from "@/components/alert-viewer";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  relatedEntityId: string | null;
  relatedEntityType: string | null;
  read: boolean;
  createdAt: string;
};

type Filter = "all" | "unread" | "messages" | "documents" | "safety" | "billing";

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function notifIcon(type: string) {
  switch (type) {
    case "new_message":
      return <MessageSquare className="w-5 h-5 text-blue-500" />;
    case "document_uploaded":
      return <FileText className="w-5 h-5 text-indigo-500" />;
    case "safety_concern":
      return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    case "trial_ending":
      return <CreditCard className="w-5 h-5 text-orange-500" />;
    case "payment_failed":
      return <CreditCard className="w-5 h-5 text-red-500" />;
    case "daily_report":
      return <ClipboardCheck className="w-5 h-5 text-teal-500" />;
    case "portal_issue_logged":
      return <AlertTriangle className="w-5 h-5 text-violet-500" />;
    default:
      return <Bell className="w-5 h-5 text-muted-foreground" />;
  }
}

function notifBg(type: string) {
  switch (type) {
    case "new_message":
      return "bg-blue-100";
    case "document_uploaded":
      return "bg-indigo-100";
    case "safety_concern":
      return "bg-amber-100";
    case "trial_ending":
      return "bg-orange-100";
    case "payment_failed":
      return "bg-red-100";
    case "daily_report":
      return "bg-teal-100";
    case "portal_issue_logged":
      return "bg-violet-100";
    default:
      return "bg-muted";
  }
}

function notifLink(n: Notification): string | null {
  if (n.type === "new_message") return "/messages";
  if (n.type === "trial_ending") return "/settings?tab=billing";
  if (n.type === "payment_failed") return "/settings?tab=billing";
  // safety_concern, document_uploaded, daily_report resolved async in handleClick
  return null;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "messages", label: "Messages" },
  { key: "documents", label: "Documents" },
  { key: "safety", label: "Safety" },
  { key: "billing", label: "Billing" },
];

function filterMatch(n: Notification, f: Filter) {
  if (f === "all") return true;
  if (f === "unread") return !n.read;
  if (f === "messages") return n.type === "new_message";
  if (f === "documents") return n.type === "document_uploaded";
  if (f === "safety") return n.type === "safety_concern";
  if (f === "billing") return n.type === "trial_ending" || n.type === "payment_failed";
  return true;
}

export default function NotificationsPage() {
  const [, setLocation] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [markingAll, setMarkingAll] = useState(false);
  const [viewer, setViewer] = useState<{ items: Notification[]; index: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { headers: authHeaders() });
      if (res.ok) setNotifications(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    await fetch(`/api/notifications/${id}/read`, {
      method: "PATCH",
      headers: authHeaders(),
    }).catch(() => {});
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications/read-all", {
        method: "PATCH",
        headers: authHeaders(),
      });
      if (res.ok) setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch { /* silent */ }
    finally { setMarkingAll(false); }
  };

  const handleClick = async (n: Notification) => {
    if (!n.read) await markRead(n.id);

    if (n.type === "daily_report" && n.relatedEntityId) {
      try {
        const res = await fetch(`/api/daily-reports/${n.relatedEntityId}`, { headers: authHeaders() });
        if (res.ok) {
          const r = await res.json();
          setLocation(`/projects/${r.projectId}?tab=reports&report=${n.relatedEntityId}`);
          return;
        }
      } catch { /* fall through */ }
    }

    if (n.type === "safety_concern" && n.relatedEntityId) {
      try {
        const res = await fetch(`/api/photos/${n.relatedEntityId}`, { headers: authHeaders() });
        if (res.ok) {
          const photo = await res.json();
          setLocation(`/projects/${photo.projectId}?tab=photos`);
          return;
        }
      } catch { /* fall through */ }
    }

    if (n.type === "document_uploaded" && n.relatedEntityId) {
      try {
        const res = await fetch(`/api/documents/${n.relatedEntityId}`, { headers: authHeaders() });
        if (res.ok) {
          const doc = await res.json();
          setLocation(`/projects/${doc.projectId}?tab=documents`);
          return;
        }
      } catch { /* fall through */ }
    }

    if (n.type === "portal_issue_logged" && n.relatedEntityId) {
      try {
        const res = await fetch(`/api/photos/${n.relatedEntityId}`, { headers: authHeaders() });
        if (res.ok) {
          const photo = await res.json();
          setLocation(`/projects/${photo.projectId}?tab=issues&issueStatus=new`);
          return;
        }
      } catch { /* fall through */ }
    }

    const link = notifLink(n);
    if (link) setLocation(link);
  };

  const visible = notifications.filter(n => filterMatch(n, filter));
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <SidebarLayout>
      <PageHeader
        className="mb-6"
        title="Notifications"
        badge={unreadCount > 0 && (
          <Badge variant="destructive" className="text-xs px-2 py-0.5">
            {unreadCount} unread
          </Badge>
        )}
        actions={unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            disabled={markingAll}
            className="gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all as read
          </Button>
        )}
      />

      {/* Filter tabs */}
      <div className="flex overflow-x-auto gap-1 mb-4 border-b">
        {FILTERS.map(({ key, label }) => {
          const count = key === "unread"
            ? unreadCount
            : key === "all"
            ? notifications.length
            : notifications.filter(n => filterMatch(n, key)).length;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0",
                filter === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  "ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  filter === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
            <Bell className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground font-medium">
            {filter === "all" ? "No notifications yet" : `No ${filter} notifications`}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map(n => (
            <Card
              key={n.id}
              onClick={() => setViewer({ items: visible, index: visible.indexOf(n) })}
              className={cn(
                "flex items-start gap-4 px-4 py-4 cursor-pointer transition-colors hover:bg-muted/50",
                !n.read && "bg-primary/5 border-primary/20"
              )}
            >
              <div className={cn("w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0", notifBg(n.type))}>
                {notifIcon(n.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn("text-sm leading-snug", !n.read ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                    {n.title}
                  </p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{timeLabel(n.createdAt)}</span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                    {n.read && <Check className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {viewer && (
        <AlertViewer
          items={viewer.items}
          startIndex={viewer.index}
          onOpenItem={handleClick}
          onMarkRead={markRead}
          onClose={() => setViewer(null)}
        />
      )}
    </SidebarLayout>
  );
}
