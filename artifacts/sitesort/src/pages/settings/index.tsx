import { useState, useEffect, useRef } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  Lock,
  Bell,
  Building2,
  Save,
  CheckCircle2,
  AlertCircle,
  Camera,
  CreditCard,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@workspace/api-client-react";

type Tab = "profile" | "security" | "notifications" | "company" | "billing";

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

type StatusMsg = { type: "success" | "error"; text: string };

function StatusBanner({ status }: { status: StatusMsg | null }) {
  if (!status) return null;
  return (
    <div className={cn(
      "flex items-center gap-2 text-sm px-4 py-3 rounded-xl border mb-5",
      status.type === "success"
        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
        : "bg-red-50 border-red-200 text-red-800"
    )}>
      {status.type === "success"
        ? <CheckCircle2 className="w-4 h-4 shrink-0" />
        : <AlertCircle className="w-4 h-4 shrink-0" />}
      {status.text}
    </div>
  );
}

function ProfileTab({ user, onSaved }: { user: { id: string; name: string; email: string; phone?: string | null; role: string; avatarUrl?: string | null }; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(user.name);
    setPhone(user.phone ?? "");
    setAvatarUrl(user.avatarUrl ?? "");
  }, [user.name, user.phone, user.avatarUrl]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("sitesort_token");
      const upRes = await fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!upRes.ok) { setStatus({ type: "error", text: "Image upload failed." }); return; }
      const { url } = await upRes.json();
      const patchRes = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!patchRes.ok) { setStatus({ type: "error", text: "Failed to save avatar." }); return; }
      setAvatarUrl(url);
      setStatus({ type: "success", text: "Avatar updated." });
      onSaved();
    } catch {
      setStatus({ type: "error", text: "Network error. Please try again." });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const save = async () => {
    if (!name.trim()) { setStatus({ type: "error", text: "Name cannot be empty." }); return; }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus({ type: "error", text: data.message ?? "Failed to save." }); return; }
      setStatus({ type: "success", text: "Profile updated successfully." });
      onSaved();
    } catch {
      setStatus({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Profile</h2>
        <p className="text-sm text-muted-foreground">Update your name, photo and contact details.</p>
      </div>
      <StatusBanner status={status} />
      <div className="flex items-center gap-4 mb-6">
        <div className="relative group shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="w-16 h-16 rounded-full object-cover border-2 border-border" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl">
              {name.charAt(0).toUpperCase() || "?"}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarUploading}
            className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-wait"
            title="Change photo"
          >
            <Camera className="w-5 h-5 text-white" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarChange} />
          {avatarUploading && (
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <div>
          <p className="font-semibold text-foreground">{name || "—"}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-primary hover:underline mt-0.5"
            disabled={avatarUploading}
          >
            {avatarUploading ? "Uploading…" : "Change photo"}
          </button>
          <div className="mt-1">
            <Badge className="text-[10px] capitalize bg-muted text-muted-foreground border border-border">
              {user.role.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
      </div>
      <div className="grid gap-4 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" value={user.email} disabled className="bg-muted cursor-not-allowed" />
          <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone number</Label>
          <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 000000" />
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="gap-2">
        <Save className="w-4 h-4" />
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function SecurityTab() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);

  const save = async () => {
    if (!current || !next || !confirm) { setStatus({ type: "error", text: "All fields are required." }); return; }
    if (next.length < 8) { setStatus({ type: "error", text: "New password must be at least 8 characters." }); return; }
    if (next !== confirm) { setStatus({ type: "error", text: "New passwords do not match." }); return; }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus({ type: "error", text: data.message ?? "Failed to change password." }); return; }
      setStatus({ type: "success", text: "Password changed successfully." });
      setCurrent(""); setNext(""); setConfirm("");
    } catch {
      setStatus({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Security</h2>
        <p className="text-sm text-muted-foreground">Change your account password.</p>
      </div>
      <StatusBanner status={status} />
      <div className="grid gap-4 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="current-pw">Current password</Label>
          <Input id="current-pw" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <Input id="new-pw" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" placeholder="Minimum 8 characters" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-pw">Confirm new password</Label>
          <Input id="confirm-pw" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="gap-2">
        <Lock className="w-4 h-4" />
        {saving ? "Changing…" : "Change password"}
      </Button>
    </div>
  );
}

const NOTIF_TOAST_KEY = "sitesort_notif_toast";
const NOTIF_OS_KEY = "sitesort_notif_os";

function NotificationsTab() {
  const [toastEnabled, setToastEnabled] = useState(() => localStorage.getItem(NOTIF_TOAST_KEY) !== "false");
  const [osEnabled, setOsEnabled] = useState(() => localStorage.getItem(NOTIF_OS_KEY) !== "false");
  const [osPermission, setOsPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setOsPermission(Notification.permission);
    }
  }, []);

  const toggleToast = (val: boolean) => {
    setToastEnabled(val);
    localStorage.setItem(NOTIF_TOAST_KEY, String(val));
  };

  const toggleOs = async (val: boolean) => {
    if (val && osPermission === "default") {
      const result = await Notification.requestPermission();
      setOsPermission(result);
      if (result !== "granted") return;
    }
    setOsEnabled(val);
    localStorage.setItem(NOTIF_OS_KEY, String(val));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground">Choose how you want to be notified about activity.</p>
      </div>

      <div className="max-w-md space-y-3">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm">In-app notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">Show a toast popup when you receive new messages.</p>
            </div>
            <Switch checked={toastEnabled} onCheckedChange={toggleToast} />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Browser notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {osPermission === "denied"
                  ? "Blocked by your browser — allow in browser settings to enable."
                  : osPermission === "unsupported"
                  ? "Not supported in this browser."
                  : "Show OS-level notifications even when SiteSort is in the background."}
              </p>
            </div>
            <Switch
              checked={osEnabled && osPermission === "granted"}
              onCheckedChange={toggleOs}
              disabled={osPermission === "denied" || osPermission === "unsupported"}
            />
          </div>
          {osPermission === "denied" && (
            <p className="text-xs text-amber-600 mt-3 border-t pt-3">
              Browser notifications are blocked. To enable them, click the padlock icon in your browser's address bar and allow notifications for this site.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

type Company = { id: string; name: string; size: string; subscriptionTier: string; subscriptionStatus: string; createdAt: string };

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];

function CompanyTab() {
  const [company, setCompany] = useState<Company | null>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);

  useEffect(() => {
    fetch("/api/companies/mine", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) { setCompany(data); setName(data.name); setSize(data.size); }
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!name.trim()) { setStatus({ type: "error", text: "Company name cannot be empty." }); return; }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/companies/mine", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), size }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus({ type: "error", text: data.message ?? "Failed to save." }); return; }
      setCompany(data);
      setStatus({ type: "success", text: "Company settings saved." });
    } catch {
      setStatus({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Company settings</h2>
        <p className="text-sm text-muted-foreground">Update your company's name and size.</p>
      </div>
      <StatusBanner status={status} />

      {company && (
        <div className="flex items-center gap-3 mb-2">
          <Badge className="text-xs capitalize bg-muted text-muted-foreground border border-border">
            {company.subscriptionTier} plan
          </Badge>
          <Badge className={cn(
            "text-xs capitalize border",
            company.subscriptionStatus === "active"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          )}>
            {company.subscriptionStatus}
          </Badge>
        </div>
      )}

      <div className="grid gap-4 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="company-name">Company name</Label>
          <Input id="company-name" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Construction Ltd" />
        </div>
        <div className="space-y-1.5">
          <Label>Company size</Label>
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger>
              <SelectValue placeholder="Select size" />
            </SelectTrigger>
            <SelectContent>
              {COMPANY_SIZES.map(s => (
                <SelectItem key={s} value={s}>{s} employees</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="gap-2">
        <Save className="w-4 h-4" />
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function BillingTab() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("checkout");
    if (result === "success") {
      setStatus({ type: "success", text: "Payment successful! Your subscription is now active." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (result === "cancelled") {
      setStatus({ type: "error", text: "Checkout was cancelled. You can try again any time." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const subscribe = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setStatus({ type: "error", text: data.error ?? "Failed to start checkout." });
        return;
      }
      window.location.href = data.url;
    } catch {
      setStatus({ type: "error", text: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Billing & Subscription</h2>
        <p className="text-sm text-muted-foreground">Manage your SiteSort subscription.</p>
      </div>
      <StatusBanner status={status} />

      <Card className="p-6 max-w-md border-2 border-primary/20 bg-gradient-to-br from-orange-50/50 to-amber-50/30">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">SiteSort Subscription</h3>
            <p className="text-xs text-muted-foreground">Full access to every feature</p>
          </div>
        </div>

        <div className="flex items-baseline gap-1 mb-5">
          <span className="text-4xl font-bold text-foreground">£149</span>
          <span className="text-sm text-muted-foreground">/ month</span>
        </div>

        <ul className="space-y-2 text-sm text-foreground mb-6">
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> Unlimited projects</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> Unlimited team members</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> Document version control</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> QR site boards</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> Compliance tracking</li>
        </ul>

        <Button onClick={subscribe} disabled={loading} className="w-full gap-2">
          <CreditCard className="w-4 h-4" />
          {loading ? "Redirecting to checkout…" : "Subscribe for £149/month"}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center mt-3">
          Secure checkout powered by Stripe. Cancel any time.
        </p>
      </Card>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "company", label: "Company", icon: Building2, adminOnly: true },
  { id: "billing", label: "Billing", icon: CreditCard, adminOnly: true },
];

export default function SettingsPage() {
  const { data: user, refetch } = useGetMe();
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  const visibleTabs = TABS.filter(t => !t.adminOnly || user?.role === "admin");

  return (
    <SidebarLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and company preferences.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Tab nav */}
        <div className="md:w-52 shrink-0">
          <nav className="flex md:flex-col gap-1">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-left w-full",
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/10"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <Card className="flex-1 p-6">
          {user && activeTab === "profile" && (
            <ProfileTab user={user as typeof user & { avatarUrl?: string | null }} onSaved={() => refetch()} />
          )}
          {activeTab === "security" && <SecurityTab />}
          {activeTab === "notifications" && <NotificationsTab />}
          {activeTab === "company" && user?.role === "admin" && <CompanyTab />}
          {activeTab === "billing" && user?.role === "admin" && <BillingTab />}
        </Card>
      </div>
    </SidebarLayout>
  );
}
