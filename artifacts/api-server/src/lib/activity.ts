import type { Request } from "express";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db/schema";
import { generateId } from "./id";
import { logger } from "./logger";

// The fixed set of sections a portal member may open. Server-side allowlist —
// the source of truth for both access enforcement and the activity audit. Keep
// in sync with the portal frontend nav and the PM activity filters.
export const PORTAL_SECTIONS = [
  "overview",
  "shared",
  "progress",
  "team",
  "site-issues",
  "site-board",
  "hs",
  "drawings",
  "method-statements",
  "permits",
  "safety",
  "general",
  "plant-materials",
  "daily-report",
] as const;

export type PortalSection = (typeof PORTAL_SECTIONS)[number];

export function isPortalSection(s: string): s is PortalSection {
  return (PORTAL_SECTIONS as readonly string[]).includes(s);
}

// Human labels for the PM activity feed / summary ("Dean viewed Drawings").
export const SECTION_LABELS: Record<string, string> = {
  overview: "Overview",
  shared: "Shared with me",
  progress: "Progress",
  team: "Team",
  "site-issues": "Site Issues",
  "site-board": "Site Board",
  hs: "H&S",
  drawings: "Drawings",
  "method-statements": "Method Statements",
  permits: "Permits",
  safety: "Safety",
  general: "General",
  "plant-materials": "Plant & Materials",
  "daily-report": "Daily Report",
};

// Append one audit row. Best-effort: auditing must NEVER break the request it is
// auditing, so all failures are swallowed (logged only). userAgent/IP are
// captured from the request when available.
export async function logActivity(params: {
  userId: string;
  projectId: string;
  companyId: string;
  section: string;
  action?: string;
  itemType?: string | null;
  itemId?: string | null;
  metadata?: Record<string, unknown> | null;
  req?: Request;
}): Promise<void> {
  try {
    await db.insert(activityLogTable).values({
      id: generateId(),
      userId: params.userId,
      projectId: params.projectId,
      companyId: params.companyId,
      section: params.section,
      action: params.action ?? "view",
      itemType: params.itemType ?? null,
      itemId: params.itemId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      userAgent: params.req?.headers["user-agent"]?.slice(0, 512) ?? null,
      ipAddress: params.req?.ip ?? null,
    });
  } catch (err) {
    logger.error({ err }, "logActivity failed (audit row dropped)");
  }
}
