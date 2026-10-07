// Shared authorisation layer (#116). Every authenticated endpoint DECLARES who
// may call it, as route middleware right after `authenticate`:
//
//   router.post("/users", authenticate, allow(COMPANY_MANAGER), handler)
//
// Policies are OR-ed: the caller passes if any one allows them; otherwise 403.
// The role is re-read from company_members (60s cache, busted on change), NOT
// trusted from the JWT, so a demotion takes effect at once instead of when the
// 30-day token expires.
//
// tests/authz-coverage.test.ts walks the whole router and FAILS if an
// authenticated route has no allow(...). Routes that predate this layer are
// listed there and may only be removed from that list, never added to, so a
// new endpoint can't ship without saying who is allowed.
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "@workspace/db";
import { companyMembersTable, projectsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { isProjectApprover } from "./project-authority";

export type Policy = {
  name: string;
  check: (req: Request, role: string | null) => Promise<boolean> | boolean;
};

const AUTHZ = Symbol.for("sitesort.authz");

export function isAuthzMiddleware(fn: unknown): boolean {
  return typeof fn === "function" && (fn as unknown as Record<symbol, unknown>)[AUTHZ] === true;
}

// ---- Current role in the active company, from the DB --------------------------
const roleCache = new Map<string, { role: string | null; at: number }>();
const ROLE_TTL_MS = 60 * 1000;

export async function currentRole(userId: string, companyId: string): Promise<string | null> {
  const key = `${userId}:${companyId}`;
  const hit = roleCache.get(key);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.role;
  const row = (await db.select({ role: companyMembersTable.role }).from(companyMembersTable)
    .where(and(eq(companyMembersTable.userId, userId), eq(companyMembersTable.companyId, companyId))).limit(1))[0];
  const role = row?.role ?? null;
  roleCache.set(key, { role, at: Date.now() });
  return role;
}

export function bustRoleCache(userId: string, companyId: string): void {
  roleCache.delete(`${userId}:${companyId}`);
}

// ---- Policies ---------------------------------------------------------------------
export const COMPANY_ROLES = ["admin", "project_manager", "site_worker", "subcontractor"] as const;

export function companyRole(...roles: string[]): Policy {
  return { name: `companyRole(${roles.join("|")})`, check: (_req, role) => !!role && roles.includes(role) };
}

export const COMPANY_ADMIN = companyRole("admin");
export const COMPANY_MANAGER = companyRole("admin", "project_manager");

/** Company admin / PM, per-project PM cover, or platform admin, on req.params[param]. */
export function projectApprover(param = "projectId"): Policy {
  return {
    name: `projectApprover(${param})`,
    check: async (req, role) => {
      const projectId = req.params[param];
      if (!projectId || !role) return false;
      return isProjectApprover({ id: req.user!.id, role }, projectId);
    },
  };
}

/** The project's designated site manager (projects.site_manager_id), same company. */
export function projectSiteManager(param = "projectId"): Policy {
  return {
    name: `projectSiteManager(${param})`,
    check: async (req) => {
      const projectId = req.params[param];
      if (!projectId) return false;
      const p = (await db.select({ siteManagerId: projectsTable.siteManagerId }).from(projectsTable)
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1))[0];
      return !!p && p.siteManagerId === req.user!.id;
    },
  };
}

/** The caller acting on their own user record (req.params[param]). */
export function self(param = "userId"): Policy {
  return { name: `self(${param})`, check: (req) => req.params[param] === req.user!.id };
}

/** Explicitly open to every member of the company (a deliberate, reviewable choice). */
export const ANY_MEMBER: Policy = { name: "anyMember", check: (_req, role) => !!role };

// ---- The middleware -------------------------------------------------------------
export function allow(...policies: Policy[]): RequestHandler {
  if (policies.length === 0) throw new Error("allow() needs at least one policy");
  const mw = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) { res.status(401).json({ error: "unauthorized", message: "Authentication required" }); return; }
      // Portal tokens never reach dashboard routes (authenticate blocks them),
      // but fail closed here too.
      if (req.user.scope === "portal") { res.status(403).json({ error: "forbidden", message: "Not allowed" }); return; }
      const role = await currentRole(req.user.id, req.user.companyId);
      res.locals.role = role;
      for (const p of policies) {
        if (await p.check(req, role)) { next(); return; }
      }
      res.status(403).json({ error: "forbidden", message: "You don't have permission to do that." });
    } catch (err) {
      next(err);
    }
  };
  (mw as unknown as Record<symbol, unknown>)[AUTHZ] = true;
  Object.defineProperty(mw, "name", { value: `allow(${policies.map(p => p.name).join(" or ")})` });
  return mw;
}
