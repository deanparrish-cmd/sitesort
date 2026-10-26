import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { usersTable, companyMembersTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, type Fixture } from "./helpers";
import { reminderRecipients } from "../src/lib/permit-reminders";

/**
 * Dean, 2026-10-26: insurance and certificate expiry reminders went only to
 * users HOMED at the company with role admin, so the project manager (the one
 * person responsible for a site) was never told, nor an admin whose home
 * company is another one. Now: every admin and PM of the company by
 * company_members, email setting respected, portal-only accounts never.
 */
describe("who gets insurance and certificate expiry reminders", () => {
  let co: Fixture;       // its own user: admin homed here
  let elsewhere: Fixture; // an admin homed at another company, also admin here
  const extra: string[] = [];

  const addUser = async (opts: { role: string; emailNotifications?: boolean; portalOnly?: boolean }) => {
    const id = `test-user-${randomUUID().slice(0, 8)}`;
    await db.insert(usersTable).values({
      id, companyId: co.companyId, email: `${id}@sitesort-tests.local`, passwordHash: "x", name: id,
      role: opts.role, emailVerified: true, emailNotifications: opts.emailNotifications ?? true, portalOnly: opts.portalOnly ?? false,
    });
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: id, companyId: co.companyId, role: opts.role });
    extra.push(id);
    return id;
  };

  beforeAll(async () => {
    co = await seedCompany();
    elsewhere = await seedCompany();
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: elsewhere.userId, companyId: co.companyId, role: "admin" });
  });

  afterAll(async () => {
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, [...extra, elsewhere.userId]));
    await db.delete(usersTable).where(inArray(usersTable.id, extra));
    await cleanupFixtures([co, elsewhere]);
  });

  it("every admin and PM of the company, wherever they are homed; not workers, portal-only accounts, or anyone with email off", async () => {
    const pm = await addUser({ role: "project_manager" });
    const pmEmailOff = await addUser({ role: "project_manager", emailNotifications: false });
    const worker = await addUser({ role: "site_worker" });
    const portalPm = await addUser({ role: "project_manager", portalOnly: true });
    const ids = (await reminderRecipients(co.companyId)).map(r => r.userId).sort();
    expect(ids).toEqual([co.userId, elsewhere.userId, pm].sort());
    for (const not of [pmEmailOff, worker, portalPm]) expect(ids).not.toContain(not);
  });

  it("the old rule (home company, role admin) would have missed the PM and the admin homed elsewhere", async () => {
    const old = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.companyId, co.companyId), eq(usersTable.role, "admin"), eq(usersTable.emailNotifications, true)));
    expect(old.map(r => r.id)).toEqual([co.userId]);
    expect((await reminderRecipients(co.companyId)).length).toBe(3);
  });

  it("each person once", async () => {
    const ids = (await reminderRecipients(co.companyId)).map(r => r.userId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
