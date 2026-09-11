import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, usersTable, companyMembersTable } from "@workspace/db/schema";
import { api, cleanupFixtures, login, seedCompany, TEST_PASSWORD, type Fixture } from "./helpers";

// Multi-user safety for DELETE /api/admin/users/:id. These fixtures never set
// a stripeCustomerId, so the Stripe-cancellation step short-circuits and this
// suite never touches Stripe (live or test) — see stripe-cancellation.test.ts
// for the mocked Stripe behaviour itself.
describe("admin user deletion — multi-user safety", () => {
  let platformAdmin: Fixture;
  let platformAdminToken: string;
  let nonAdmin: Fixture;
  let nonAdminToken: string;

  const suffix = randomUUID().slice(0, 8);
  const multiUserCompanyId = `test-mu-co-${suffix}`;
  const user1Id = `test-mu-u1-${suffix}`;
  const user2Id = `test-mu-u2-${suffix}`;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    platformAdmin = await seedCompany({ role: "admin" });
    nonAdmin = await seedCompany({ role: "admin" });
    fixtures.push(platformAdmin, nonAdmin);
    await db.update(usersTable).set({ platformAdmin: true }).where(eq(usersTable.id, platformAdmin.userId));
    platformAdminToken = await login(platformAdmin.email);
    nonAdminToken = await login(nonAdmin.email);

    // A company with TWO users, seeded directly (seedCompany always creates a
    // fresh company per call).
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    await db.insert(companiesTable).values({ id: multiUserCompanyId, name: `Multi User Co ${suffix}` });
    await db.insert(usersTable).values([
      { id: user1Id, companyId: multiUserCompanyId, email: `mu1-${suffix}@sitesort-tests.local`, passwordHash, name: "User One", role: "admin", emailVerified: true },
      { id: user2Id, companyId: multiUserCompanyId, email: `mu2-${suffix}@sitesort-tests.local`, passwordHash, name: "User Two", role: "site_worker", emailVerified: true },
    ]);
    await db.insert(companyMembersTable).values([
      { id: `test-mu-mem1-${suffix}`, userId: user1Id, companyId: multiUserCompanyId, role: "admin" },
      { id: `test-mu-mem2-${suffix}`, userId: user2Id, companyId: multiUserCompanyId, role: "site_worker" },
    ]);
  });

  afterAll(async () => {
    // Idempotent — fine if the cascade below already removed these.
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, [user1Id, user2Id]));
    await db.delete(usersTable).where(inArray(usersTable.id, [user1Id, user2Id]));
    await db.delete(companiesTable).where(eq(companiesTable.id, multiUserCompanyId));
    await cleanupFixtures(fixtures);
  });

  it("rejects a non-platform-admin caller", async () => {
    const { status } = await api(`/admin/users/${user1Id}`, { method: "DELETE", token: nonAdminToken });
    expect(status).toBe(403);
  });

  it("404s for a user that doesn't exist", async () => {
    const { status } = await api(`/admin/users/does-not-exist`, { method: "DELETE", token: platformAdminToken });
    expect(status).toBe(404);
  });

  it("deleting one of two users leaves the company, the other user, and its membership intact", async () => {
    const { status, json } = await api(`/admin/users/${user1Id}`, { method: "DELETE", token: platformAdminToken });
    expect(status).toBe(200);
    expect(json.companyDeleted).toBe(false);

    const company = await db.select().from(companiesTable).where(eq(companiesTable.id, multiUserCompanyId)).limit(1);
    expect(company).toHaveLength(1);

    const remainingUser = await db.select().from(usersTable).where(eq(usersTable.id, user2Id)).limit(1);
    expect(remainingUser).toHaveLength(1);

    const membership = await db.select().from(companyMembersTable).where(eq(companyMembersTable.userId, user2Id)).limit(1);
    expect(membership).toHaveLength(1);

    const deletedUser = await db.select().from(usersTable).where(eq(usersTable.id, user1Id)).limit(1);
    expect(deletedUser).toHaveLength(0);
  });

  it("deleting the LAST user in a company deletes the company too", async () => {
    const { status, json } = await api(`/admin/users/${user2Id}`, { method: "DELETE", token: platformAdminToken });
    expect(status).toBe(200);
    expect(json.companyDeleted).toBe(true);

    const company = await db.select().from(companiesTable).where(eq(companiesTable.id, multiUserCompanyId)).limit(1);
    expect(company).toHaveLength(0);

    const remainingUser = await db.select().from(usersTable).where(eq(usersTable.id, user2Id)).limit(1);
    expect(remainingUser).toHaveLength(0);
  });
});
