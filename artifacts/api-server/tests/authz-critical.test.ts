import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import {
  usersTable, companyMembersTable, projectMembersTable, projectsTable, subcontractorsTable,
  insuranceRecordsTable, siteCheckinsTable, activityLogTable, notificationsTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * #116: the three critical holes, proven closed by calling the API DIRECTLY
 * with each role's own login token (never through the screens):
 *  1. privilege escalation: creating / promoting admins
 *  2. forging insurance certificates
 *  3. reading check-ins (names, photos, GPS)
 */
describe("critical authorisation fixes, by direct API call per role", () => {
  let co: Fixture;
  const tok: Record<string, string> = {};
  const sfx = randomUUID().slice(0, 8);
  const id = {
    pm: `tcz-pm-${sfx}`, worker: `tcz-wk-${sfx}`, sub: `tcz-sb-${sfx}`, cover: `tcz-cv-${sfx}`,
    sitemgr: `tcz-sm-${sfx}`, demoted: `tcz-dm-${sfx}`, admin2: `tcz-ad-${sfx}`,
  };
  const card = `tcz-card-${sfx}`;
  const newEmail = (k: string) => `tcz-new-${k}-${sfx}@example.test`;
  const usersByEmail = (email: string) => db.select().from(usersTable).where(eq(usersTable.email, email));

  beforeAll(async () => {
    co = await seedCompany();
    tok.admin = await login(co.email);
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    const add = async (uid: string, role: string, project: { isProjectManager?: boolean } | null) => {
      await db.insert(usersTable).values({ id: uid, companyId: co.companyId, email: `${uid}@example.test`, passwordHash: owner.passwordHash, name: `Name ${uid}`, role, emailVerified: true });
      await db.insert(companyMembersTable).values({ id: randomUUID(), userId: uid, companyId: co.companyId, role });
      if (project) await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: uid, isProjectManager: !!project.isProjectManager } as any);
      return login(`${uid}@example.test`);
    };
    tok.pm = await add(id.pm, "project_manager", {});
    tok.worker = await add(id.worker, "site_worker", {});
    tok.sub = await add(id.sub, "subcontractor", {});
    tok.cover = await add(id.cover, "site_worker", { isProjectManager: true });
    tok.sitemgr = await add(id.sitemgr, "site_worker", {});
    tok.demoted = await add(id.demoted, "project_manager", {});
    await add(id.admin2, "admin", null);
    await db.insert(subcontractorsTable).values({ id: card, companyId: co.companyId, companyName: "Forge Ltd", contactName: "For Ger", contactEmail: `fg-${sfx}@example.test` });
    await db.insert(siteCheckinsTable).values({ id: `tcz-ci-${sfx}`, projectId: co.projectId, workerName: "Private Person", companyName: "Other Ltd", photoUrl: "/api/uploads/x.jpg", lat: 53.8, lng: -1.5 });
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    const created = (await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `tcz-new-%-${sfx}@example.test`))).map(u => u.id);
    const all = [...Object.values(id), ...created];
    await db.update(projectsTable).set({ siteManagerId: null }).where(eq(projectsTable.id, co.projectId));
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, all));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, card));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, card));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, all));
    await db.delete(usersTable).where(inArray(usersTable.id, all));
    await cleanupFixtures([co]);
  });

  // ---- 1. Privilege escalation ------------------------------------------------
  it("a site worker calling the API directly can't create an admin (or anyone)", async () => {
    const r = await api("/users", { method: "POST", token: tok.worker, body: { email: newEmail("wk"), name: "Evil Admin", role: "admin" } });
    expect(r.status).toBe(403);
    expect(await usersByEmail(newEmail("wk"))).toHaveLength(0);
    expect((await api("/users", { method: "POST", token: tok.worker, body: { email: newEmail("wk2"), name: "Some Body", role: "site_worker" } })).status).toBe(403);
  });

  it("a subcontractor's dashboard login can't add users", async () => {
    expect((await api("/users", { method: "POST", token: tok.sub, body: { email: newEmail("sb"), name: "Evil Admin", role: "admin" } })).status).toBe(403);
    expect(await usersByEmail(newEmail("sb"))).toHaveLength(0);
  });

  it("a PM can add staff but not admins; an admin can add an admin; unknown roles are rejected", async () => {
    expect((await api("/users", { method: "POST", token: tok.pm, body: { email: newEmail("pmadm"), name: "Not Allowed", role: "admin" } })).status).toBe(403);
    expect((await api("/users", { method: "POST", token: tok.pm, body: { email: newEmail("pmok"), name: "Site Person", role: "site_worker" } })).status).toBe(201);
    expect((await api("/users", { method: "POST", token: tok.admin, body: { email: newEmail("bad"), name: "Bad Role", role: "superuser" } })).status).toBe(400);
    expect((await api("/users", { method: "POST", token: tok.admin, body: { email: newEmail("adm"), name: "Real Admin", role: "admin" } })).status).toBe(201);
  });

  it("a PM can't promote anyone (themselves included) to admin, demote an admin, or remove one", async () => {
    expect((await api(`/users/${id.worker}`, { method: "PATCH", token: tok.pm, body: { role: "admin" } })).status).toBe(403);
    expect((await api(`/users/${id.pm}`, { method: "PATCH", token: tok.pm, body: { role: "admin" } })).status).toBe(403);
    expect((await api(`/users/${id.admin2}`, { method: "PATCH", token: tok.pm, body: { role: "site_worker" } })).status).toBe(403);
    expect((await api(`/users/${id.admin2}`, { method: "DELETE", token: tok.pm })).status).toBe(403);
    expect((await api(`/users/${id.worker}`, { method: "PATCH", token: tok.worker, body: { role: "admin" } })).status).toBe(403);
    const roles = await db.select().from(companyMembersTable).where(inArray(companyMembersTable.userId, [id.worker, id.pm, id.admin2]));
    expect(Object.fromEntries(roles.map(r => [r.userId, r.role]))).toEqual({ [id.worker]: "site_worker", [id.pm]: "project_manager", [id.admin2]: "admin" });
  });

  it("a demotion takes effect at once, not when the old login expires", async () => {
    expect((await api("/users", { method: "POST", token: tok.demoted, body: { email: newEmail("dm1"), name: "Before Demotion", role: "site_worker" } })).status).toBe(201);
    expect((await api(`/users/${id.demoted}`, { method: "PATCH", token: tok.admin, body: { role: "site_worker" } })).status).toBe(200);
    // Same (old) token still says project_manager inside; the server re-reads the role.
    expect((await api("/users", { method: "POST", token: tok.demoted, body: { email: newEmail("dm2"), name: "After Demotion", role: "site_worker" } })).status).toBe(403);
  });

  // ---- 2. Insurance forging -----------------------------------------------------
  it("a subcontractor or site worker can't file or edit an insurance certificate", async () => {
    const forged = { type: "public_liability", certificateUrl: "/api/uploads/fake.pdf", expiryDate: "2099-01-01" };
    expect((await api(`/subcontractors/${card}/insurance`, { method: "POST", token: tok.sub, body: forged })).status).toBe(403);
    expect((await api(`/subcontractors/${card}/insurance`, { method: "POST", token: tok.worker, body: forged })).status).toBe(403);
    expect(await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, card))).toHaveLength(0);

    const real = await api(`/subcontractors/${card}/insurance`, { method: "POST", token: tok.pm, body: { ...forged, expiryDate: "2026-01-01" } });
    expect(real.status).toBe(201);
    const recordId = real.json.id;
    expect((await api(`/subcontractors/${card}/insurance/${recordId}`, { method: "PATCH", token: tok.sub, body: { expiryDate: "2099-01-01" } })).status).toBe(403);
    expect((await api(`/subcontractors/${card}/insurance/${recordId}`, { method: "PATCH", token: tok.worker, body: { expiryDate: "2099-01-01" } })).status).toBe(403);
    const [rec] = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.id, recordId));
    expect(String(rec.expiryDate).slice(0, 10)).toBe("2026-01-01");
  });

  // ---- 3. Check-in data ---------------------------------------------------------
  it("company-wide check-ins: refused to site workers and subcontractors, allowed to admin / PM", async () => {
    expect((await api("/checkins", { token: tok.worker })).status).toBe(403);
    expect((await api("/checkins", { token: tok.sub })).status).toBe(403);
    expect((await api("/checkins", { token: tok.cover })).status).toBe(403); // per-project cover isn't company-wide
    const ok = await api("/checkins", { token: tok.pm });
    expect(ok.status).toBe(200);
    expect(ok.json.some((c: any) => c.workerName === "Private Person")).toBe(true);
  });

  it("a project's check-ins: its approvers and its site manager only", async () => {
    const path = `/projects/${co.projectId}/checkins`;
    expect((await api(path, { token: tok.worker })).status).toBe(403);
    expect((await api(path, { token: tok.sub })).status).toBe(403);
    expect((await api(path, { token: tok.sitemgr })).status).toBe(403);
    expect((await api(`/projects/${co.projectId}`, { method: "PATCH", token: tok.admin, body: { siteManagerId: id.sitemgr } })).status).toBe(200);
    expect((await api(path, { token: tok.sitemgr })).status).toBe(200);
    expect((await api(path, { token: tok.cover })).status).toBe(200);
    expect((await api(path, { token: tok.admin })).status).toBe(200);
  });
});
