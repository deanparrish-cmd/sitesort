import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { subcontractorsTable, peopleTable, projectMembersTable, projectInvitesTable, usersTable, activityLogTable, portalSessionsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, inviteTokenFromInbox, PORTAL_TEST_PASSWORD, type Fixture } from "./helpers";

/**
 * #183 (found 2026-10-27 seeding the demo company): the Team tab and the
 * portal team list named every person at a firm after the firm's primary
 * contact, because canonicalPersonName always preferred the firm's contact
 * fields. Those fields describe the primary contact only.
 */
describe("a firm's second person keeps their own name", () => {
  let co: Fixture;
  let admin: string;
  let subId = "";
  let primaryId = "";
  let secondId = "";
  let portalUserId = "";

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    const sub = await api("/subcontractors", { method: "POST", token: admin, body: {
      companyName: "Second Person Test Ltd", contactFirstName: "Pat", contactLastName: "Primary",
      contactEmail: `pat-${co.companyId}@second-person.sitesort.test`, trades: ["Builders"],
    } });
    expect(sub.status).toBe(201);
    subId = sub.json.id; primaryId = sub.json.personId;
    const second = await api(`/subcontractors/${subId}/people`, { method: "POST", token: admin, body: {
      firstName: "Sam", lastName: "Second", email: `sam-${co.companyId}@second-person.sitesort.test`,
    } });
    expect(second.status).toBe(201);
    secondId = second.json.id;
    for (const personId of [primaryId, secondId]) {
      expect((await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId } })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    if (portalUserId) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, portalUserId));
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.delete(projectInvitesTable).where(eq(projectInvitesTable.projectId, co.projectId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(inArray(peopleTable.id, [primaryId, secondId]));
    if (portalUserId) await db.delete(usersTable).where(eq(usersTable.id, portalUserId));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, subId));
    await cleanupFixtures([co]);
  });

  const teamNames = async () => ((await api(`/projects/${co.projectId}/members`, { token: admin })).json as { name: string }[]).map(m => m.name).sort();

  it("Team tab shows each person under their own name", async () => {
    expect(await teamNames()).toEqual(expect.arrayContaining(["Pat Primary", "Sam Second"]));
    expect((await teamNames()).filter(n => n === "Pat Primary")).toHaveLength(1);
  });

  it("renaming the firm's contact still renames the primary contact, and only them", async () => {
    expect((await api(`/subcontractors/${subId}`, { method: "PATCH", token: admin, body: { contactFirstName: "Pat", contactLastName: "Renamed" } })).status).toBe(200);
    const names = await teamNames();
    expect(names).toEqual(expect.arrayContaining(["Pat Renamed", "Sam Second"]));
    expect(names).not.toContain("Pat Primary");
  });

  it("the portal team list shows the second person under their own name too", async () => {
    expect((await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: secondId } })).status).toBe(201);
    const raw = await inviteTokenFromInbox(co.projectId, secondId);
    const accepted = await api(`/portal/invite/${raw}/accept`, { method: "POST", body: { password: PORTAL_TEST_PASSWORD } });
    expect(accepted.status).toBe(200);
    portalUserId = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, `sam-${co.companyId}@second-person.sitesort.test`)))[0].id;
    const team = await api("/portal/team", { token: accepted.json.token });
    expect(team.status).toBe(200);
    const names = JSON.stringify(team.json);
    expect(names).toContain("Sam Second");
    expect(names).toContain("Pat Renamed");
  });
});
