import { useState, useEffect, useRef } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Search, Mic, MicOff, Mail, Phone, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  createdAt: string;
  lastActiveAt: string | null;
};

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 border-purple-200",
  project_manager: "bg-blue-100 text-blue-700 border-blue-200",
  site_worker: "bg-emerald-100 text-emerald-700 border-emerald-200",
  subcontractor: "bg-orange-100 text-orange-700 border-orange-200",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge className={cn("text-[10px] capitalize border", ROLE_STYLES[role] ?? "bg-muted text-muted-foreground border-border")}>
      {role.replace(/_/g, " ")}
    </Badge>
  );
}

function formatLastActive(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const voiceSupported = typeof window !== "undefined" && !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  useEffect(() => {
    const token = localStorage.getItem("sitesort_token");
    fetch("/api/users", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .finally(() => setLoading(false));
  }, []);

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-GB";
    rec.onstart = () => setListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => setSearch(Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(""));
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    rec.start(); recognitionRef.current = rec;
  }

  const q = search.toLowerCase();
  const filtered = members.filter(m =>
    !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
  );

  const byRole = (role: string) => filtered.filter(m => m.role === role);
  const ROLES = ["admin", "project_manager", "site_worker", "subcontractor"];
  const otherRoles = Array.from(new Set(filtered.map(m => m.role).filter(r => !ROLES.includes(r))));

  return (
    <SidebarLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Team</h1>
          <p className="text-muted-foreground">All staff and users in your company account.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground bg-muted px-3 py-1.5 rounded-full border">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </div>
      </div>

      {/* Voice search */}
      <div className="relative max-w-sm mb-8">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={listening ? "Listening…" : "Search by name, email or role…"}
          className={cn("pl-9", voiceSupported ? "pr-10" : "", listening && "border-orange-400 ring-1 ring-orange-400/60")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {voiceSupported && (
          <button type="button" onClick={toggleVoice} title={listening ? "Stop" : "Search by voice"}
            className={cn("absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors",
              listening ? "text-orange-500 animate-pulse" : "text-muted-foreground hover:text-primary")}>
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="font-semibold text-muted-foreground">{q ? "No results match your search." : "No team members found."}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {[...ROLES, ...otherRoles].map(role => {
            const group = byRole(role);
            if (group.length === 0) return null;
            return (
              <section key={role}>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-bold text-sm uppercase tracking-wide text-muted-foreground capitalize">{role.replace(/_/g, " ")}s</h2>
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{group.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map(m => (
                    <Card key={m.id} className="p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="font-extrabold text-primary text-sm">
                            {m.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                        </div>
                        <RoleBadge role={m.role} />
                      </div>
                      <p className="font-bold text-sm mb-0.5">{m.name}</p>
                      <div className="space-y-1 mt-2">
                        <a href={`mailto:${m.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                          <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{m.email}</span>
                        </a>
                        {m.phone && (
                          <a href={`tel:${m.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                            <Phone className="w-3 h-3 shrink-0" />{m.phone}
                          </a>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mt-3">Last active: {formatLastActive(m.lastActiveAt)}</p>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </SidebarLayout>
  );
}
