import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { qrCodesTable } from "@workspace/db/schema";
import { API_BASE, seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * 2026-10-21 (Dean): the QR site board refreshes itself every minute, so its
 * data must never come from a cached copy. A 404 is what the board treats as
 * "switched off".
 */
describe("site board data is never cached", () => {
  let co: Fixture;
  let qrToken = "";

  beforeAll(async () => {
    co = await seedCompany();
    const admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
  });

  afterAll(async () => {
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("GET /site/:token says no-store and carries the time it was built", async () => {
    const res = await fetch(`${API_BASE}/site/${qrToken}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(typeof (await res.json()).generatedAt).toBe("string");
  });

  it("a removed board answers 404", async () => {
    await db.delete(qrCodesTable).where(eq(qrCodesTable.token, qrToken));
    expect((await fetch(`${API_BASE}/site/${qrToken}`)).status).toBe(404);
  });
});
