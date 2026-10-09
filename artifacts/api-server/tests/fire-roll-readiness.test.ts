import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, projectMembersTable, notificationsTable, projectsTable, portalSessionsTable, pushSubscriptionsTable,
} from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, dashboardToken, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  type Fixture, type PortalMemberFixture,
} from "./helpers";
import { runFireRollAlerts } from "../src/routes/qr";
import { siteDateStr, wallClockUtc } from "../src/lib/site-clock";

/**
 * #125: fire-roll readiness. The system checks what the Site Register needs on
 * the day and says so (red / amber / green), and while a project is red the
 * site manager and the company's PMs get ONE alert a day.
 */
describe("fire-roll readiness and the daily alert", () => {
  let co: Fixture;
  let admin = "";
  let manager: PortalMemberFixture;
  let managerToken = "";
  const sfx = randomUUID().slice(0, 8);
  const workerId = `tfr-wk-${sfx}`;
  const readiness = async () => (await api(`/projects/${co.projectId}/fire-roll`, { token: admin })).json;
  const check = (r: any, key: string) => r.checks.find((c: any) => c.key === key);
  // A moment inside today's site day (UK), so alerts are allowed to go out.
  const midMorning = () => wallClockUtc(siteDateStr(new Date(), "Europe/London"), "10:00", "Europe/London");

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    await db.update(projectsTable).set({ siteManagerId: null }).where(eq(projectsTable.id, co.projectId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, ...(manager ? [manager.userId] : [])]));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    if (manager) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, manager.userId));
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, manager.userId));
      await cleanupPortalMember(manager, [co.projectId]);
    }
    await cleanupFixtures([co]);
  });

  it("a project without a site QR code doesn't use the gate: not in use, and never alerted", async () => {
    expect((await readiness()).status).toBe("not_in_use");
    expect((await api("/fire-roll", { token: admin })).json).toEqual([]);
    expect(await runFireRollAlerts(midMorning(), co.projectId)).toBe(0);
  });

  it("with a QR code and nobody named to run it: red", async () => {
    await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } });
    const r = await readiness();
    expect(r.status).toBe("red");
    expect(check(r, "who").status).toBe("red");
    expect((await api("/fire-roll", { token: admin })).json.map((x: any) => x.projectId)).toEqual([co.projectId]);
  });

  it("only the project's approvers see it", async () => {
    const worker = await dashboardToken(workerId, co.companyId, "site_worker", `${workerId}@example.test`);
    expect((await api(`/projects/${co.projectId}/fire-roll`, { token: worker })).status).toBe(403);
    expect((await api("/fire-roll", { token: worker })).status).toBe(403);
  });

  it("a named site manager who has no Team Portal access is still red", async () => {
    // The company owner is on the project team but has no portal grant.
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: co.userId } as any);
    expect((await api(`/projects/${co.projectId}`, { method: "PATCH", token: admin, body: { siteManagerId: co.userId } })).status).toBe(200);
    const r = await readiness();
    expect(r.status).toBe("red");
    expect(check(r, "access").status).toBe("red");
    await db.delete(projectMembersTable).where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, co.userId)));
  });

  it("a site manager on the Team Portal: amber until notifications are on, the board is used and today's register is opened", async () => {
    manager = await seedCrossTenantPortalMember([co], [admin]);
    managerToken = (await portalLogin(manager.email, manager.password)).token;
    expect((await api(`/projects/${co.projectId}`, { method: "PATCH", token: admin, body: { siteManagerId: manager.userId } })).status).toBe(200);
    const r = await readiness();
    expect(r.status).toBe("amber");
    expect(check(r, "access").status).toBe("green");
    expect(check(r, "notify").status).toBe("amber");
    expect(check(r, "board").status).toBe("amber");
    expect(check(r, "today").status).toBe("amber");
    expect(await runFireRollAlerts(midMorning(), co.projectId)).toBe(0); // amber never alerts
  });

  it("once people have signed in today and the register hasn't been opened: red, and ONE alert today to the site manager's phone and the PMs", async () => {
    await db.insert(siteCheckinsTable).values({ id: randomUUID(), projectId: co.projectId, workerName: "Early Bird", companyName: "Dawn Ltd", photoUrl: "/api/uploads/e.jpg" });
    const r = await readiness();
    expect(r.status).toBe("red");
    expect(check(r, "today").status).toBe("red");
    expect(await runFireRollAlerts(midMorning(), co.projectId)).toBe(1);
    const notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, co.userId), eq(notificationsTable.type, "fire_roll_not_ready")));
    expect(notes).toHaveLength(1);
    expect(notes[0].relatedEntityType).toBe("project");
    expect(notes[0].relatedEntityId).toBe(co.projectId);
    expect(notes[0].message).toMatch(/hasn't been opened/);
    // Still red later the same day: no second alert.
    expect(await runFireRollAlerts(midMorning(), co.projectId)).toBe(0);
    // Not before the site day starts.
    await db.update(projectsTable).set({ fireRollAlertedOn: null }).where(eq(projectsTable.id, co.projectId));
    expect(await runFireRollAlerts(wallClockUtc(siteDateStr(new Date(), "Europe/London"), "06:30", "Europe/London"), co.projectId)).toBe(0);
    await db.update(projectsTable).set({ fireRollAlertedOn: siteDateStr(new Date(), "Europe/London") }).where(eq(projectsTable.id, co.projectId));
  });

  it("opening the register with signal turns 'today' green; with notifications on it's all green", async () => {
    const reg = await api("/portal/site-register", { token: managerToken });
    expect(reg.status).toBe(200);
    expect(reg.json.readiness.status).toBe("amber"); // notifications still off
    expect(check(reg.json.readiness, "today").status).toBe("green");
    expect(check(reg.json.readiness, "board").status).toBe("green");
    await db.insert(pushSubscriptionsTable).values({ id: randomUUID(), userId: manager.userId, projectId: co.projectId, endpoint: `https://push.example.test/${sfx}`, p256dh: "x", auth: "y" });
    const r = await readiness();
    expect(r.status).toBe("green");
    expect(r.checks.every((c: any) => c.status === "green")).toBe(true);
  });
});
