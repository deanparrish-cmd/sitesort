import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { usersTable, companyMembersTable, notificationsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, dashboardToken, TEST_PASSWORD, type Fixture } from "./helpers";

/**
 * #123: the dashboard is for admins and project managers only. Site workers
 * (like subcontractors, #117) use the Team Portal. A portal-only account, or a
 * deleted account scrubbed to portal-only, is refused on every dashboard
 * request even with a token issued before the change, and a dead admin row
 * never counts as "another admin".
 */
describe("site workers are Team Portal only", () => {
  let co: Fixture;
  const sfx = randomUUID().slice(0, 8);
  const id = { worker: `tpw-wk-${sfx}`, dead: `tpw-dd-${sfx}`, portal: `tpw-po-${sfx}` };
  let admin = "";

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    // A site worker with a dashboard account (as before #123).
    await db.insert(usersTable).values({ id: id.worker, companyId: co.companyId, email: `${id.worker}@example.test`, passwordHash: owner.passwordHash, name: "Wes Worker", role: "site_worker", emailVerified: true });
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: id.worker, companyId: co.companyId, role: "site_worker" });
    // A deleted, scrubbed account still holding an admin row (what the old boot backfill produced).
    await db.insert(usersTable).values({ id: id.dead, companyId: co.companyId, email: `deleted-${id.dead}@removed.invalid`, passwordHash: owner.passwordHash, name: "Gone Admin", role: "admin", emailVerified: true, portalOnly: true });
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: id.dead, companyId: co.companyId, role: "admin" });
    // A Team Portal account.
    await db.insert(usersTable).values({ id: id.portal, companyId: co.companyId, email: `${id.portal}@example.test`, passwordHash: owner.passwordHash, name: "Pat Portal", role: "site_worker", emailVerified: true, portalOnly: true });
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, Object.values(id)));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, Object.values(id)));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(id)));
    await cleanupFixtures([co]);
  });

  it("a site worker can't log in to the dashboard, and an old dashboard token is refused", async () => {
    const r = await api("/auth/login", { method: "POST", body: { email: `${id.worker}@example.test`, password: TEST_PASSWORD } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("use_portal");
    expect(r.json.token).toBeUndefined();
    const stale = await dashboardToken(id.worker, co.companyId, "site_worker", `${id.worker}@example.test`);
    const me = await api("/auth/me", { token: stale });
    expect(me.status).toBe(403);
    expect(me.json.error).toBe("use_portal");
  });

  it("a portal-only (or deleted) account's dashboard token is refused, even one claiming admin", async () => {
    const { generateToken } = await import("../src/middlewares/auth");
    for (const uid of [id.dead, id.portal]) {
      const t = generateToken({ id: uid, companyId: co.companyId, role: "admin", email: `${uid}@example.test` });
      const r = await api("/users", { token: t });
      expect(r.status, uid).toBe(403);
      expect(r.json.error, uid).toBe("use_portal");
    }
  });

  it("a dead admin row doesn't count as another admin: the last real admin can't step down", async () => {
    const r = await api(`/users/${co.userId}`, { method: "PATCH", token: admin, body: { role: "project_manager" } });
    expect(r.status).toBe(400);
    const [m] = await db.select().from(companyMembersTable).where(eq(companyMembersTable.userId, co.userId));
    expect(m.role).toBe("admin");
  });

  it("Add Team Member refuses the site worker role, and won't link a Team Portal account", async () => {
    const sw = await api("/users", { method: "POST", token: admin, body: { email: `tpw-new-${sfx}@example.test`, name: "New Person", role: "site_worker" } });
    expect(sw.status).toBe(400);
    const linked = await api("/users", { method: "POST", token: admin, body: { email: `${id.portal}@example.test`, name: "Pat Portal", role: "project_manager" } });
    expect(linked.status).toBe(400);
    expect(linked.json.error).toBe("portal_account");
    expect(await db.select().from(companyMembersTable).where(eq(companyMembersTable.userId, id.portal))).toHaveLength(0);
  });
});
