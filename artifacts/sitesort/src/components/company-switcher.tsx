import { useState, useEffect, useRef } from "react";
import { Building2, ChevronsUpDown, Check, Loader2 } from "lucide-react";

type Membership = { companyId: string; companyName: string; role: string };

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  project_manager: "Project Manager",
  site_worker: "Site Worker",
  subcontractor: "Subcontractor",
};

// Lets a person who belongs to multiple companies switch the active company.
// Renders nothing for single-company users (the common case).
export function CompanySwitcher() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setMemberships(d.memberships ?? []); setActiveId(d.companyId ?? null); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Only show the switcher when there's a real choice to make.
  if (memberships.length <= 1) return null;

  const active = memberships.find(m => m.companyId === activeId) ?? memberships[0];

  async function switchTo(companyId: string) {
    if (companyId === activeId) { setOpen(false); return; }
    setSwitchingTo(companyId);
    try {
      const r = await fetch("/api/auth/switch-company", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (r.ok) {
        const d = await r.json();
        localStorage.setItem("sitesort_token", d.token);
        // Full reload so every query re-fetches in the new company's context.
        window.location.href = "/dashboard";
        return;
      }
    } catch { /* fall through */ }
    setSwitchingTo(null);
  }

  return (
    <div className="px-4 pb-2" ref={ref}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left hover:bg-muted transition-colors"
        >
          <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-foreground truncate">{active.companyName}</span>
            <span className="block text-[11px] text-muted-foreground truncate">{ROLE_LABEL[active.role] ?? active.role}</span>
          </span>
          <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Switch company</p>
            {memberships.map(m => (
              <button
                key={m.companyId}
                type="button"
                disabled={!!switchingTo}
                onClick={() => switchTo(m.companyId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors disabled:opacity-60"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground truncate">{m.companyName}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{ROLE_LABEL[m.role] ?? m.role}</span>
                </span>
                {switchingTo === m.companyId
                  ? <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  : m.companyId === activeId
                    ? <Check className="w-4 h-4 text-primary shrink-0" />
                    : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
