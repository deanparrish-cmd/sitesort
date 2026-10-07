import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { listRoutes } from "./authz-routes";

/**
 * Fail closed on the HABIT, not just the instances (#116): every endpoint that
 * needs a login must declare who may call it with allow(...) from
 * src/lib/authz.ts.
 *
 * authz-legacy-undeclared.json lists routes written before this rule. It may
 * only SHRINK: declare allow(...) on a listed route and delete its line here.
 * Never add a line to get a new endpoint past this test; declare its policy
 * (use ANY_MEMBER if it genuinely is for everyone, so that is a visible choice).
 */
const LEGACY: string[] = JSON.parse(readFileSync(new URL("./authz-legacy-undeclared.json", import.meta.url), "utf8"));

describe("authorisation coverage", () => {
  const routes = listRoutes();
  const authed = routes.filter(r => r.authenticated);

  it("finds the router (sanity)", () => {
    expect(authed.length).toBeGreaterThan(100);
  });

  it("no NEW logged-in endpoint ships without declaring who is allowed", () => {
    const undeclared = [...new Set(authed.filter(r => !r.declared).map(r => r.key))];
    const newOnes = undeclared.filter(k => !LEGACY.includes(k));
    expect(newOnes, `Declare allow(...) on: ${newOnes.join(", ")}`).toEqual([]);
  });

  it("the legacy list only shrinks: declared or deleted routes must be removed from it", () => {
    const stillUndeclared = new Set(authed.filter(r => !r.declared).map(r => r.key));
    const stale = LEGACY.filter(k => !stillUndeclared.has(k));
    expect(stale, `Remove from authz-legacy-undeclared.json: ${stale.join(", ")}`).toEqual([]);
  });

  it("the routes fixed in #115 / #116 are declared", () => {
    for (const key of [
      "POST /users", "PATCH /users/:userId", "DELETE /users/:userId",
      "POST /subcontractors/:subcontractorId/insurance", "PATCH /subcontractors/:subcontractorId/insurance/:recordId",
      "POST /projects/:projectId/members/:memberId/insurance-cert",
      "GET /checkins", "GET /projects/:projectId/checkins",
      "POST /projects", "PATCH /projects/:projectId",
    ]) {
      const r = authed.find(x => x.key === key);
      expect(r, key).toBeTruthy();
      expect(r!.declared, key).toBe(true);
    }
  });
});
