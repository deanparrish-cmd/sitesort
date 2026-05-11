import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShieldAlert, ShieldX, FileSignature, Search, Mic, MicOff, CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type InsuranceItem = { subcontractorId: string; subcontractorName: string; insuranceType: string; expiryDate: string; status: string };
type PermitItem = { permitId: string; projectId: string; projectName: string; permitType: string; expiryDate: string; status: string };
type AckItem = { documentId: string; documentName: string; projectId: string; projectName: string; pendingCount: number };

function daysLeft(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

function fmtDate(s: string) {
  return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ExpiryBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="destructive" className="text-[10px]">Expired</Badge>;
  if (days <= 7) return <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200">Expires in {days}d</Badge>;
  return <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200">Expires in {days}d</Badge>;
}

export default function CompliancePage() {
  const [insurance, setInsurance] = useState<InsuranceItem[]>([]);
  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [acks, setAcks] = useState<AckItem[]>([]);
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
    fetch("/api/compliance", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : { expiringInsurance: [], expiringPermits: [], pendingAcknowledgments: [] })
      .then(d => { setInsurance(d.expiringInsurance ?? []); setPermits(d.expiringPermits ?? []); setAcks(d.pendingAcknowledgments ?? []); })
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
  const filteredIns = insurance.filter(i => !q || i.subcontractorName.toLowerCase().includes(q) || i.insuranceType.toLowerCase().includes(q));
  const filteredPermits = permits.filter(p => !q || p.projectName.toLowerCase().includes(q) || p.permitType.toLowerCase().includes(q));
  const filteredAcks = acks.filter(a => !q || a.documentName.toLowerCase().includes(q) || a.projectName.toLowerCase().includes(q));

  const totalIssues = insurance.length + permits.length + acks.length;

  return (
    <SidebarLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Compliance Centre</h1>
          <p className="text-muted-foreground">Expiring insurance, permits and pending sign-offs across all projects.</p>
        </div>
        {!loading && (
          <span className={cn("text-sm font-semibold px-3 py-1.5 rounded-full border",
            totalIssues === 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-orange-50 text-orange-700 border-orange-200"
          )}>
            {totalIssues === 0 ? "✓ All clear" : `${totalIssues} item${totalIssues !== 1 ? "s" : ""} need attention`}
          </span>
        )}
      </div>

      {/* Voice search */}
      <div className="relative max-w-sm mb-8">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={listening ? "Listening…" : "Search by name, project or type…"}
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
        <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-8">

          {/* Expiring Insurance */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-yellow-600" />
              <h2 className="font-bold text-lg">Expiring Insurance</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredIns.length}</span>
            </div>
            {filteredIns.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No insurance expiring in the next 30 days."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {[...filteredIns].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(ins => {
                  const days = daysLeft(ins.expiryDate);
                  return (
                    <div key={`${ins.subcontractorId}-${ins.insuranceType}`}
                      className={cn("flex items-center justify-between gap-4 px-4 py-3 rounded-xl border",
                        days < 0 ? "bg-red-50 border-red-200" : days <= 7 ? "bg-orange-50 border-orange-200" : "bg-yellow-50 border-yellow-200"
                      )}>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{ins.subcontractorName}</p>
                        <p className="text-xs text-muted-foreground capitalize">{ins.insuranceType.replace(/_/g, " ")}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-xs text-muted-foreground">{fmtDate(ins.expiryDate)}</p>
                        <ExpiryBadge days={days} />
                        <Link href="/subcontractors" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                          View <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Expiring Permits */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldX className="w-5 h-5 text-orange-600" />
              <h2 className="font-bold text-lg">Expiring Permits</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredPermits.length}</span>
            </div>
            {filteredPermits.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No permits expiring in the next 30 days."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {[...filteredPermits].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(p => {
                  const days = daysLeft(p.expiryDate);
                  return (
                    <div key={p.permitId}
                      className={cn("flex items-center justify-between gap-4 px-4 py-3 rounded-xl border",
                        days < 0 ? "bg-red-50 border-red-200" : days <= 7 ? "bg-orange-50 border-orange-200" : "bg-yellow-50 border-yellow-200"
                      )}>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{p.permitType}</p>
                        <p className="text-xs text-muted-foreground">{p.projectName}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-xs text-muted-foreground">{fmtDate(p.expiryDate)}</p>
                        <ExpiryBadge days={days} />
                        <Link href={`/projects/${p.projectId}`} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                          View <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Pending Acknowledgments */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileSignature className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-lg">Pending Sign-offs</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredAcks.length}</span>
            </div>
            {filteredAcks.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No documents awaiting acknowledgment."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredAcks.map(a => (
                  <div key={a.documentId} className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border bg-blue-50 border-blue-200">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{a.documentName}</p>
                      <p className="text-xs text-muted-foreground">{a.projectName}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">{a.pendingCount} pending</Badge>
                      <Link href={`/projects/${a.projectId}`} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                        View <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      )}
    </SidebarLayout>
  );
}
