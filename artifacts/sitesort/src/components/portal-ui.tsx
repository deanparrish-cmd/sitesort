import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

// Shared visual language for the member-facing Team Portal ONLY (never
// imported by dashboard pages) — big tappable tiles/badges/buttons for
// on-site workers on small, cracked, sun-glared screens with gloved or
// muddy hands. Companion to components/user-guide-view.tsx's colored-card
// style, scaled up further for real-world site conditions:
//   - every tap target is >=56px tall (min-h-14)
//   - status is readable from colour alone, before the label is read
//   - colour is used consistently: green = good/current, amber = needs
//     attention, red = problem/superseded, everything else is a distinct
//     "wayfinding" hue reserved for navigation, never status.

// ---- status colour system (green/amber/red = meaning, always) ----
export type StatusTone = "good" | "warning" | "bad" | "info" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  good: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
  info: "bg-blue-600 text-white dark:bg-blue-500",
  neutral: "bg-muted-foreground/70 text-white dark:bg-muted-foreground/50",
};

// Big, solid, colour-filled status badge — the opposite of a thin outline
// pill. Meant to be read at a glance, at arm's length, before the label
// text registers. `icon` is optional (a lucide element, already sized).
export function StatusPill({ tone, children, icon, className }: { tone: StatusTone; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wide shrink-0 whitespace-nowrap",
      TONE_CLASSES[tone],
      className,
    )}>
      {icon}
      {children}
    </span>
  );
}

// ---- navigation tiles (Home screen "big coloured boxes") ----
// A distinct hue per destination — wayfinding colour, never confused with
// the green/amber/red status system above since it always appears on a
// big icon tile, never as a small inline badge.
export type TileTheme = "orange" | "blue" | "violet" | "teal" | "indigo" | "rose" | "amber" | "green" | "slate" | "sky";

const TILE_THEME_CLASSES: Record<TileTheme, { bg: string; icon: string; ring: string }> = {
  orange: { bg: "bg-accent/10", icon: "text-accent", ring: "focus-visible:ring-accent" },
  blue: { bg: "bg-blue-500/10", icon: "text-blue-600 dark:text-blue-400", ring: "focus-visible:ring-blue-500" },
  violet: { bg: "bg-violet-500/10", icon: "text-violet-600 dark:text-violet-400", ring: "focus-visible:ring-violet-500" },
  teal: { bg: "bg-teal-500/10", icon: "text-teal-600 dark:text-teal-400", ring: "focus-visible:ring-teal-500" },
  indigo: { bg: "bg-indigo-500/10", icon: "text-indigo-600 dark:text-indigo-400", ring: "focus-visible:ring-indigo-500" },
  rose: { bg: "bg-rose-500/10", icon: "text-rose-600 dark:text-rose-400", ring: "focus-visible:ring-rose-500" },
  amber: { bg: "bg-amber-500/10", icon: "text-amber-600 dark:text-amber-400", ring: "focus-visible:ring-amber-500" },
  green: { bg: "bg-emerald-500/10", icon: "text-emerald-600 dark:text-emerald-400", ring: "focus-visible:ring-emerald-500" },
  slate: { bg: "bg-slate-500/10", icon: "text-slate-600 dark:text-slate-400", ring: "focus-visible:ring-slate-500" },
  sky: { bg: "bg-sky-500/10", icon: "text-sky-600 dark:text-sky-400", ring: "focus-visible:ring-sky-500" },
};

// A large tappable tile: icon in a colour-tinted circle, bold label, and an
// unseen count badge when there's something new. min-h-[88px] plus generous
// padding keeps this well clear of the 56px tap-target minimum even with a
// two-line label.
export function PortalTile({ href, label, Icon, theme, unseen }: { href: string; label: string; Icon: React.ComponentType<{ className?: string }>; theme: TileTheme; unseen?: number }) {
  const t = TILE_THEME_CLASSES[theme];
  return (
    <Link
      href={href}
      className={cn(
        "relative flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 min-h-[88px]",
        "hover:border-primary/40 active:scale-[0.98] transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        t.ring,
      )}
    >
      <span className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", t.bg)}>
        <Icon className={cn("w-6 h-6", t.icon)} />
      </span>
      <span className="text-base font-display font-bold leading-tight">{label}</span>
      {!!unseen && (
        <span
          aria-label={`${unseen} unseen`}
          className="absolute top-3 right-3 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center shadow-sm"
        >
          {unseen > 99 ? "99+" : unseen}
        </span>
      )}
    </Link>
  );
}

// A full-width, big tappable "go here" row — used where a grid tile doesn't
// fit (e.g. inside a card, as a single link). Chevron makes it obviously
// tappable without relying on colour or underline alone.
export function PortalLinkRow({ href, label, Icon, theme, unseen }: { href: string; label: string; Icon: React.ComponentType<{ className?: string }>; theme: TileTheme; unseen?: number }) {
  const t = TILE_THEME_CLASSES[theme];
  return (
    <Link
      href={href}
      className="flex items-center gap-3 min-h-14 px-4 py-3 rounded-xl border border-border bg-card hover:border-primary/40 active:scale-[0.98] transition-all duration-150"
    >
      <span className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", t.bg)}>
        <Icon className={cn("w-5 h-5", t.icon)} />
      </span>
      <span className="flex-1 text-base font-bold truncate">{label}</span>
      {!!unseen && (
        <span aria-label={`${unseen} unseen`} className="shrink-0 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
          {unseen > 99 ? "99+" : unseen}
        </span>
      )}
      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
    </Link>
  );
}

// Big primary/secondary button — 56px minimum height, bold label, generous
// horizontal padding so a gloved thumb can't miss it. `tone` picks the
// fill; `full` stretches to the row (the common case for a single primary
// action per row, per the portal's one-action-per-row layout rule).
export function PortalButton({
  children, onClick, type = "button", disabled, tone = "primary", full = true, icon, className,
}: {
  children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean;
  tone?: "primary" | "outline" | "success" | "danger-outline"; full?: boolean; icon?: React.ReactNode; className?: string;
}) {
  const toneClasses: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    success: "bg-success text-success-foreground hover:bg-success/90",
    outline: "bg-card border-2 border-border text-foreground hover:bg-muted",
    "danger-outline": "bg-card border-2 border-destructive/40 text-destructive hover:bg-destructive/10",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 min-h-14 px-5 rounded-xl text-base font-bold",
        "active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:active:scale-100",
        full && "w-full",
        toneClasses[tone],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
