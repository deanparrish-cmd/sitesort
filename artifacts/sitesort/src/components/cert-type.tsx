import { useState } from "react";
import { useConfirmPersonCertificationType, type GateVerdict } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck } from "lucide-react";

// Typed certificates (Dean, 2026-10-22). What a certificate IS decides whether
// it counts at the site gate: only a confirmed Public liability does. The name
// someone typed decides nothing. Shared by every place a certificate is added
// or shown, so the wording is the same everywhere.
export type CertTypeValue = "public_liability" | "employers_liability" | "other_insurance" | "qualification";
export const CERT_TYPE_OPTIONS: { value: CertTypeValue; label: string }[] = [
  { value: "public_liability", label: "Public liability insurance" },
  { value: "employers_liability", label: "Employer's liability insurance" },
  { value: "other_insurance", label: "Other insurance" },
  { value: "qualification", label: "Qualification or card (CSCS, SSSTS...)" },
];
export const certTypeLabel = (t?: string | null) => CERT_TYPE_OPTIONS.find(o => o.value === t)?.label ?? "Type not confirmed";
export const CERT_TYPE_SHORT: Record<CertTypeValue, string> = {
  public_liability: "Public liability", employers_liability: "Employer's liability", other_insurance: "Other insurance", qualification: "Qualification",
};

/** Required type picker for adding a certificate. Empty until chosen. */
export function CertTypeSelect({ id, value, onChange, className }: { id: string; value: CertTypeValue | ""; onChange: (v: CertTypeValue) => void; className?: string }) {
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value as CertTypeValue)} aria-label="What this certificate is"
      className={cn("h-7 text-xs rounded-md border border-input bg-background px-2 min-w-0", !value && "text-muted-foreground", className)}>
      <option value="" disabled>What is it?</option>
      {CERT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * An existing certificate with no confirmed type: it doesn't count at the
 * gate. Shows the suggestion from its name and asks a manager to confirm or
 * pick another type. Never applied by itself.
 */
export function CertTypeConfirm({ personId, certId, suggested, canManage, onDone }: {
  personId: string; certId: string; suggested?: string | null; canManage: boolean; onDone: () => void;
}) {
  const confirm = useConfirmPersonCertificationType();
  const [choice, setChoice] = useState<CertTypeValue | "">((suggested as CertTypeValue) ?? "");
  const [err, setErr] = useState("");
  if (!canManage) return <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Type not confirmed: not counted at the gate</span>;
  const save = async () => {
    if (!choice) return;
    setErr("");
    try { await confirm.mutateAsync({ personId, certId, data: { certType: choice } }); onDone(); }
    catch { setErr("Not saved. Try again."); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px]" data-testid="cert-type-confirm">
      <span className="font-semibold text-amber-700 dark:text-amber-400">Type not confirmed, not counted at the gate. Is it:</span>
      <CertTypeSelect id={`cert-type-${certId}`} value={choice} onChange={setChoice} className="h-6 text-[10px]" />
      <button type="button" onClick={save} disabled={!choice || confirm.isPending}
        className="px-2 h-6 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-50">Confirm</button>
      {err && <span className="text-destructive">{err}</span>}
    </span>
  );
}

/** The gate's own verdict, in words, on a card (the one shared rule). */
export function GateVerdictLine({ v, className }: { v?: GateVerdict | null; className?: string }) {
  if (!v) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs font-semibold break-words", v.holds ? "text-destructive" : v.status === "expiring_soon" ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400", className)}
      data-testid="gate-verdict">
      {v.holds ? <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" /> : <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />}
      <span className="min-w-0">{v.reason}</span>
    </p>
  );
}
