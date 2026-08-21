import { useMemo, useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileDown, ShieldCheck, AlertTriangle, RotateCcw, HelpCircle, Loader2 } from "lucide-react";
import { useListPlantItems, getListPlantItemsQueryKey, type PlantItem } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

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

type Bucket = "active" | "overdue" | "returned";
const BUCKET_META: Record<Bucket, { label: string; icon: typeof ShieldCheck; cls: string }> = {
  active: { label: "Active", icon: ShieldCheck, cls: "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30" },
  overdue: { label: "Overdue", icon: AlertTriangle, cls: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30" },
  returned: { label: "Returned", icon: RotateCcw, cls: "bg-muted border-border text-muted-foreground" },
};

function itemLine(item: PlantItem): string {
  const parts = [
    item.quantity ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : null,
    item.location ?? null,
    item.supplierOwnerText ?? item.supplierContactName ?? null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function PlantWeeklyReportDialog({ open, onClose, projectId, projectName }: {
  open: boolean; onClose: () => void; projectId: string; projectName: string;
}) {
  const [anchorDate, setAnchorDate] = useState(() => toISODate(new Date()));
  const weekStart = useMemo(() => toISODate(startOfWeek(new Date(anchorDate + "T12:00:00"))), [anchorDate]);
  const weekEnd = useMemo(() => {
    const end = startOfWeek(new Date(anchorDate + "T12:00:00"));
    end.setDate(end.getDate() + 6);
    return toISODate(end);
  }, [anchorDate]);
  const todayISO = toISODate(new Date());

  const listParams = { category: "plant_equipment" } as const;
  const { data, isLoading } = useListPlantItems(
    projectId,
    listParams,
    { query: { enabled: open && !!projectId, queryKey: getListPlantItemsQueryKey(projectId, listParams) } },
  );
  const items = (data as PlantItem[]) ?? [];

  const { buckets, missing } = useMemo(() => {
    const missing = items.filter(i => !i.onSiteDate || !i.expectedOffHireDate);
    // Hire window [onSiteDate, expectedOffHireDate] intersects the chosen week.
    const inWeek = items.filter(i =>
      i.onSiteDate && i.expectedOffHireDate &&
      i.onSiteDate <= weekEnd && i.expectedOffHireDate >= weekStart,
    );
    const buckets: Record<Bucket, PlantItem[]> = {
      active: inWeek.filter(i => i.status !== "off_hired" && (i.expectedOffHireDate as string) >= todayISO),
      overdue: inWeek.filter(i => i.status !== "off_hired" && (i.expectedOffHireDate as string) < todayISO),
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
    const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } as Intl.DateTimeFormatOptions);
    const section = (bucket: Bucket) => {
      const list = buckets[bucket];
      const meta = BUCKET_META[bucket];
      const rows = list.map(i => `<tr><td>${i.name}</td><td>${i.quantity ?? "-"}${i.unit ? ` ${i.unit}` : ""}</td><td>${i.location ?? "-"}</td><td>${i.supplierOwnerText ?? i.supplierContactName ?? "-"}</td><td>${i.onSiteDate ? fmtShort(i.onSiteDate) : "-"}</td><td>${i.expectedOffHireDate ? fmtShort(i.expectedOffHireDate) : "-"}</td></tr>`).join("");
      return `<section><h2>${meta.label}<span class="count">${list.length}</span></h2>${list.length ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Location</th><th>Supplier/Owner</th><th>On site</th><th>Expected off-hire</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">None this week.</p>`}</section>`;
    };
    const missingRows = missing.map(i => `<tr><td>${i.name}</td><td>${i.quantity ?? "-"}${i.unit ? ` ${i.unit}` : ""}</td><td>${i.location ?? "-"}</td><td>${i.onSiteDate ? fmtShort(i.onSiteDate) : "Missing"}</td><td>${i.expectedOffHireDate ? fmtShort(i.expectedOffHireDate) : "Missing"}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${projectName} · Hired Plant Weekly Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#1a1a1a;background:white}
.page{max-width:900px;margin:0 auto;padding:32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:14px;border-bottom:2px solid #e5e7eb}
.logo{font-size:20px;font-weight:800;color:#ea6c0a;letter-spacing:-0.5px}
.report-label{font-size:10px;color:#6b7280}
.hero{margin-bottom:24px;padding:18px;background:#fff7ed;border-left:4px solid #ea6c0a;border-radius:4px}
.hero h1{font-size:20px;font-weight:800;color:#1f2937;margin-bottom:2px}
.hero .range{color:#6b7280;font-size:12px}
section{margin-bottom:22px}
section h2{font-size:12px;font-weight:700;color:#ea6c0a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #f3f4f6}
.count{background:#f3f4f6;color:#6b7280;font-size:9px;font-weight:700;padding:1px 6px;border-radius:99px;margin-left:6px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;padding:5px 8px;border-bottom:1px solid #e5e7eb;background:#f9fafb}
td{padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}
tr:last-child td{border-bottom:none}
.empty{color:#9ca3af;font-style:italic;padding:8px}
.footer{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#9ca3af;font-size:9px}
@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.page{max-width:100%;padding:16px}section{page-break-inside:avoid}}
</style></head><body><div class="page">
<div class="header"><span class="logo">SiteSort</span><span class="report-label">Hired Plant Weekly Report · Generated ${now}</span></div>
<div class="hero"><h1>${projectName}</h1><p class="range">Week of ${fmtRange(weekStart, weekEnd)}</p></div>
${section("active")}
${section("overdue")}
${section("returned")}
<section><h2>Missing hire details<span class="count">${missing.length}</span></h2>
${missing.length ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Location</th><th>On site</th><th>Expected off-hire</th></tr></thead><tbody>${missingRows}</tbody></table>` : `<p class="empty">None.</p>`}</section>
<div class="footer"><span>${projectName} · SiteSort</span><span>Generated ${now}</span></div>
</div></body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

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
            {(["active", "overdue", "returned"] as Bucket[]).map(bucket => {
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
