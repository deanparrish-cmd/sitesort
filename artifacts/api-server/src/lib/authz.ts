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
import { companyMembersTable, projectsTable, usersTable } from "@workspace/db/schema";
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

/**
 * Register a middleware that already decides who may pass as a declaration,
 * for routes allow() can't serve. Used for the Team Portal guards
 * (middlewares/portal.ts): portal tokens are refused by allow() by design, and
 * requirePortalMember re-checks the caller's live project membership on every
 * request, which IS the portal's "who may call this".
 */
export function declarePolicy<T extends (...args: never[]) => unknown>(fn: T, name: string): T {
  (fn as unknown as Record<symbol, unknown>)[AUTHZ] = true;
  Object.defineProperty(fn, "name", { value: name });
  return fn;
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
// Roles a DASHBOARD login may hold. Anyone outside the company (subcontractors,
// contractors) joins through the Team Portal only (#117), never the dashboard.
export const DASHBOARD_ROLES = ["admin", "project_manager", "site_worker"] as const;

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

/** Company staff with a dashboard login (admin, PM, site worker). */
export const INTERNAL_STAFF = companyRole("admin", "project_manager", "site_worker");

/** SiteSort's own staff (users.platform_admin), re-read from the DB. */
export const PLATFORM_ADMIN: Policy = {
  name: "platformAdmin",
  check: async (req) => {
    const row = (await db.select({ platformAdmin: usersTable.platformAdmin }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1))[0];
    return !!row?.platformAdmin;
  },
};

/**
 * Project approver on a project found from the request (for routes keyed by a
 * child record, e.g. /permits/:permitId). `resolve` returns the project id only
 * if the record belongs to the caller's company; null refuses.
 */
export function projectApproverFor(label: string, resolve: (req: Request) => Promise<string | null>): Policy {
  return {
    name: `projectApproverFor(${label})`,
    check: async (req, role) => {
      if (!role) return false;
      const projectId = await resolve(req);
      return !!projectId && isProjectApprover({ id: req.user!.id, role }, projectId);
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

// ---- Fail closed at runtime ---------------------------------------------------------
/**
 * Walk the router once at startup. Any route that requires a login (has
 * `authenticate` in its chain) but declares no policy is made to refuse every
 * request with 403, and is logged, so a forgotten declaration can't ship as an
 * open endpoint even if the coverage test is skipped. Returns the keys it closed.
 * `authenticate` is passed in (rather than imported) to avoid an import cycle.
 */
export const closedUndeclaredRoutes: string[] = [];
export function enforceDeclaredRoutes(router: { stack: unknown[] }, authenticate: unknown, onUndeclared?: (key: string) => void): string[] {
  const closed: string[] = [];
  const refuse = (_req: Request, res: Response) => {
    res.status(403).json({ error: "forbidden", message: "You don't have permission to do that." });
  };
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const layers: any[] = layer.route.stack ?? [];
        const authLayer = layers.find(l => l.handle === authenticate);
        if (!authLayer || layers.some(l => isAuthzMiddleware(l.handle))) continue;
        authLayer.handle = refuse;
        const methods = Object.keys(layer.route.methods ?? {}).filter(m => layer.route.methods[m]).map(m => m.toUpperCase());
        for (const m of methods) {
          const key = `${m} ${layer.route.path}`;
          closed.push(key);
          closedUndeclaredRoutes.push(key);
          onUndeclared?.(key);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack as any[]);
  return closed;
}
