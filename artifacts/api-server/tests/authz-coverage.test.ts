import { describe, it, expect } from "vitest";
import express, { Router } from "express";
import { listRoutes } from "./authz-routes";
import { authenticate } from "../src/middlewares/auth";
import { allow, ANY_MEMBER, closedUndeclaredRoutes, enforceDeclaredRoutes } from "../src/lib/authz";

/**
 * Fail closed on the HABIT, not just the instances (#116, finished in #120):
 * every endpoint that needs a login declares who may call it, with allow(...)
 * from src/lib/authz.ts (or, for the Team Portal, the declared portal guards in
 * src/middlewares/portal.ts). There is no legacy allow-list any more: an
 * undeclared route fails this test, and at runtime it is closed (403 for all).
 */
describe("authorisation coverage", () => {
  const routes = listRoutes();
  const authed = routes.filter(r => r.authenticated);

  it("finds the router (sanity)", () => {
    expect(authed.length).toBeGreaterThan(200);
  });

  it("every logged-in endpoint declares who is allowed", () => {
    const undeclared = [...new Set(authed.filter(r => !r.declared).map(r => r.key))];
    expect(undeclared, `Declare allow(...) on: ${undeclared.join(", ")}`).toEqual([]);
    // The runtime guard closed nothing either (it would hide a route from the walk above).
    expect(closedUndeclaredRoutes).toEqual([]);
  });

  it("the routes fixed in #115 / #116 / #120 are declared", () => {
    for (const key of [
      "POST /users", "PATCH /users/:userId", "DELETE /users/:userId",
      "POST /subcontractors/:subcontractorId/insurance", "PATCH /subcontractors/:subcontractorId/insurance/:recordId",
      "POST /projects/:projectId/members/:memberId/insurance-cert",
      "GET /checkins", "GET /projects/:projectId/checkins",
      "POST /projects", "PATCH /projects/:projectId",
      "POST /projects/:projectId/milestones", "DELETE /projects/:projectId/milestones/:milestoneId",
      "POST /projects/:projectId/documents", "PATCH /projects/:projectId/members/:memberId/schedule",
      "GET /portal/me", "POST /portal/logout",
    ]) {
      const r = authed.find(x => x.key === key);
      expect(r, key).toBeTruthy();
      expect(r!.declared, key).toBe(true);
    }
  });

  it("at runtime an undeclared logged-in route refuses everyone, a declared one is untouched", async () => {
    const r = Router();
    const ok = (_req: express.Request, res: express.Response) => { res.json({ reached: true }); };
    r.get("/undeclared", authenticate, ok);
    r.get("/declared", authenticate, allow(ANY_MEMBER), ok);
    r.get("/public", ok);
    const closed = enforceDeclaredRoutes(r, authenticate);
    closedUndeclaredRoutes.length = 0; // this fixture is not the real router
    expect(closed).toEqual(["GET /undeclared"]);

    const app = express().use(r);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
      expect((await get("/undeclared")).status).toBe(403);
      expect((await get("/declared")).status).toBe(401); // still needs a login
      expect((await get("/public")).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
