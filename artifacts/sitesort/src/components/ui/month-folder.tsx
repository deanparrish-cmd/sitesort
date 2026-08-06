import { useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";

// Month bucketing for "tidy history" lists (check-ins, daily reports, site
// issues): anything from the CURRENT calendar month stays visible as before;
// items from earlier months collapse into one folder row per month.
// Grouping is purely presentational — no data moves anywhere.

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// Split items into { current, byMonth }: current = this calendar month (and
// anything the caller wants to keep out of folders), byMonth = Map of
// month-key → items for every earlier month, newest month first.
export function splitByMonth<T>(items: T[], getIso: (item: T) => string, keepVisible?: (item: T) => boolean): { current: T[]; byMonth: Map<string, T[]> } {
  const nowKey = currentMonthKey();
  const current: T[] = [];
  const byMonth = new Map<string, T[]>();
  for (const item of items) {
    const key = monthKey(getIso(item));
    if (key >= nowKey || (keepVisible && keepVisible(item))) {
      current.push(item);
    } else {
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(item);
    }
  }
  return { current, byMonth: new Map([...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) };
}

export function MonthFolder({ label, count, countLabel, children, testId }: {
  label: string;
  count: number;
  countLabel: string; // singular, e.g. "check-in" / "report" / "issue"
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        data-testid={testId}
      >
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm flex-1 truncate">{label}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{count} {countLabel}{count === 1 ? "" : "s"}</span>
      </button>
      {open && children}
    </div>
  );
}
