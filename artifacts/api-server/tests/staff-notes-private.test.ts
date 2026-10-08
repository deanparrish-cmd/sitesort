import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import { usersTable, companyMembersTable, userNotesTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * #121: notes & reminders about a member of staff are a manager's private
 * record. Admin / PM only, never the person they're about, never across
 * companies (a person in two companies doesn't carry one company's notes into
 * the other).
 */
describe("staff notes are private to managers", () => {
  let co: Fixture;
  let other: Fixture;
  const tok: Record<string, string> = {};
  const sfx = randomUUID().slice(0, 8);
  const id = { pm: `tsn-pm-${sfx}`, worker: `tsn-wk-${sfx}`, colleague: `tsn-co-${sfx}` };

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    tok.admin = await login(co.email);
    tok.otherAdmin = await login(other.email);
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    const add = async (uid: string, role: string) => {
      await db.insert(usersTable).values({ id: uid, companyId: co.companyId, email: `${uid}@example.test`, passwordHash: owner.passwordHash, name: `Name ${uid}`, role, emailVerified: true });
      await db.insert(companyMembersTable).values({ id: randomUUID(), userId: uid, companyId: co.companyId, role });
      return login(`${uid}@example.test`);
    };
    tok.pm = await add(id.pm, "project_manager");
    tok.worker = await add(id.worker, "site_worker");
    tok.colleague = await add(id.colleague, "site_worker");
    // The worker also belongs to the other company.
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: id.worker, companyId: other.companyId, role: "site_worker" });
  });

  afterAll(async () => {
    await db.delete(userNotesTable).where(or(inArray(userNotesTable.userId, Object.values(id)), inArray(userNotesTable.authorId, Object.values(id))));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, Object.values(id)));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(id)));
    await cleanupFixtures([co, other]);
  });

  it("a manager can write and read notes about a worker", async () => {
    const w = await api(`/users/${id.worker}/notes`, { method: "POST", token: tok.pm, body: { body: "Late twice this week" } });
    expect(w.status).toBe(201);
    const r = await api(`/users/${id.worker}/notes`, { token: tok.admin });
    expect(r.status).toBe(200);
    expect(r.json.map((n: any) => n.body)).toContain("Late twice this week");
  });

  it("the worker can't read notes about themselves", async () => {
    expect((await api(`/users/${id.worker}/notes`, { token: tok.worker })).status).toBe(403);
  });

  it("another site worker can't read or write them", async () => {
    expect((await api(`/users/${id.worker}/notes`, { token: tok.colleague })).status).toBe(403);
    expect((await api(`/users/${id.worker}/notes`, { method: "POST", token: tok.colleague, body: { body: "x" } })).status).toBe(403);
  });

  it("a manager can't read notes about themselves either", async () => {
    await api(`/users/${id.pm}/notes`, { method: "POST", token: tok.admin, body: { body: "Review due" } });
    expect((await api(`/users/${id.pm}/notes`, { token: tok.pm })).status).toBe(403);
  });

  it("another company's admin sees none of this company's notes about a shared person", async () => {
    const r = await api(`/users/${id.worker}/notes`, { token: tok.otherAdmin });
    expect(r.status).toBe(200);
    expect(r.json).toEqual([]);
  });
});
