import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared "OVERDUE" flag (F1) — one badge reused across snags, safety concerns,
// permits and certs so an overdue item looks the same everywhere. Render it only
// when the record's derived `overdue` is true.
export function OverdueBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide",
        className,
      )}
    >
      <AlertTriangle className="w-3 h-3" /> Overdue
    </span>
  );
}
