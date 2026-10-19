import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { notificationsTable, companyMembersTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * The bell shows only the company the user is signed into, whatever their role
 * in any other company. Amy, admin of Test SiteSort, saw Acme fire-roll alerts
 * there (2026-10-19).
 */
describe("notifications are scoped to the signed-in company", () => {
  let a: Fixture;
  let b: Fixture;
  let tokenA = "";
  let tokenB = "";
  const ids = { a: `n-a-${Date.now()}`, b: `n-b-${Date.now()}`, none: `n-none-${Date.now()}` };

  beforeAll(async () => {
    a = await seedCompany();
    b = await seedCompany();
    // A's admin is added to company B as an admin too: a real path, which
    // also writes the "Added to B" notification (belongs to B).
    const adminB = await login(b.email);
    const add = await api("/users", { method: "POST", token: adminB, body: { email: a.email, name: "Two Company Person", role: "admin" } });
    expect([200, 201]).toContain(add.status);
    tokenA = await login(a.email);
    const sw = await api("/auth/switch-company", { method: "POST", token: tokenA, body: { companyId: b.companyId } });
    expect(sw.status).toBe(200);
    tokenB = sw.json.token;
    await db.insert(notificationsTable).values([
      { id: ids.a, userId: a.userId, companyId: a.companyId, type: "fire_roll_not_ready", title: "A alert", message: "a" },
      { id: ids.b, userId: a.userId, companyId: b.companyId, type: "fire_roll_not_ready", title: "B alert", message: "b" },
    ]);
    // An old row the backfill couldn't place: never shown.
    await pool.query(`INSERT INTO notifications (id, user_id, type, title, message) VALUES ($1, $2, 'team', 'No company', 'x')`, [ids.none, a.userId]);
  });

  afterAll(async () => {
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [a.userId, b.userId]));
    await db.delete(companyMembersTable).where(eq(companyMembersTable.userId, a.userId));
    await cleanupFixtures([a, b]);
  });

  it("each company sees only its own; a row with no company is never shown", async () => {
    const inA = await api("/notifications", { token: tokenA });
    const inB = await api("/notifications", { token: tokenB });
    expect(inA.status).toBe(200);
    const titlesA = inA.json.map((n: any) => n.title);
    const titlesB = inB.json.map((n: any) => n.title);
    expect(titlesA).toContain("A alert");
    expect(titlesA).not.toContain("B alert");
    expect(titlesA.some((t: string) => t.startsWith("Added to"))).toBe(false);
    expect(titlesA).not.toContain("No company");
    expect(titlesB).toContain("B alert");
    expect(titlesB).not.toContain("A alert");
    expect(titlesB.some((t: string) => t.startsWith("Added to"))).toBe(true);
    expect(titlesB).not.toContain("No company");
  });

  it("marking read in one company never touches the other", async () => {
    expect((await api(`/notifications/${ids.b}/read`, { method: "PATCH", token: tokenA })).status).toBe(200);
    expect((await api("/notifications/read-all", { method: "PATCH", token: tokenA })).status).toBe(200);
    const rows = await db.select().from(notificationsTable).where(inArray(notificationsTable.id, [ids.a, ids.b]));
    expect(rows.find(r => r.id === ids.a)?.read).toBe(true);
    expect(rows.find(r => r.id === ids.b)?.read).toBe(false);
  });
});
