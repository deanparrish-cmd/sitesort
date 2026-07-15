import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { isTokenBlocked } from "../lib/token-blocklist";
import { logActivity } from "../lib/activity";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const JWT_SECRET: string = process.env.JWT_SECRET;

export interface AuthUser {
  id: string;
  companyId: string;
  role: string;
  email: string;
  // Team Portal: portal-scoped tokens carry scope:"portal" and the single
  // projectId they are locked to. Absent on normal dashboard tokens.
  scope?: "portal";
  projectId?: string;
  // Portal session id — the server-side session row that enforces the sliding
  // 30-day / 12-hour-inactivity / revoke policy. Absent on dashboard tokens.
  sid?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    if (await isTokenBlocked(token)) {
      res.status(401).json({ error: "unauthorized", message: "Token has been revoked" });
      return;
    }
    req.user = payload;

    // Team Portal containment: a portal-scoped token may ONLY reach the
    // /api/portal/* namespace. Any attempt to hit the main dashboard API (other
    // projects, admin, company data) is denied here — the single choke point on
    // every authenticated route — AND recorded in the audit log so the PM sees
    // out-of-scope attempts. This is the server-side guarantee behind "members
    // never see the main dashboard", independent of what the UI hides.
    if (payload.scope === "portal") {
      const path = req.originalUrl.split("?")[0];
      if (!path.startsWith("/api/portal")) {
        if (payload.projectId) {
          void logActivity({
            userId: payload.id,
            projectId: payload.projectId,
            companyId: payload.companyId,
            section: pathLabel(path),
            action: "blocked",
            req,
          });
        }
        res.status(403).json({ error: "forbidden", message: "This account can only access its project portal." });
        return;
      }
    }

    next();
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
  }
}

// A short label for a blocked out-of-scope path, for the audit feed.
function pathLabel(path: string): string {
  const seg = path.replace(/^\/api\//, "").split("/").filter(Boolean)[0];
  return seg ? `blocked:${seg}` : "blocked";
}

export function generateToken(user: AuthUser): string {
  const { id, companyId, role, email } = user;
  return jwt.sign({ id, companyId, role, email }, JWT_SECRET, { expiresIn: "30d" });
}

// Sign a portal-scoped token locked to a single project. companyId/role are kept
// for completeness but portal tokens are confined to /api/portal/* by authenticate.
export function generatePortalToken(params: {
  id: string;
  email: string;
  companyId: string;
  projectId: string;
  role: string;
  // Server-side session id. The DB session (portal_sessions) is the real
  // lifetime authority; the JWT's own 30d exp is just a coarse backstop.
  sid: string;
}): string {
  return jwt.sign(
    { id: params.id, email: params.email, companyId: params.companyId, role: params.role, scope: "portal", projectId: params.projectId, sid: params.sid },
    JWT_SECRET,
    { expiresIn: "30d" },
  );
}
