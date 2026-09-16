import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { projectsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, type Fixture,
  seedCrossTenantPortalMember, portalLogin, cleanupPortalMember, type PortalMemberFixture,
  createTestDocument, cleanupTestDocuments,
} from "./helpers";

/**
 * Team Portal — one real person (same email) holding portal access to
 * projects in TWO DIFFERENT companies (tenants) at once. Added after a live
 * verification session found this mechanism (login/my-projects/switch-project
 * in routes/portal.ts) was undocumented and had zero test coverage, despite
 * being explicitly designed to let one contractor work across builders with a
 * single login (see the comment above POST /projects/:id/portal-invites).
 *
 * These tests prove: (1) one login reaches every project the person holds
 * portal access to, across companies; (2) switching projects is server-side
 * session-scoped, not client-trust — the old session is dead the instant a
 * new one is minted; (3) at no point can data from a company/project the
 * member isn't currently scoped to be read, via the switcher's own query
 * params or by guessing another project/document id.
 */
describe("portal cross-tenant access", () => {
  let companyA: Fixture;
  let companyB: Fixture;
  let companyANoInviteProjectId: string;
  let companyBNoInviteProjectId: string;
  let member: PortalMemberFixture;
  const fixtures: Fixture[] = [];
  const testDocIds: string[] = [];

  beforeAll(async () => {
    companyA = await seedCompany();
    companyB = await seedCompany();
    fixtures.push(companyA, companyB);

    companyANoInviteProjectId = `test-proj-no-invite-a-${randomUUID().slice(0, 8)}`;
    await db.insert(projectsTable).values({
      id: companyANoInviteProjectId, companyId: companyA.companyId,
      name: "Company A - never invited", address: "2 A Street", startDate: "2026-01-01",
    });
    companyBNoInviteProjectId = `test-proj-no-invite-b-${randomUUID().slice(0, 8)}`;
    await db.insert(projectsTable).values({
      id: companyBNoInviteProjectId, companyId: companyB.companyId,
      name: "Company B - never invited", address: "2 B Street", startDate: "2026-01-01",
    });

    const tokenA = await login(companyA.email);
    const tokenB = await login(companyB.email);
    member = await seedCrossTenantPortalMember(
      [{ companyId: companyA.companyId, projectId: companyA.projectId }, { companyId: companyB.companyId, projectId: companyB.projectId }],
      [tokenA, tokenB],
    );

    // A "safety" doc in each no-invite project — safety docs bypass the
    // per-item sharing gate entirely, making them the sharpest isolation
    // probe: if project scoping ever slipped, these are the first thing that
    // would leak.
    const docA = await createTestDocument(companyANoInviteProjectId, tokenA, { name: "A no-invite safety doc", type: "safety" });
    const docB = await createTestDocument(companyBNoInviteProjectId, tokenB, { name: "B no-invite safety doc", type: "safety" });
    testDocIds.push(docA, docB);
  }, 30000);

  afterAll(async () => {
    await cleanupTestDocuments(testDocIds);
    await cleanupPortalMember(member, [companyA.projectId, companyB.projectId, companyANoInviteProjectId, companyBNoInviteProjectId]);
    await db.delete(projectsTable).where(eq(projectsTable.id, companyANoInviteProjectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, companyBNoInviteProjectId));
    await cleanupFixtures(fixtures);
  });

  it("my-projects lists both companies' projects on one login, with correct company names", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const { status, json } = await api("/portal/my-projects", { token });
    expect(status).toBe(200);
    const byId = new Map(json.projects.map((p: any) => [p.id, p]));
    expect(byId.has(companyA.projectId)).toBe(true);
    expect(byId.has(companyB.projectId)).toBe(true);
    expect((byId.get(companyA.projectId) as any).companyName).toBeTruthy();
    expect((byId.get(companyB.projectId) as any).companyName).toBeTruthy();
    expect((byId.get(companyA.projectId) as any).companyName).not.toBe((byId.get(companyB.projectId) as any).companyName);
  });

  it("switch-project moves the session to the other company's project", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const before = await api("/portal/me", { token });
    expect(before.json.project.id).toBe(companyA.projectId);

    const switchRes = await api("/portal/switch-project", { method: "POST", token, body: { projectId: companyB.projectId } });
    expect(switchRes.status).toBe(200);
    expect(switchRes.json.project.id).toBe(companyB.projectId);

    const after = await api("/portal/me", { token: switchRes.json.token });
    expect(after.status).toBe(200);
    expect(after.json.project.id).toBe(companyB.projectId);
  });

  it("switching revokes the old session immediately — the pre-switch token stops working", async () => {
    const { token: oldToken } = await portalLogin(member.email, member.password, companyA.projectId);
    const switchRes = await api("/portal/switch-project", { method: "POST", token: oldToken, body: { projectId: companyB.projectId } });
    expect(switchRes.status).toBe(200);

    const reuse = await api("/portal/me", { token: oldToken });
    expect(reuse.status).toBe(401);
    expect(reuse.json.reason).toBe("revoked");
  });

  it("cannot switch into a project never invited to, even a real project in a company the member already belongs to", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const res = await api("/portal/switch-project", { method: "POST", token, body: { projectId: companyANoInviteProjectId } });
    expect(res.status).toBe(403);
  });

  it("cannot switch into another company's project the member was never invited to", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const res = await api("/portal/switch-project", { method: "POST", token, body: { projectId: companyBNoInviteProjectId } });
    expect(res.status).toBe(403);
  });

  it("a portal token scoped to company A cannot reach the main dashboard API at all", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const res = await api("/companies/mine", { token });
    expect(res.status).toBe(403);
  });

  it("query-string projectId on a portal endpoint is ignored — data always follows the session's own project", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const res = await api(`/portal/overview?projectId=${companyB.projectId}`, { token });
    expect(res.status).toBe(200);
    expect(res.json.project.id).toBe(companyA.projectId);
  });

  it("a safety document in a same-company but non-member project is not reachable by id while scoped elsewhere", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const docId = testDocIds[0]; // lives in companyANoInviteProjectId
    const list = await api("/portal/safety", { token });
    expect((list.json as any[]).some(d => d.id === docId)).toBe(false);
    const dl = await api(`/portal/documents/${docId}/download`, { token });
    expect(dl.status).toBe(404);
  });

  it("a safety document in the OTHER company's project is not reachable by id (cross-tenant IDOR)", async () => {
    const { token } = await portalLogin(member.email, member.password, companyA.projectId);
    const docId = testDocIds[1]; // lives in companyBNoInviteProjectId (different tenant)
    const list = await api("/portal/safety", { token });
    expect((list.json as any[]).some(d => d.id === docId)).toBe(false);
    const dl = await api(`/portal/documents/${docId}/download`, { token });
    expect(dl.status).toBe(404);
  });

  it("login with no projectId lands on the most recently active project, not always the first membership", async () => {
    const first = await portalLogin(member.email, member.password, companyA.projectId);
    expect(first.projectId).toBe(companyA.projectId);
    // Switch to B so B becomes "most recently active" for this member.
    const switchRes = await api("/portal/switch-project", { method: "POST", token: first.token, body: { projectId: companyB.projectId } });
    expect(switchRes.status).toBe(200);

    const plain = await portalLogin(member.email, member.password); // no projectId this time
    expect(plain.projectId).toBe(companyB.projectId);
  });
});
