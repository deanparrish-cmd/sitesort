import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  level?: "page" | "section";
  className?: string;
}

/**
 * Shared header for every page and project-detail tab: title/description on
 * one side, actions on the other. Stacks to a single column below `sm` so
 * action buttons never squash against the title on narrow screens — this is
 * the ONLY header layout; do not hand-roll a new one.
 */
export function PageHeader({ title, description, icon, badge, actions, level = "page", className }: PageHeaderProps) {
  const HeadingTag = level === "page" ? "h1" : "h2";
  const headingClass = level === "page" ? "text-2xl sm:text-3xl font-bold" : "text-xl font-bold";

  return (
    <div data-ll="header" className={cn("flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4", className)}>
      <div className="min-w-0">
        <HeadingTag className={cn(headingClass, "flex items-center gap-2 flex-wrap break-words")}>
          {icon}
          <span>{title}</span>
          {badge}
        </HeadingTag>
        {description && <p className="text-muted-foreground text-sm mt-1">{description}</p>}
      </div>
      {actions && (
        <div data-ll="actionbar" className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
