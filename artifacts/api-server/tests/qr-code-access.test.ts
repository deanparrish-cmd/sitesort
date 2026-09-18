import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { usersTable, companyMembersTable, qrCodesTable, projectMembersTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, TEST_PASSWORD, type Fixture,
  seedCrossTenantPortalMember, portalLogin, cleanupPortalMember, type PortalMemberFixture,
} from "./helpers";

/**
 * The site check-in QR code / URL lets anyone check in, so it must be reachable
 * ONLY by company admins and project managers, enforced by the API itself
 * (not by hiding a button). Portal members and site workers get 403, and the
 * portal Site Board response carries no token or URL.
 */
describe("site QR code access", () => {
  let co: Fixture;
  let adminToken = "";
  let workerToken = "";
  let pmToken = "";
  let portalToken = "";
  let qrToken = "";
  let member: PortalMemberFixture;
  const extraUserIds: string[] = [];

  async function addUser(role: string) {
    const id = `test-user-${randomUUID().slice(0, 8)}`;
    const email = `apitest-${role}-${randomUUID().slice(0, 6)}@sitesort-tests.local`;
    await db.insert(usersTable).values({ id, companyId: co.companyId, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 10), name: `T ${role}`, role, emailVerified: true, portalOnly: false });
    await db.insert(companyMembersTable).values({ id: `test-mem-${id}`, userId: id, companyId: co.companyId, role });
    extraUserIds.push(id);
    return login(email);
  }

  beforeAll(async () => {
    co = await seedCompany();
    adminToken = await login(co.email);
    workerToken = await addUser("site_worker");
    pmToken = await addUser("project_manager");
    const created = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: adminToken, body: { categories: ["site_board"] } });
    qrToken = created.json[0].token;
    member = await seedCrossTenantPortalMember([{ companyId: co.companyId, projectId: co.projectId }], [adminToken]);
    portalToken = (await portalLogin(member.email, member.password, co.projectId)).token;
  });

  afterAll(async () => {
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupPortalMember(member, [co.projectId]);
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    for (const id of extraUserIds) {
      await db.delete(companyMembersTable).where(eq(companyMembersTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
    }
    await cleanupFixtures([co]);
  });

  it("admin and project manager can list the QR code and URL", async () => {
    for (const token of [adminToken, pmToken]) {
      const r = await api(`/projects/${co.projectId}/qr-codes`, { token });
      expect(r.status).toBe(200);
      expect(r.json[0].token).toBe(qrToken);
      expect(r.json[0].siteUrl).toContain(`/site/${qrToken}`);
    }
  });

  it("a site worker gets 403 to list, create and delete, and no token or URL leaks in the body", async () => {
    const list = await api(`/projects/${co.projectId}/qr-codes`, { token: workerToken });
    expect(list.status).toBe(403);
    expect(JSON.stringify(list.json)).not.toContain(qrToken);
    const create = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: workerToken, body: { categories: ["site_board"] } });
    expect(create.status).toBe(403);
    const id = (await api(`/projects/${co.projectId}/qr-codes`, { token: adminToken })).json[0].id;
    expect((await api(`/projects/${co.projectId}/qr-codes/${id}`, { method: "DELETE", token: workerToken })).status).toBe(403);
    // still there
    expect((await api(`/projects/${co.projectId}/qr-codes`, { token: adminToken })).json).toHaveLength(1);
  });

  it("a portal member cannot reach the QR endpoints at all", async () => {
    const r = await api(`/projects/${co.projectId}/qr-codes`, { token: portalToken });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toContain(qrToken);
  });

  it("the portal Site Board response has no QR token or check-in URL anywhere", async () => {
    const r = await api("/portal/site-board", { token: portalToken });
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.json);
    expect(body).not.toContain(qrToken);
    expect(body).not.toMatch(/qrToken|siteUrl|\/site\//);
    expect(Object.keys(r.json)).not.toContain("qrToken");
  });

  it("the public check-in page itself is unchanged (token still resolves the board)", async () => {
    const r = await api(`/site/${qrToken}`);
    expect(r.status).toBe(200);
    expect(r.json.project.id).toBe(co.projectId);
  });
});
