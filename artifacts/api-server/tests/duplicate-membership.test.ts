import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import {
  portalSessionsTable, projectMembersTable, projectInvitesTable, peopleTable, subcontractorsTable, usersTable,
} from "@workspace/db/schema";
import { ensureSchema } from "../src/lib/ensure-schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * One card, two membership rows on one project (Amy, prod, 2026-10-20): a
 * stale no-login row from 25 Jul and her real row from 30 Jul with the login
 * and all three permissions. Anything that picks "the" row of a card with
 * .limit(1) can pick the stale one. The dangerous case was revoke: it reset
 * the stale row, left the real row and the live session alone, and still said
 * "Access revoked." Each test builds Amy's layout: the stale row is written
 * BEFORE the real row's permissions are set, so the real row sits after it.
 */
describe("one card with a stale duplicate membership row", () => {
  let co: Fixture;
  let admin = "";
  const members: PortalMemberFixture[] = [];
  const extraPeople: string[] = [];
  const subIds: string[] = [];

  async function rowsOf(personId: string) {
    return db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.personId, personId)));
  }
  async function liveSessions(userId: string) {
    return db.select().from(portalSessionsTable)
      .where(and(eq(portalSessionsTable.userId, userId), eq(portalSessionsTable.projectId, co.projectId), isNull(portalSessionsTable.revokedAt)));
  }
  // Amy's layout on this card: stale no-login row first, then the real row's
  // permissions switched on (a later write, as on prod).
  async function addStaleRow(personId: string) {
    await db.insert(projectMembersTable).values({
      id: randomUUID(), projectId: co.projectId, userId: null, personId, role: "subcontractor",
      addedAt: new Date("2026-07-25T09:00:00Z"),
    });
    await db.update(projectMembersTable)
      .set({ canLogIssues: true, canUpdatePlantMaterials: true, canEditDailyReport: true })
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.personId, personId), isNotNull(projectMembersTable.userId)));
  }
  async function newMember() {
    const m = await seedCrossTenantPortalMember([co], [admin]);
    members.push(m);
    const portal = (await portalLogin(m.email, m.password)).token;
    return { m, card: m.personIds[0], portal };
  }

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
  });

  afterAll(async () => {
    for (const m of members) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, m.userId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(projectInvitesTable).where(eq(projectInvitesTable.projectId, co.projectId));
    for (const m of members) await cleanupPortalMember(m, [co.projectId]);
    if (extraPeople.length) await db.delete(peopleTable).where(inArray(peopleTable.id, extraPeople));
    if (subIds.length) {
      await db.delete(peopleTable).where(inArray(peopleTable.subcontractorId, subIds));
      await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds));
    }
    await cleanupFixtures([co]);
  });

  it("revoke ends the session and the real row, and only then says Access revoked", async () => {
    const { m, card, portal } = await newMember();
    await addStaleRow(card);
    expect((await api("/portal/shared", { token: portal })).status).toBe(200);
    expect((await liveSessions(m.userId)).length).toBeGreaterThan(0);
    const inv = (await db.select().from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.projectId, co.projectId), eq(projectInvitesTable.personId, card), eq(projectInvitesTable.status, "accepted"))))[0];
    expect(inv).toBeTruthy();

    const r = await api(`/projects/${co.projectId}/invites/${inv.id}/revoke`, { method: "POST", token: admin });
    expect(r.status).toBe(200);
    expect(r.json.message).toBe("Access revoked.");

    // The session is over: the same token is refused, and no session is live.
    expect([401, 403]).toContain((await api("/portal/shared", { token: portal })).status);
    expect(await liveSessions(m.userId)).toHaveLength(0);
    // No portal row left for the login, and the stale row carries no permissions.
    const loginRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, m.userId), isNotNull(projectMembersTable.personId)));
    expect(loginRows).toHaveLength(0);
    for (const row of await rowsOf(card)) {
      expect(row.userId).toBeNull();
      expect([row.canLogIssues, row.canUpdatePlantMaterials, row.canEditDailyReport]).toEqual([false, false, false]);
    }
    // No live invite left for the boot repair to bring them back from.
    const live = await db.select().from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.projectId, co.projectId), eq(projectInvitesTable.personId, card), inArray(projectInvitesTable.status, ["pending", "accepted"])));
    expect(live).toHaveLength(0);
    // ...and a restart doesn't bring them back.
    await ensureSchema();
    expect((await rowsOf(card)).some(r => r.userId === m.userId)).toBe(false);
  });

  it("removing the card removes every row of it and ends access (no pass to its own stale row)", async () => {
    const { m, card, portal } = await newMember();
    await addStaleRow(card);
    const real = (await rowsOf(card)).find(r => r.userId === m.userId)!;
    const del = await api(`/projects/${co.projectId}/members/${real.id}`, { method: "DELETE", token: admin });
    expect(del.status).toBe(200);
    expect(del.json.accessPassedToPersonId).toBeNull();
    expect(await rowsOf(card)).toHaveLength(0);
    expect([401, 403]).toContain((await api("/portal/shared", { token: portal })).status);
    expect(await liveSessions(m.userId)).toHaveLength(0);
  });

  it("a removed person does not come back at the next restart", async () => {
    const { m, card } = await newMember();
    const real = (await rowsOf(card)).find(r => r.userId === m.userId)!;
    expect((await api(`/projects/${co.projectId}/members/${real.id}`, { method: "DELETE", token: admin })).status).toBe(200);
    await ensureSchema();
    const back = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, m.userId)));
    expect(back).toHaveLength(0);
  });

  it("removing a firm removes every row of its people's cards", async () => {
    const sub = await api("/subcontractors", { method: "POST", token: admin, body: {
      companyName: `Dup Firm ${Date.now()}`, contactFirstName: "Firm", contactLastName: "Contact", contactEmail: `dupfirm-${Date.now()}@sitesort-tests.local`, trades: ["Roofing"],
    } });
    expect([200, 201]).toContain(sub.status);
    subIds.push(sub.json.id);
    const email = `dup-firm-person-${randomUUID().slice(0, 8)}@sitesort-tests.local`;
    const person = await api(`/subcontractors/${sub.json.id}/people`, { method: "POST", token: admin, body: { firstName: "Dup", lastName: "Person", email } });
    const card = person.json.id as string;
    expect((await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId: card, role: "subcontractor" } })).status).toBeLessThan(300);
    const inv = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: card, role: "subcontractor" } });
    const acc = await api(`/portal/invite/${String(inv.json.inviteUrl).split("/accept/")[1]}/accept`, { method: "POST", body: { password: "PortalTest123!" } });
    expect(acc.status).toBe(200);
    const userId = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)))[0].id;
    members.push({ email, password: "PortalTest123!", pin: "", userId, personIds: [] });
    await addStaleRow(card);
    expect(await rowsOf(card)).toHaveLength(2);

    const del = await api(`/projects/${co.projectId}/members/company/${sub.json.id}`, { method: "DELETE", token: admin });
    expect(del.status).toBe(200);
    expect(await rowsOf(card)).toHaveLength(0);
    expect([401, 403]).toContain((await api("/portal/shared", { token: acc.json.token })).status);
  });

  it("the boot repair puts a missing login back on the card's row instead of adding a second row", async () => {
    const { m, card } = await newMember();
    // The card is on the project but its row lost the login (accepted invite still live).
    await db.update(projectMembersTable).set({ userId: null })
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.personId, card)));
    await ensureSchema();
    const rows = await rowsOf(card);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(m.userId);
  });

  it("the boot repair never links a login row to a card that already has a row", async () => {
    const { m, card } = await newMember();
    // Card row without the login, plus a login row with no card: the old Step 2
    // linked the login row to the same card, making a second row.
    await db.update(projectMembersTable).set({ userId: null })
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.personId, card)));
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: m.userId, personId: null, role: "subcontractor" });
    await ensureSchema();
    expect(await rowsOf(card)).toHaveLength(1);
  });
});
