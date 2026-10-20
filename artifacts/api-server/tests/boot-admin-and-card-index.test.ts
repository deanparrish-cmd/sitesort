import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { logger } from "../src/lib/logger";
import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { projectMembersTable, peopleTable, usersTable } from "@workspace/db/schema";
import { ensureSchema, bootstrapPlatformAdmin } from "../src/lib/ensure-schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * Boot changes, 2026-10-20 (Dean):
 *  - platform admin bootstrap grants the founders ONLY when nobody holds the
 *    flag; once anyone does, the Admin page is authoritative (a revoke used to
 *    be undone at every restart).
 *  - one membership row per card per project: unique index on
 *    (project_id, person_id) WHERE person_id IS NOT NULL, created only when no
 *    duplicates exist.
 * The bootstrap runs inside a transaction that is rolled back, so the shared
 * database's real admin flags are never changed.
 */
describe("platform admin bootstrap", () => {
  const founders = ["dean.parrish@me.com", "amy-parrish@hotmail.co.uk"];

  async function inTx(fn: (c: import("pg").PoolClient) => Promise<void>) {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await fn(c); } finally { await c.query("ROLLBACK"); c.release(); }
  }
  async function flags(c: import("pg").PoolClient) {
    const r = await c.query("SELECT email, platform_admin FROM users WHERE email = ANY($1)", [founders]);
    return new Map(r.rows.map((x: { email: string; platform_admin: boolean }) => [x.email, x.platform_admin]));
  }

  it("with someone already a platform admin, a revoked founder stays revoked", async () => {
    await inTx(async c => {
      const present = await flags(c);
      expect(present.size).toBeGreaterThan(0); // founders exist in this database
      // The Admin page revoked both founders; someone else holds the flag.
      await c.query("UPDATE users SET platform_admin = false WHERE email = ANY($1)", [founders]);
      const other = await c.query("SELECT id FROM users WHERE NOT (email = ANY($1)) ORDER BY created_at LIMIT 1", [founders]);
      await c.query("UPDATE users SET platform_admin = true WHERE id = $1", [other.rows[0].id]);
      const granted = await bootstrapPlatformAdmin(c);
      expect(granted).toEqual([]);
      for (const v of (await flags(c)).values()) expect(v).toBe(false);
    });
  });

  it("with nobody a platform admin (empty system), the founders are granted it", async () => {
    await inTx(async c => {
      await c.query("UPDATE users SET platform_admin = false WHERE platform_admin = true");
      const granted = await bootstrapPlatformAdmin(c);
      expect(granted.sort()).toEqual([...(await flags(c)).keys()].sort());
      for (const v of (await flags(c)).values()) expect(v).toBe(true);
      const others = await c.query("SELECT count(*)::int AS n FROM users WHERE platform_admin AND NOT (email = ANY($1))", [founders]);
      expect(others.rows[0].n).toBe(0);
      // Running it again changes nothing.
      expect(await bootstrapPlatformAdmin(c)).toEqual([]);
    });
  });

  it("the boot log line says what the step does", async () => {
    const src = await import("node:fs").then(fs => fs.readFileSync(new URL("../src/lib/ensure-schema.ts", import.meta.url), "utf8"));
    expect(src).not.toContain("Dean/Amy seeded");
    expect(src).toContain("platform-admin bootstrap (grants founders only if no platform admin exists) ready");
  });
});

describe("one membership row per card per project", () => {
  let co: Fixture;
  let admin = "";
  const cleanupPeople: string[] = [];

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    await ensureSchema();
  });
  afterAll(async () => {
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    for (const id of cleanupPeople) await db.delete(peopleTable).where(eq(peopleTable.id, id));
    await cleanupFixtures([co]);
  });

  it("the unique index exists once there are no duplicates", async () => {
    const r = await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename = 'project_members' AND indexname = 'project_members_project_person_uq'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].indexdef).toMatch(/UNIQUE INDEX .* \(project_id, person_id\) WHERE \(person_id IS NOT NULL\)/);
  });

  it("a second row for the same card on the same project is refused", async () => {
    const card = await api(`/projects/${co.projectId}/in-house-people`, { method: "POST", token: admin, body: { firstName: "Index", lastName: "Check", email: `idx-${randomUUID().slice(0, 8)}@sitesort-tests.local` } });
    cleanupPeople.push(card.json.id);
    expect((await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId: card.json.id, role: "worker" } })).status).toBeLessThan(300);
    await expect(db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: null, personId: card.json.id, role: "worker" }))
      .rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("with a duplicate present (prod today), boot skips the index, warns, and finishes", async () => {
    const card = await api(`/projects/${co.projectId}/in-house-people`, { method: "POST", token: admin, body: { firstName: "Dup", lastName: "Present", email: `dup-${randomUUID().slice(0, 8)}@sitesort-tests.local` } });
    cleanupPeople.push(card.json.id);
    await pool.query("DROP INDEX IF EXISTS project_members_project_person_uq");
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) await db.insert(projectMembersTable).values({ id, projectId: co.projectId, userId: null, personId: card.json.id, role: "worker" });
    const warn = vi.spyOn(logger, "warn");
    const info = vi.spyOn(logger, "info");
    try {
      await ensureSchema();
      expect(warn.mock.calls.some(c => String(c[1]).includes("project_members_project_person_uq NOT created"))).toBe(true);
      // The rest of the boot still ran: the end-of-run summary line was written.
      expect(info.mock.calls.some(c => String(c[0]).includes("self-heal ready"))).toBe(true);
      const idx = await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'project_members_project_person_uq'");
      expect(idx.rows).toHaveLength(0);
    } finally {
      warn.mockRestore(); info.mockRestore();
      await db.delete(projectMembersTable).where(eq(projectMembersTable.id, ids[1]));
    }
    // Once the duplicate is gone, the next boot creates it.
    await ensureSchema();
    const idx = await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'project_members_project_person_uq'");
    expect(idx.rows).toHaveLength(1);
  });

  it("granting portal access to a dashboard user uses the card's own row, not a second one", async () => {
    // The admin's card is on the project with no login on its row, and the
    // admin also holds a legacy team row with no card: the old code linked
    // the team row to the card, which made a second row (now refused).
    const card = await api(`/projects/${co.projectId}/in-house-people`, { method: "POST", token: admin, body: { firstName: "Dash", lastName: "Board", email: co.email } });
    expect([200, 201]).toContain(card.status);
    cleanupPeople.push(card.json.id);
    await db.delete(projectMembersTable).where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, co.userId)));
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: null, personId: card.json.id, role: "worker" });
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: co.userId, personId: null, role: "project_manager" });
    const inv = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: card.json.id, role: "worker" } });
    expect(inv.status).toBeLessThan(300);
    const rows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.personId, card.json.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(co.userId);
    const loginRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, co.userId)));
    expect(loginRows).toHaveLength(1);
    void usersTable;
  });
});
