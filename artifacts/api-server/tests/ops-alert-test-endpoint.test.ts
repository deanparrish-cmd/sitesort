import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { api, cleanupFixtures, login, seedCompany, type Fixture } from "./helpers";

// POST /api/admin/ops-alert-test: platform admins only, and outside the
// deployed app it refuses (email is off here) rather than pretending it sent.
describe("ops alert test endpoint", () => {
  const fixtures: Fixture[] = [];
  let adminToken: string;
  let otherToken: string;

  beforeAll(async () => {
    const platformAdmin = await seedCompany({ role: "admin" });
    const other = await seedCompany({ role: "admin" });
    fixtures.push(platformAdmin, other);
    await db.update(usersTable).set({ platformAdmin: true }).where(eq(usersTable.id, platformAdmin.userId));
    adminToken = await login(platformAdmin.email);
    otherToken = await login(other.email);
  });
  afterAll(() => cleanupFixtures(fixtures));

  it("needs a login", async () => {
    expect((await api("/admin/ops-alert-test", { method: "POST" })).status).toBe(401);
  });
  it("refuses a company admin who is not a platform admin", async () => {
    expect((await api("/admin/ops-alert-test", { method: "POST", token: otherToken })).status).toBe(403);
  });
  it("tells a platform admin it only sends from the live app", async () => {
    const { status, json } = await api("/admin/ops-alert-test", { method: "POST", token: adminToken });
    expect(status).toBe(409);
    expect(json.error).toBe("not_deployed");
  });
});
