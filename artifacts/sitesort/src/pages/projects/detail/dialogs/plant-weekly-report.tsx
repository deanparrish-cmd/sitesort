import { useMemo, useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileDown, ShieldCheck, AlertTriangle, RotateCcw, HelpCircle, Loader2 } from "lucide-react";
import { useGetPlantWeeklyReport, getGetPlantWeeklyReportQueryKey, type PlantItem } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  buildPlantWeeklyReportHtml,
  PLANT_WEEKLY_BUCKET_LABELS,
  type PlantWeeklyBucket,
} from "./plant-weekly-report-export";

// Monday-start week containing `d`.
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtShort(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const sFmt = s.toLocaleDateString("en-GB", { day: "numeric", month: sameMonth ? undefined : "short" });
  const eFmt = e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${sFmt} to ${eFmt}`;
}

const BUCKET_META: Record<PlantWeeklyBucket, { label: string; icon: typeof ShieldCheck; cls: string }> = {
  active: { label: PLANT_WEEKLY_BUCKET_LABELS.active, icon: ShieldCheck, cls: "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30" },
  overdue: { label: PLANT_WEEKLY_BUCKET_LABELS.overdue, icon: AlertTriangle, cls: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30" },
  returned: { label: PLANT_WEEKLY_BUCKET_LABELS.returned, icon: RotateCcw, cls: "bg-muted border-border text-muted-foreground" },
};

function itemLine(item: PlantItem): string {
  const parts = [
    item.quantity ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : null,
    item.location ?? null,
    item.supplierOwnerText ?? item.supplierContactName ?? null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function PlantWeeklyReportDialog({ open, onClose, projectId, projectName, canAccess }: {
  open: boolean; onClose: () => void; projectId: string; projectName: string; canAccess: boolean;
}) {
  const [anchorDate, setAnchorDate] = useState(() => toISODate(new Date()));
  const weekStart = useMemo(() => toISODate(startOfWeek(new Date(anchorDate + "T12:00:00"))), [anchorDate]);
  const weekEnd = useMemo(() => {
    const end = startOfWeek(new Date(anchorDate + "T12:00:00"));
    end.setDate(end.getDate() + 6);
    return toISODate(end);
  }, [anchorDate]);
  const todayISO = toISODate(new Date());

  const { data, isLoading } = useGetPlantWeeklyReport(
    projectId,
    { query: { enabled: canAccess && open && !!projectId, queryKey: getGetPlantWeeklyReportQueryKey(projectId) } },
  );
  const items = (data as PlantItem[]) ?? [];

  const { buckets, missing } = useMemo(() => {
    const missing = items.filter(i => !i.onSiteDate || !i.expectedOffHireDate);
    // Hire window [onSiteDate, expectedOffHireDate] intersects the chosen week.
    const inWeek = items.filter(i =>
      i.onSiteDate && i.expectedOffHireDate &&
      i.onSiteDate <= weekEnd && i.expectedOffHireDate >= weekStart,
    );
    const buckets: Record<PlantWeeklyBucket, PlantItem[]> = {
      active: inWeek.filter(i => i.status !== "off_hired" && (i.expectedOffHireDate as string) >= todayISO),
      // Overdue is NOT limited to the chosen week: plant still on hire past its
      // expected off-hire date must keep showing until it is off-hired.
      overdue: items
        .filter(i => i.status !== "off_hired" && i.status !== "depleted" && !!i.expectedOffHireDate && i.expectedOffHireDate < todayISO)
        .sort((a, b) => (a.expectedOffHireDate as string).localeCompare(b.expectedOffHireDate as string)),
      returned: inWeek.filter(i => i.status === "off_hired"),
    };
    return { buckets, missing };
  }, [items, weekStart, weekEnd, todayISO]);

  const shiftWeek = (deltaWeeks: number) => {
    const next = new Date(anchorDate + "T12:00:00");
    next.setDate(next.getDate() + deltaWeeks * 7);
    setAnchorDate(toISODate(next));
  };

  const exportReport = () => {
    if (!canAccess) return;
    const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } as Intl.DateTimeFormatOptions);
    const html = buildPlantWeeklyReportHtml({
      projectName,
      weekLabel: fmtRange(weekStart, weekEnd),
      generatedLabel: now,
      buckets,
      missing,
      formatDate: fmtShort,
    });

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  if (!canAccess) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogHeader>
        <DialogTitle>Hired Plant · Weekly Report</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A weekly summary of hired plant and equipment for this project. Not a costing report.
        </p>

        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-muted/20">
          <button type="button" onClick={() => shiftWeek(-1)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Previous week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-center">{fmtRange(weekStart, weekEnd)}</span>
          <button type="button" onClick={() => shiftWeek(1)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Next week">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 max-h-96 overflow-y-auto -mr-1 pr-1">
            {(["active", "overdue", "returned"] as PlantWeeklyBucket[]).map(bucket => {
              const meta = BUCKET_META[bucket];
              const Icon = meta.icon;
              const list = buckets[bucket];
              if (list.length === 0) return null;
              return (
                <div key={bucket}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className="w-3.5 h-3.5" />
                    <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{meta.label}</h4>
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{list.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {list.map(item => (
                      <div key={item.id} className={cn("rounded-lg border px-3 py-2 text-xs", meta.cls)}>
                        <p className="font-semibold">{item.name}</p>
                        {itemLine(item) && <p className="opacity-80">{itemLine(item)}</p>}
                        <p className="opacity-80 mt-0.5">
                          {item.onSiteDate ? fmtShort(item.onSiteDate) : "?"} to {item.expectedOffHireDate ? fmtShort(item.expectedOffHireDate) : "?"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {buckets.active.length === 0 && buckets.overdue.length === 0 && buckets.returned.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No hired plant on record for this week.</p>
            )}

            {missing.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Missing hire details</h4>
                  <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{missing.length}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Not shown by week: set an on-site and expected off-hire date to include these in future reports.</p>
                <div className="space-y-1.5">
                  {missing.map(item => (
                    <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
                      <p className="font-semibold">{item.name}</p>
                      {itemLine(item) && <p className="opacity-80">{itemLine(item)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button variant="accent" onClick={exportReport}>
          <FileDown className="w-4 h-4 mr-1.5" />Export
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
