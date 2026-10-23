import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// One vocabulary for a person's state on a document, used everywhere it is
// shown (Dean, 2026-10-23). Four states, the stronger the evidence the
// stronger the badge:
//   New             sent, not opened                    orange
//   Opened          opened or downloaded in SiteSort    grey outline (never looks like a confirmation)
//   Acknowledged    tapped to confirm, signed-in device grey filled
//   Signed with PIN entered their own PIN               green filled, shield
// State pills are small and square-cornered; buttons are round pills with a
// chevron, so a state is never mistaken for something to tap.
export type DocState = "new" | "opened" | "acknowledged" | "pin";

export const DOC_STATE_LABEL: Record<DocState, string> = {
  new: "New",
  opened: "Opened",
  acknowledged: "Acknowledged",
  pin: "Signed with PIN",
};

const DOC_STATE_TITLE: Record<DocState, string> = {
  new: "Sent to them, not opened yet.",
  opened: "Opened or downloaded in SiteSort. This is not a confirmation.",
  acknowledged: "Tapped to confirm on a signed-in phone or computer. No PIN was asked for.",
  pin: "Signed with their own 4-digit PIN.",
};

const DOC_STATE_STYLE: Record<DocState, string> = {
  new: "bg-accent text-white border-accent",
  opened: "bg-transparent text-muted-foreground border-muted-foreground/60",
  acknowledged: "bg-slate-200 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-700",
  pin: "bg-success text-white border-success",
};

// A distribution row's status (pending / viewed / acknowledged) plus how it
// was signed, as one of the four states.
export function docStateOf(status: string | null | undefined, signedWithPin?: boolean | null): DocState | null {
  if (status === "acknowledged") return signedWithPin ? "pin" : "acknowledged";
  if (status === "viewed") return "opened";
  if (status === "pending") return "new";
  return null;
}

export function DocStatePill({ state, at, count, className }: {
  state: DocState; at?: string | null; count?: number; className?: string;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", DOC_STATE_STYLE[state], className)}
      title={DOC_STATE_TITLE[state]}
      data-testid={`doc-state-${state}`}
    >
      {state === "pin" && <ShieldCheck className="w-3.5 h-3.5 shrink-0" />}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
      <span>{DOC_STATE_LABEL[state]}{at ? ` ${at}` : ""}</span>
    </span>
  );
}

// "2 signed with PIN, 1 acknowledged" (parts with 0 left out).
export function signatureCountsText(withPin: number, total: number): string {
  const noPin = Math.max(0, total - withPin);
  const parts: string[] = [];
  if (withPin > 0) parts.push(`${withPin} signed with PIN`);
  if (noPin > 0) parts.push(`${noPin} acknowledged`);
  return parts.join(", ");
}
