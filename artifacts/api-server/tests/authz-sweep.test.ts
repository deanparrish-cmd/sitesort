import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  usersTable, companyMembersTable, projectMembersTable, milestonesTable, documentsTable, messagesTable, messageReactionsTable,
  notificationsTable, documentDistributionsTable, activityLogTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, dashboardToken, type Fixture } from "./helpers";

/**
 * #120, the declaration sweep: the routes that had NO server-side role check
 * (only a hidden button) now refuse a site worker calling the API directly,
 * while project approvers (incl. per-project PM cover) keep working.
 */
describe("declaration sweep: holes closed below the buttons", () => {
  let co: Fixture;
  let other: Fixture;
  const tok: Record<string, string> = {};
  const sfx = randomUUID().slice(0, 8);
  const id = { worker: `tsw-wk-${sfx}`, cover: `tsw-cv-${sfx}`, worker2: `tsw-w2-${sfx}`, pm: `tsw-pm-${sfx}`, pm2: `tsw-p2-${sfx}` };
  let memberId = "";
  let otherMemberId = "";

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    tok.admin = await login(co.email);
    tok.otherAdmin = await login(other.email);
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    const add = async (uid: string, project: { isProjectManager?: boolean } | null) => {
      await db.insert(usersTable).values({ id: uid, companyId: co.companyId, email: `${uid}@example.test`, passwordHash: owner.passwordHash, name: `Name ${uid}`, role: "site_worker", emailVerified: true });
      await db.insert(companyMembersTable).values({ id: randomUUID(), userId: uid, companyId: co.companyId, role: "site_worker" });
      if (project) await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: uid, isProjectManager: !!project.isProjectManager } as any);
      return dashboardToken(uid, co.companyId, "site_worker", `${uid}@example.test`);
    };
    tok.worker = await add(id.worker, {});
    tok.cover = await add(id.cover, { isProjectManager: true });
    tok.worker2 = await add(id.worker2, null);
    // Two PMs for the DM test (site workers no longer reach the dashboard, #123).
    for (const uid of [id.pm, id.pm2]) {
      await db.insert(usersTable).values({ id: uid, companyId: co.companyId, email: `${uid}@example.test`, passwordHash: owner.passwordHash, name: `Name ${uid}`, role: "project_manager", emailVerified: true });
      await db.insert(companyMembersTable).values({ id: randomUUID(), userId: uid, companyId: co.companyId, role: "project_manager" });
    }
    tok.pm = await login(`${id.pm}@example.test`);
    tok.pm2 = await login(`${id.pm2}@example.test`);
    memberId = (await db.select().from(projectMembersTable).where(eq(projectMembersTable.userId, id.worker)))[0].id;
    otherMemberId = randomUUID();
    await db.insert(projectMembersTable).values({ id: otherMemberId, projectId: other.projectId, userId: other.userId } as any);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    await db.delete(messageReactionsTable).where(inArray(messageReactionsTable.userId, Object.values(id)));
    await db.delete(messagesTable).where(eq(messagesTable.companyId, co.companyId));
    await db.delete(milestonesTable).where(eq(milestonesTable.projectId, co.projectId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [...Object.values(id), co.userId]));
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    const docs = await db.select({ id: documentsTable.id }).from(documentsTable).where(eq(documentsTable.projectId, co.projectId));
    if (docs.length) await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docs.map(d => d.id)));
    await db.delete(documentsTable).where(eq(documentsTable.projectId, co.projectId));
    await db.delete(projectMembersTable).where(inArray(projectMembersTable.projectId, [co.projectId, other.projectId]));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, Object.values(id)));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(id)));
    await cleanupFixtures([co, other]);
  });

  it("milestones: a site worker (even with per-project PM cover) can't read, create, edit or delete them; an approver can", async () => {
    const base = `/projects/${co.projectId}/milestones`;
    expect((await api(base, { method: "POST", token: tok.worker, body: { title: "Roof on", dueDate: "2026-12-01" } })).status).toBe(403);
    expect((await api(base, { method: "POST", token: tok.cover, body: { title: "Roof on", dueDate: "2026-12-01" } })).status).toBe(403);
    const made = await api(base, { method: "POST", token: tok.pm, body: { title: "Roof on", dueDate: "2026-12-01" } });
    expect(made.status).toBe(201);
    expect((await api(base, { token: tok.worker })).status).toBe(403);
    expect((await api(`${base}/${made.json.id}`, { method: "PATCH", token: tok.worker, body: { completed: true } })).status).toBe(403);
    expect((await api(`${base}/${made.json.id}`, { method: "DELETE", token: tok.worker })).status).toBe(403);
    expect(await db.select().from(milestonesTable).where(eq(milestonesTable.id, made.json.id))).toHaveLength(1);
    expect((await api(`${base}/${made.json.id}`, { method: "DELETE", token: tok.admin })).status).toBe(200);
  });

  it("document upload: a site worker is refused (the button was manager-only); an approver can", async () => {
    const body = { name: `Plan ${sfx}`, type: "drawing", fileUrl: "/api/uploads/x.pdf" };
    expect((await api(`/projects/${co.projectId}/documents`, { method: "POST", token: tok.worker, body })).status).toBe(403);
    expect((await api(`/projects/${co.projectId}/documents`, { method: "POST", token: tok.cover, body })).status).toBe(403);
    expect((await api(`/projects/${co.projectId}/documents`, { method: "POST", token: tok.pm, body })).status).toBe(201);
  });

  it("member schedule / avatar / permissions: site worker refused; another company's manager can't touch our rows", async () => {
    const path = (p: string, m: string) => `/projects/${p}/members/${m}`;
    expect((await api(`${path(co.projectId, memberId)}/schedule`, { method: "PATCH", token: tok.worker, body: { scheduledDays: ["mon"] } })).status).toBe(403);
    expect((await api(`${path(co.projectId, memberId)}/avatar`, { method: "PATCH", token: tok.worker, body: { avatarUrl: "/api/uploads/a.png" } })).status).toBe(403);
    // Cross-tenant: the other company's admin aims at OUR project + member.
    expect((await api(`${path(co.projectId, memberId)}/schedule`, { method: "PATCH", token: tok.otherAdmin, body: { scheduledDays: ["mon"] } })).status).toBe(404);
    expect((await api(`${path(co.projectId, memberId)}/permissions`, { method: "PATCH", token: tok.otherAdmin, body: { canLogIssues: true } })).status).toBe(404);
    // And our admin can't reach theirs.
    expect((await api(`${path(other.projectId, otherMemberId)}/avatar`, { method: "PATCH", token: tok.admin, body: { avatarUrl: "/api/uploads/a.png" } })).status).toBe(404);
    expect((await api(`${path(co.projectId, memberId)}/schedule`, { method: "PATCH", token: tok.admin, body: { scheduledDays: ["mon"] } })).status).toBe(200);
  });

  it("DM reactions: only on a message in your own conversation", async () => {
    const sent = await api("/messages", { method: "POST", token: tok.admin, body: { recipientId: id.pm, content: "private" } });
    expect(sent.status).toBe(201);
    expect((await api(`/messages/${sent.json.id}/react`, { method: "POST", token: tok.pm2, body: { emoji: "👍" } })).status).toBe(404);
    expect((await api(`/messages/${sent.json.id}/react`, { method: "POST", token: tok.pm, body: { emoji: "👍" } })).status).toBe(200);
  });

  it("a site worker's dashboard token reaches nothing: they use the Team Portal (#123)", async () => {
    for (const p of [`/projects/${co.projectId}`, `/projects/${co.projectId}/documents`, "/compliance", "/onboarding/status", "/notifications", "/auth/me"]) {
      const r = await api(p, { token: tok.worker2 });
      expect(r.status, p).toBe(403);
      expect(r.json.error, p).toBe("use_portal");
      expect((await api(p, { token: tok.pm })).status, p).toBe(200);
    }
  });
});
