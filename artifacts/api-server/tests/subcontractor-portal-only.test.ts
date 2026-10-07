import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray, like, or } from "drizzle-orm";
import {
  usersTable, companyMembersTable, projectMembersTable, subcontractorsTable, peopleTable,
  projectInvitesTable, portalSessionsTable, activityLogTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";
import { generateToken } from "../src/middlewares/auth";

/**
 * #117: anyone outside the company (subcontractors, contractors) gets Team
 * Portal access only. Every way a subcontractor could end up with a DASHBOARD
 * login is closed, proven by direct API calls; and the real onboarding flow
 * (contact card, person, add to project, Invite to Portal, accept) creates a
 * portal-only account and no dashboard access.
 */
describe("subcontractors are portal-only", () => {
  let co: Fixture;
  let admin = "";
  const sfx = randomUUID().slice(0, 8);
  const card = `tpo-card-${sfx}`;
  const legacySub = `tpo-legacy-${sfx}`;
  const contractorEmail = `tpo-contractor-${sfx}@example.test`;
  const users = (email: string) => db.select().from(usersTable).where(eq(usersTable.email, email));

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    // An old contact-card invite token, as issued before #117.
    await db.insert(subcontractorsTable).values({ id: card, companyId: co.companyId, companyName: "Contractor Ltd", contactName: "Con Tractor", contactEmail: contractorEmail, inviteToken: `tok-${sfx}` });
    // A subcontractor DASHBOARD account created before #117.
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    await db.insert(usersTable).values({ id: legacySub, companyId: co.companyId, email: `${legacySub}@example.test`, passwordHash: owner.passwordHash, name: "Legacy Sub", role: "subcontractor", emailVerified: true });
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: legacySub, companyId: co.companyId, role: "subcontractor" });
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    const made = (await db.select({ id: usersTable.id }).from(usersTable).where(or(like(usersTable.email, `tpo-%-${sfx}@example.test`), eq(usersTable.email, contractorEmail)))).map(u => u.id);
    const ids = [legacySub, ...made];
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.userId, ids));
    await db.delete(projectInvitesTable).where(eq(projectInvitesTable.projectId, co.projectId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(eq(peopleTable.subcontractorId, card));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, card));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await cleanupFixtures([co]);
  });

  it("path 1, the old contact-card invite link: can't be issued, opened or accepted; nothing is created", async () => {
    expect((await api(`/subcontractors/${card}/invite`, { method: "POST", token: admin })).status).toBe(410);
    expect((await api(`/auth/invite/tok-${sfx}`)).status).toBe(410);
    const accept = await api(`/auth/invite/tok-${sfx}/accept`, { method: "POST", body: { name: "Con Tractor", password: "Password123!" } });
    expect(accept.status).toBe(410);
    expect(await users(contractorEmail)).toHaveLength(0);
  });

  it("path 2, adding a user directly with the subcontractor role: refused, even for an admin", async () => {
    const r = await api("/users", { method: "POST", token: admin, body: { email: `tpo-new-${sfx}@example.test`, name: "Sub Contractor", role: "subcontractor" } });
    expect(r.status).toBe(400);
    expect(await users(`tpo-new-${sfx}@example.test`)).toHaveLength(0);
  });

  it("path 3, changing a staff member's role to subcontractor: refused", async () => {
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    const staff = `tpo-staff-${sfx}`;
    await db.insert(usersTable).values({ id: staff, companyId: co.companyId, email: `tpo-staff-${sfx}@example.test`, passwordHash: owner.passwordHash, name: "Staff Member", role: "site_worker", emailVerified: true });
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: staff, companyId: co.companyId, role: "site_worker" });
    expect((await api(`/users/${staff}`, { method: "PATCH", token: admin, body: { role: "subcontractor" } })).status).toBe(400);
  });

  it("path 4, an existing subcontractor dashboard account: can't log in, and an old token is refused", async () => {
    const r = await api("/auth/login", { method: "POST", body: { email: `${legacySub}@example.test`, password: "Password123!" } });
    // Wrong-password and portal answers differ; use the fixture password via the helper instead.
    const viaHelper = await login(`${legacySub}@example.test`).then(() => "logged in").catch((e: Error) => e.message);
    expect(viaHelper).toMatch(/403/);
    expect(viaHelper).toMatch(/use_portal/);
    expect([401, 403]).toContain(r.status);
    const oldToken = generateToken({ id: legacySub, companyId: co.companyId, role: "subcontractor", email: `${legacySub}@example.test` });
    for (const path of ["/projects", "/checkins", "/users", "/subcontractors"]) {
      const res = await api(path, { token: oldToken });
      expect(res.status, path).toBe(403);
      expect(res.json.error, path).toBe("use_portal");
    }
  });

  it("the real onboarding flow creates a PORTAL-ONLY account and no dashboard access", async () => {
    // Contact card -> person on the card -> add to project -> Invite to Portal -> accept.
    const person = await api(`/subcontractors/${card}/people`, { method: "POST", token: admin, body: { firstName: "Con", lastName: "Tractor", email: contractorEmail } });
    expect(person.status).toBe(201);
    const personId = person.json.id ?? person.json.person?.id;
    expect((await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId, role: "subcontractor" } })).status).toBe(201);
    const invite = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId } });
    expect(invite.status).toBe(201);
    const token = String(invite.json.inviteUrl).split("/portal/accept/")[1];
    const accepted = await api(`/portal/invite/${encodeURIComponent(token)}/accept`, { method: "POST", body: { password: "Contractor-Pass-2026!" } });
    expect(accepted.status).toBe(200);

    const [u] = await users(contractorEmail);
    expect(u.portalOnly).toBe(true);
    // No company membership, so no dashboard in this company.
    expect(await db.select().from(companyMembersTable).where(eq(companyMembersTable.userId, u.id))).toHaveLength(0);
    // Dashboard login refused; the portal token can't reach dashboard routes.
    const dash = await api("/auth/login", { method: "POST", body: { email: contractorEmail, password: "Contractor-Pass-2026!" } });
    expect(dash.status).toBe(403);
    expect(dash.json.error).toBe("use_portal");
    expect((await api("/projects", { token: accepted.json.token })).status).toBe(403);
    expect((await api("/portal/me", { token: accepted.json.token })).status).toBe(200);
  });
});
