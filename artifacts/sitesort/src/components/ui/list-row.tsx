import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListRowProps {
  content: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared row for a list item with info on one side and status pills/action
 * buttons on the other (permits, documents, invoices, contacts, etc). Stacks
 * to a single column below `sm` so pills/buttons never overlap the text —
 * never give a row's content and actions a plain `justify-between` without
 * this wrapper.
 */
export function ListRow({ content, actions, className }: ListRowProps) {
  return (
    <div data-ll="row" className={cn("flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl border", className)}>
      <div className="min-w-0 flex-1">{content}</div>
      {actions && (
        <div data-ll="actionbar" className="flex flex-wrap items-center gap-2 shrink-0 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

interface PillGroupProps {
  children: ReactNode;
  className?: string;
}

/** Wraps a group of status pills so they wrap onto their own line instead of overlapping neighbouring content. */
export function PillGroup({ children, className }: PillGroupProps) {
  return (
    <div data-ll="pillgroup" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {children}
    </div>
  );
}

interface PillProps {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}

/** A single status pill. Colour/variant classes are passed in via `className`; structure (shape, wrap-safety) is shared. */
export function Pill({ children, className, icon }: PillProps) {
  return (
    <span data-ll="pill" className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", className)}>
      {icon}
      {children}
    </span>
  );
}
