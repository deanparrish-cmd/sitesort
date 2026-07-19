import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, projectsTable } from "@workspace/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { logActivity, isPortalSection, PORTAL_SECTIONS } from "../lib/activity";
import { checkAndTouchSession } from "../lib/portal-sessions";

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

// Server-side session enforcement for portal tokens. Runs right after
// `authenticate`, BEFORE membership checks. The portal JWT carries only a
// session id (`sid`); the portal_sessions row is the real authority for the
// sliding-30-day lifetime, the 12-hour inactivity timeout, and explicit
// logout/revoke. On success it slides the window forward (throttled).
// A 401 here (any reason) tells the client to bounce to the portal login.
// Tokens issued before this policy shipped have no `sid` → treated as expired,
// so members simply re-login once.
export async function requirePortalSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const u = req.user;
  if (!u || u.scope !== "portal" || !u.projectId) {
    res.status(403).json({ error: "forbidden", message: "Portal access required." });
    return;
  }
  if (!u.sid) {
    res.status(401).json({ error: "session_expired", message: "Please sign in again." });
    return;
  }
  try {
    const check = await checkAndTouchSession(u.sid, u.id, u.projectId);
    if (!check.ok) {
      const message = check.reason === "inactive"
        ? "You've been signed out after 12 hours of inactivity. Please sign in again."
        : check.reason === "revoked"
        ? "This session has been ended. Please sign in again."
        : "Your session has expired. Please sign in again.";
      res.status(401).json({ error: "session_expired", reason: check.reason, message });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "requirePortalSession failed");
    res.status(500).json({ error: "server_error", message: "Session check failed." });
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
    // Portal access requires an explicit grant: a membership row with person_id set.
    // A plain team membership (person_id NULL) does NOT grant portal access, so a
    // revoked in-house member (person_id cleared) is 403'd here while keeping their
    // team role.
    const rows = await db
      .select({ role: projectMembersTable.role })
      .from(projectMembersTable)
      .where(and(
        eq(projectMembersTable.projectId, u.projectId),
        eq(projectMembersTable.userId, u.id),
        isNotNull(projectMembersTable.personId),
      ))
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

// Gate for a portal WRITE route. Runs AFTER requirePortalMember (needs
// req.portalProjectId set). Re-selects the live project_members row and 403s
// if the requested permission flag is off — enforced server-side so a member
// without the grant can never write even by calling the endpoint directly.
export function requirePortalPermission(permission: "canLogIssues" | "canUpdatePlantMaterials" | "canEditDailyReport") {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const u = req.user;
    if (!u || !req.portalProjectId) {
      res.status(403).json({ error: "forbidden", message: "Portal access required." });
      return;
    }
    try {
      const rows = await db
        .select({
          canLogIssues: projectMembersTable.canLogIssues,
          canUpdatePlantMaterials: projectMembersTable.canUpdatePlantMaterials,
          canEditDailyReport: projectMembersTable.canEditDailyReport,
        })
        .from(projectMembersTable)
        .where(and(
          eq(projectMembersTable.projectId, req.portalProjectId),
          eq(projectMembersTable.userId, u.id),
          isNotNull(projectMembersTable.personId),
        ))
        .limit(1);

      if (rows.length === 0 || !rows[0][permission]) {
        void logActivity({ userId: u.id, projectId: req.portalProjectId, companyId: u.companyId, section: "permission_denied", action: "blocked", req });
        res.status(403).json({ error: "permission_denied", message: "You don't have permission to do this." });
        return;
      }
      next();
    } catch (err) {
      req.log.error({ err }, "requirePortalPermission failed");
      res.status(500).json({ error: "server_error", message: "Permission check failed." });
    }
  };
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
    // Log the view AFTER the response is sent, so this request's own handler sees
    // the PREVIOUS last-viewed time — that's what "unseen since last viewed" and
    // the "Shared with me" highlight compare against. This visit updates the mark
    // for NEXT time.
    res.on("finish", () => {
      void logActivity({
        userId: u.id,
        projectId: req.portalProjectId!,
        companyId: u.companyId,
        section,
        action: "view",
        itemType: itemId ? (docSections.has(section) ? "document" : section) : null,
        itemId: itemId ?? null,
        req,
      });
    });
  }
  next();
}

export { PORTAL_SECTIONS };
