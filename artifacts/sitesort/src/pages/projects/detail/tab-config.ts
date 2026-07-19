import type { Capabilities } from "@/hooks/use-capabilities";

export type TabDef = { value: string; label: string };

type Caps = Pick<Capabilities, "isInternal" | "canManageProjects">;

export function buildManagementTabs(caps: Caps, openIssueCount: number): TabDef[] {
  return [
    { value: "overview", label: "Overview" },
    { value: "progress", label: "Progress" },
    { value: "team", label: "Team" },
    { value: "issues", label: openIssueCount > 0 ? `Site Issues (${openIssueCount})` : "Site Issues" },
    { value: "qr", label: "Site Board" },
    { value: "documents", label: "Documents" },
    { value: "plant", label: "Plant & Materials" },
    { value: "permits", label: "H&S" },
    ...(caps.canManageProjects ? [{ value: "closeout", label: "Close-out" }] : []),
  ];
}

export function buildActivityTabs(caps: Caps, checkinCount: number): TabDef[] {
  return [
    { value: "finances", label: "Finances & Expiry" },
    { value: "checkins", label: `Check-ins${checkinCount > 0 ? ` (${checkinCount})` : ""}` },
    ...(caps.isInternal ? [{ value: "reports", label: "Daily Reports" }] : []),
    ...(caps.canManageProjects ? [{ value: "teamportal", label: "Team Portal" }] : []),
  ];
}
