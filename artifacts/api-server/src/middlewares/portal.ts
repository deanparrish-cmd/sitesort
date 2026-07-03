import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, projectsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logActivity, isPortalSection, PORTAL_SECTIONS } from "../lib/activity";

declare global {
  namespace Express {
    interface Request {
      // Set by requirePortalMember — the single project a portal token is scoped
      // to, re-validated against project_members on every request.
      portalProjectId?: string;
      portalMemberRole?: string;
    }
  }
}

// Gate for every /api/portal/* member route. Runs AFTER `authenticate` (which
// has already verified the JWT and confined portal tokens to this namespace).
// Re-checks, on every request, that:
//   1. the token is portal-scoped and carries a projectId,
//   2. the caller is STILL an active member of that project (revoking access =
//      deleting the project_members row → immediate 403, not just a hidden UI),
//   3. the project still exists.
// A denial is audited so the PM sees revoked members still trying to get in.
export async function requirePortalMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  const u = req.user;
  if (!u || u.scope !== "portal" || !u.projectId) {
    res.status(403).json({ error: "forbidden", message: "Portal access required." });
    return;
  }

  try {
    const rows = await db
      .select({ role: projectMembersTable.role })
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, u.projectId), eq(projectMembersTable.userId, u.id)))
      .limit(1);

    if (rows.length === 0) {
      void logActivity({ userId: u.id, projectId: u.projectId, companyId: u.companyId, section: "revoked", action: "blocked", req });
      res.status(403).json({ error: "access_revoked", message: "Your access to this project has been removed." });
      return;
    }

    const project = await db
      .select({ id: projectsTable.id, companyId: projectsTable.companyId })
      .from(projectsTable)
      .where(eq(projectsTable.id, u.projectId))
      .limit(1);
    if (project.length === 0) {
      res.status(404).json({ error: "not_found", message: "Project not found." });
      return;
    }

    req.portalProjectId = u.projectId;
    req.portalMemberRole = rows[0].role;
    next();
  } catch (err) {
    req.log.error({ err }, "requirePortalMember failed");
    res.status(500).json({ error: "server_error", message: "Portal access check failed." });
  }
}

// Automatic activity audit for portal reads. Mounted once for the whole member
// router so NO per-page manual logging is needed. Derives the section (and, for
// document views, the item id) from the URL and appends one "view" row. `/me`
// (the shell/context call) and anything that isn't a known section is skipped.
export function autoLogPortalActivity(req: Request, res: Response, next: NextFunction): void {
  const u = req.user;
  if (!u || !req.portalProjectId) return next();

  // req.path here is relative to the /api mount, e.g. "/portal/drawings/abc".
  const segs = req.path.replace(/^\/portal\/?/, "").split("/").filter(Boolean);
  const section = segs[0];
  const itemId = segs[1];

  if (section && isPortalSection(section)) {
    const docSections = new Set(["drawings", "method-statements", "hs", "safety", "general"]);
    void logActivity({
      userId: u.id,
      projectId: req.portalProjectId,
      companyId: u.companyId,
      section,
      action: "view",
      itemType: itemId ? (docSections.has(section) ? "document" : section) : null,
      itemId: itemId ?? null,
      req,
    });
  }
  next();
}

export { PORTAL_SECTIONS };
