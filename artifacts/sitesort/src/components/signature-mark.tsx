import { CheckCircle2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// How a signature was given, said the same way everywhere (Dean, 2026-10-23):
// "Signed with PIN" is a verified signature; "Acknowledged, no PIN" is a tap on
// a signed-in device and is never drawn as equivalent (no green, no shield).
export function signatureLabel(withPin: boolean | null | undefined): string {
  return withPin ? "Signed with PIN" : "Acknowledged, no PIN";
}

export function SignatureMark({ withPin, at, className, iconOnly }: {
  withPin: boolean | null | undefined; at?: string | null; className?: string; iconOnly?: boolean;
}) {
  const label = signatureLabel(withPin);
  const Icon = withPin ? ShieldCheck : CheckCircle2;
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-semibold", withPin ? "text-success" : "text-muted-foreground", className)}
      title={withPin ? "Signed with their 4-digit PIN" : "Acknowledged on a signed-in device. No PIN was asked for."}
      data-testid={withPin ? "signature-pin" : "signature-ack"}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {iconOnly ? <span className="sr-only">{label}</span> : <span>{label}{at ? ` ${at}` : ""}</span>}
    </span>
  );
}

// "2 signed with PIN, 1 acknowledged without a PIN" (parts with 0 left out).
export function signatureCountsText(withPin: number, total: number): string {
  const noPin = Math.max(0, total - withPin);
  const parts: string[] = [];
  if (withPin > 0) parts.push(`${withPin} signed with PIN`);
  if (noPin > 0) parts.push(`${noPin} acknowledged without a PIN`);
  return parts.join(", ");
}
