import * as React from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type LinkRowTone = "default" | "success" | "warning" | "danger" | "info";

const TONE_DETAIL: Record<LinkRowTone, string> = {
  default: "text-muted-foreground",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  info: "text-blue-600",
};

export interface LinkRowProps {
  /** Cross-page navigation target (renders a wouter Link). */
  href?: string;
  /** In-page action (e.g. switch tab + set a filter). Ignored when href is set. */
  onClick?: () => void;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Primary label — truncates rather than widening the row. */
  label: React.ReactNode;
  /** Optional secondary line under the label. */
  sub?: React.ReactNode;
  /** Right-aligned value / status text (e.g. "1 open"). */
  detail?: React.ReactNode;
  /** Colour of the detail text. */
  tone?: LinkRowTone;
  /** Quieter styling for a zero/complete row that still links through. */
  quiet?: boolean;
  /** Borderless, tighter padding — for compact inline lists (e.g. a snapshot card). */
  plain?: boolean;
  className?: string;
  /** Accessible label when the visible text isn't descriptive enough. */
  ariaLabel?: string;
}

/**
 * A whole-row tap target used for actionable/to-do items across the app.
 * - Full-width, min 44px tap height (mobile-friendly), label truncates.
 * - Visible affordance: right chevron + hover state on desktop.
 * - Use `href` for cross-page deep-links, `onClick` for in-page tab/filter switches.
 * - `quiet` renders the row dimmer for an all-clear/zero state that still links.
 */
export function LinkRow({
  href,
  onClick,
  icon,
  label,
  sub,
  detail,
  tone = "default",
  quiet = false,
  plain = false,
  className,
  ariaLabel,
}: LinkRowProps) {
  const inner = (
    <>
      {icon != null && <span className="shrink-0 flex items-center">{icon}</span>}
      <span className="flex-1 min-w-0">
        <span className={cn("block text-sm font-medium truncate", quiet && "text-muted-foreground")}>
          {label}
        </span>
        {sub != null && (
          <span className="block text-xs text-muted-foreground truncate">{sub}</span>
        )}
      </span>
      {detail != null && (
        <span
          className={cn(
            "text-xs font-medium shrink-0 whitespace-nowrap",
            quiet ? "text-muted-foreground" : TONE_DETAIL[tone],
          )}
        >
          {detail}
        </span>
      )}
      <ChevronRight
        className={cn(
          "w-4 h-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5",
          quiet && "text-muted-foreground/40",
        )}
      />
    </>
  );

  const rowClass = cn(
    "group w-full flex items-center gap-3 min-h-[44px] text-left",
    plain ? "rounded-md px-2 py-2 -mx-2" : "rounded-lg border p-3",
    "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    quiet && "opacity-70 hover:opacity-100",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={rowClass} aria-label={ariaLabel}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={rowClass} aria-label={ariaLabel}>
      {inner}
    </button>
  );
}
