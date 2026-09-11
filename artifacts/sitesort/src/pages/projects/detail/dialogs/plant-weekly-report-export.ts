import type { PlantItem } from "@workspace/api-client-react";

export type PlantWeeklyBucket = "active" | "overdue" | "returned";
export type PlantWeeklyBuckets = Record<PlantWeeklyBucket, PlantItem[]>;

export const PLANT_WEEKLY_BUCKET_LABELS: Record<PlantWeeklyBucket, string> = {
  active: "Active",
  overdue: "Overdue",
  returned: "Returned",
};

export function canAccessPlantWeeklyReport(isProjectApprover: boolean): boolean {
  return isProjectApprover;
}

export function escapePlantReportText(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char] as string,
  );
}

function valueOrFallback(value: unknown, fallback = "-"): string {
  return value === null || value === undefined || value === ""
    ? fallback
    : escapePlantReportText(value);
}

function quantityLabel(item: PlantItem): string {
  if (item.quantity === null || item.quantity === undefined) return "-";
  const quantity = escapePlantReportText(item.quantity);
  const unit = item.unit ? ` ${escapePlantReportText(item.unit)}` : "";
  return `${quantity}${unit}`;
}

export function buildPlantWeeklyReportHtml({
  projectName,
  weekLabel,
  generatedLabel,
  buckets,
  missing,
  formatDate,
}: {
  projectName: string;
  weekLabel: string;
  generatedLabel: string;
  buckets: PlantWeeklyBuckets;
  missing: PlantItem[];
  formatDate: (iso: string) => string;
}): string {
  const safeProjectName = escapePlantReportText(projectName);
  const safeWeekLabel = escapePlantReportText(weekLabel);
  const safeGeneratedLabel = escapePlantReportText(generatedLabel);
  const safeDate = (iso?: string | null, fallback = "-") =>
    iso ? escapePlantReportText(formatDate(iso)) : fallback;

  const section = (bucket: PlantWeeklyBucket) => {
    const list = buckets[bucket];
    const label = PLANT_WEEKLY_BUCKET_LABELS[bucket];
    const rows = list.map(item => `<tr><td>${valueOrFallback(item.name)}</td><td>${quantityLabel(item)}</td><td>${valueOrFallback(item.location)}</td><td>${valueOrFallback(item.supplierOwnerText ?? item.supplierContactName)}</td><td>${safeDate(item.onSiteDate)}</td><td>${safeDate(item.expectedOffHireDate)}</td></tr>`).join("");
    return `<section><h2>${label}<span class="count">${list.length}</span></h2>${list.length ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Location</th><th>Supplier/Owner</th><th>On site</th><th>Expected off-hire</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">None this week.</p>`}</section>`;
  };

  const missingRows = missing.map(item => `<tr><td>${valueOrFallback(item.name)}</td><td>${quantityLabel(item)}</td><td>${valueOrFallback(item.location)}</td><td>${safeDate(item.onSiteDate, "Missing")}</td><td>${safeDate(item.expectedOffHireDate, "Missing")}</td></tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${safeProjectName} · Hired Plant Weekly Report</title>
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
<div class="header"><span class="logo">SiteSort</span><span class="report-label">Hired Plant Weekly Report · Generated ${safeGeneratedLabel}</span></div>
<div class="hero"><h1>${safeProjectName}</h1><p class="range">Week of ${safeWeekLabel}</p></div>
${section("active")}
${section("overdue")}
${section("returned")}
<section><h2>Missing hire details<span class="count">${missing.length}</span></h2>
${missing.length ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Location</th><th>On site</th><th>Expected off-hire</th></tr></thead><tbody>${missingRows}</tbody></table>` : `<p class="empty">None.</p>`}</section>
<div class="footer"><span>${safeProjectName} · SiteSort</span><span>Generated ${safeGeneratedLabel}</span></div>
</div></body></html>`;
}