import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { usersTable, companyMembersTable, projectMembersTable, projectsTable, companiesTable, activityLogTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, dashboardToken, type Fixture } from "./helpers";
import { generateToken } from "../src/middlewares/auth";

/**
 * Project edit / create are approver-only ON THE SERVER, not just behind a
 * hidden button. Every call here goes straight to the API with that role's own
 * login token, the way someone would from the browser's developer tools.
 */
describe("project edit and create: role checks below the buttons", () => {
  let co: Fixture;
  let other: Fixture;
  let admin = "", pm = "", worker = "", sub = "", cover = "", otherAdmin = "";
  const sfx = randomUUID().slice(0, 8);
  const ids = { pm: `tusr-pm-${sfx}`, worker: `tusr-wk-${sfx}`, sub: `tusr-sb-${sfx}`, cover: `tusr-cv-${sfx}` };
  const created: string[] = [];

  const project = async () => (await db.select().from(projectsTable).where(eq(projectsTable.id, co.projectId)))[0];
  const patch = (token: string, body: object) => api(`/projects/${co.projectId}`, { method: "PATCH", token, body });
  const logs = () => db.select().from(activityLogTable).where(and(eq(activityLogTable.projectId, co.projectId), eq(activityLogTable.itemType, "project")));
  // The activity record is written in the background after the response.
  const lastLog = async () => {
    await new Promise(r => setTimeout(r, 400));
    return (await db.select().from(activityLogTable).where(and(eq(activityLogTable.projectId, co.projectId), eq(activityLogTable.itemType, "project"))).orderBy(desc(activityLogTable.createdAt)).limit(1))[0];
  };

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    const addUser = async (id: string, role: string, onProject: { isProjectManager?: boolean } | null) => {
      await db.insert(usersTable).values({ id, companyId: co.companyId, email: `${id}@example.test`, passwordHash: owner.passwordHash, name: `Name ${id}`, role, emailVerified: true });
      await db.insert(companyMembersTable).values({ id: randomUUID(), userId: id, companyId: co.companyId, role });
      if (onProject) await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: id, isProjectManager: !!onProject.isProjectManager } as any);
      // Subcontractors can't log in to the dashboard (#117): use a leftover-style signed token.
      return dashboardToken(id, co.companyId, role, `${id}@example.test`);
    };
    admin = await login(co.email);
    pm = await addUser(ids.pm, "project_manager", {});
    worker = await addUser(ids.worker, "site_worker", {});
    sub = await addUser(ids.sub, "subcontractor", {});
    cover = await addUser(ids.cover, "site_worker", { isProjectManager: true }); // per-project PM cover
    otherAdmin = await login(other.email);
    await db.update(companiesTable).set({ betaAccess: true }).where(eq(companiesTable.id, co.companyId)); // no plan cap in the create test
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 400));
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.update(projectsTable).set({ siteManagerId: null }).where(eq(projectsTable.id, co.projectId));
    if (created.length) await db.delete(projectMembersTable).where(inArray(projectMembersTable.projectId, created));
    if (created.length) await db.delete(projectsTable).where(inArray(projectsTable.id, created));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, Object.values(ids)));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(ids)));
    await cleanupFixtures([co, other]);
  });

  it("a site worker calling the API directly can't rename, re-address, pause or take the site manager role", async () => {
    const before = await project();
    for (const body of [
      { name: "Hijacked" },
      { address: "1 Wrong Road" },
      { status: "on_hold" },
      { siteManagerId: ids.worker },
      { siteCloseTime: "06:00" },
    ]) {
      const r = await patch(worker, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
    }
    const after = await project();
    expect(after.name).toBe(before.name);
    expect(after.address).toBe(before.address);
    expect(after.status).toBe(before.status);
    expect(after.siteManagerId).toBe(before.siteManagerId);
    expect(after.siteCloseTime).toBe(before.siteCloseTime);
    await new Promise(r => setTimeout(r, 400));
    expect(await logs()).toHaveLength(0);
  });

  it("a subcontractor's dashboard login is refused the same way", async () => {
    expect((await patch(sub, { address: "1 Wrong Road" })).status).toBe(403);
    expect((await patch(sub, { siteManagerId: ids.sub })).status).toBe(403);
  });

  it("another company's admin can't see the project at all", async () => {
    expect((await patch(otherAdmin, { name: "Hijacked" })).status).toBe(404);
  });

  it("company admin and company PM can edit; a site worker with per-project PM cover can't (Team Portal only, #123)", async () => {
    expect((await patch(admin, { name: "Renamed by admin" })).status).toBe(200);
    expect((await patch(pm, { name: "Renamed by PM" })).status).toBe(200);
    expect((await patch(cover, { address: "1 Wrong Road" })).status).toBe(403);
    expect((await patch(pm, { address: "2 Right Road" })).status).toBe(200);
    expect((await project()).address).toBe("2 Right Road");
  });

  it("status: unknown values are rejected, and 'complete' only comes from the PIN close-out", async () => {
    const bad = await patch(admin, { status: "deleted" });
    expect(bad.status).toBe(400);
    const complete = await patch(admin, { status: "complete" });
    expect(complete.status).toBe(400);
    expect(complete.json.error).toBe("use_closeout");
    expect((await project()).status).toBe("active");
    const pause = await patch(admin, { status: "on_hold" });
    expect(pause.status).toBe(200);
    expect(JSON.parse((await lastLog()).metadata!)).toEqual({ status: { from: "active", to: "on_hold" } });
    await patch(admin, { status: "active" });
  });

  it("reopening a closed-out project is approver-only and recorded", async () => {
    await db.update(projectsTable).set({ status: "complete" }).where(eq(projectsTable.id, co.projectId)); // as the close-out does
    expect((await patch(worker, { status: "active" })).status).toBe(403);
    expect((await project()).status).toBe("complete");
    expect((await patch(cover, { status: "active" })).status).toBe(403);
    const reopen = await patch(pm, { status: "active" });
    expect(reopen.status).toBe(200);
    const last = await lastLog();
    expect(last.userId).toBe(ids.pm);
    expect(JSON.parse(last.metadata!)).toEqual({ status: { from: "complete", to: "active" } });
  });

  it("site manager: must be on the project, and every change is recorded (who, from, to)", async () => {
    const outsider = `tusr-out-${sfx}`;
    expect((await patch(admin, { siteManagerId: outsider })).status).toBe(400);
    const ok = await patch(admin, { siteManagerId: ids.pm });
    expect(ok.status).toBe(200);
    expect((await project()).siteManagerId).toBe(ids.pm);
    const last = await lastLog();
    expect(last.userId).toBe(co.userId);
    expect(JSON.parse(last.metadata!)).toEqual({ siteManager: { from: null, to: ids.pm } });
    expect(last.createdAt).toBeTruthy();
  });

  it("creating a project: site workers and subcontractors are refused directly; admins and PMs can", async () => {
    const body = { name: "New site", address: "3 New Road", startDate: "2026-10-07" };
    expect((await api("/projects", { method: "POST", token: worker, body })).status).toBe(403);
    expect((await api("/projects", { method: "POST", token: sub, body })).status).toBe(403);
    expect((await api("/projects", { method: "POST", token: cover, body })).status).toBe(403); // per-project cover isn't company-wide
    const ok = await api("/projects", { method: "POST", token: pm, body });
    expect(ok.status).toBe(201);
    created.push(ok.json.id);
  });
});
