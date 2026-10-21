import { RefreshCw } from "lucide-react";
import { useNewBuild } from "@/lib/use-new-build";

/** Bar shown when a newer build of SiteSort is live than this tab is running. */
export function UpdateBar({ className = "" }: { className?: string }) {
  const newBuild = useNewBuild();
  if (!newBuild) return null;
  return (
    <div role="status" data-testid="update-bar"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm font-semibold border-b bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-900 ${className}`}>
      <span className="flex items-center gap-2 min-w-0 flex-1">
        <RefreshCw className="w-4 h-4 shrink-0" />
        <span className="min-w-0 break-words">SiteSort has been updated. Reload to get the latest version.</span>
      </span>
      <button type="button" onClick={() => window.location.reload()}
        className="shrink-0 rounded-md border border-current/30 bg-background/70 px-3 min-h-11 text-sm font-bold">
        Reload
      </button>
    </div>
  );
}
