import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { siteCheckinsTable, qrCodesTable, notificationsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * Public QR sign-out matching: exact (case/whitespace-insensitive), 3-letter
 * prefix list (first name + company only), near-miss "did you mean", sign-out by
 * id, remembered-device token, company autocomplete, legacy exclusion.
 */
describe("site sign-out matching", () => {
  let co: Fixture;
  let qrToken = "";
  const rowIds: string[] = [];

  async function addOpen(workerName: string, companyName: string, extra: Partial<typeof siteCheckinsTable.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(siteCheckinsTable).values({ id, projectId: co.projectId, workerName, companyName, photoUrl: "/api/uploads/x.jpg", ...extra });
    rowIds.push(id);
    return id;
  }
  const who = (workerName: string, companyName = "") =>
    api(`/site/${qrToken}/who?workerName=${encodeURIComponent(workerName)}&companyName=${encodeURIComponent(companyName)}`);

  beforeAll(async () => {
    co = await seedCompany();
    const admin = await login(co.email);
    const qr = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["general"] } });
    qrToken = qr.json[0].token;
    await addOpen("Paul Smith", "Acme Construction");
    await addOpen("Paula Jones", "Acme Construction");
    await addOpen("Old Legacy", "Acme Construction", { checkoutMethod: "legacy" });
  });

  afterAll(async () => {
    for (const id of rowIds) await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.id, id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("exact match ignores case and extra whitespace", async () => {
    const r = await who("  PAUL   smith ", "acme  construction");
    expect(r.json.exact?.label).toBe("Paul, Acme Construction");
    const s = await api(`/site/${qrToken}/status?workerName=${encodeURIComponent("paul  smith")}&companyName=ACME%20CONSTRUCTION`);
    expect(s.json.onSite).toBe(true);
  });

  it("lists nobody until 3 letters are typed, and never shows surnames or legacy rows", async () => {
    expect((await who("Pa")).json.matches).toHaveLength(0);
    const r = await who("pau");
    const labels = r.json.matches.map((m: any) => m.label).sort();
    expect(labels).toEqual(["Paul, Acme Construction", "Paula, Acme Construction"]);
    expect(JSON.stringify(r.json)).not.toMatch(/Smith|Jones|Legacy/);
    expect((await who("old")).json.matches).toHaveLength(0);
  });

  it("offers near-miss suggestions for typos but never an exact/auto match", async () => {
    const r = await who("Pual Smth", "Acme Constructon");
    expect(r.json.exact).toBeNull();
    expect(r.json.matches).toHaveLength(0);
    expect(r.json.suggestions.map((s: any) => s.label)).toContain("Paul, Acme Construction");
    // far-off names get nothing
    expect((await who("Zachary Quill", "Other Co")).json.suggestions).toHaveLength(0);
  });

  it("signs out by checkinId, only for an open row on this project", async () => {
    const id = await addOpen("Temp Tester", "Acme Construction");
    const out = await api(`/site/${qrToken}/checkout`, { method: "POST", body: { checkinId: id } });
    expect(out.status).toBe(200);
    expect(out.json.checkoutMethod).toBe("self");
    const again = await api(`/site/${qrToken}/checkout`, { method: "POST", body: { checkinId: id } });
    expect(again.status).toBe(409);
    const legacyRow = rowIds[2];
    expect((await api(`/site/${qrToken}/checkout`, { method: "POST", body: { checkinId: legacyRow } })).status).toBe(409);
  });

  it("remembered-device token: valid for its own project only, garbage rejected", async () => {
    const good = jwt.sign({ kind: "site-device", projectId: co.projectId, workerName: "Paul Smith", companyName: "Acme Construction" }, process.env.JWT_SECRET as string);
    const ok = await api(`/site/${qrToken}/device?deviceToken=${encodeURIComponent(good)}`);
    expect(ok.json).toMatchObject({ valid: true, workerName: "Paul Smith", onSite: true });
    const other = jwt.sign({ kind: "site-device", projectId: "some-other-project", workerName: "Paul Smith", companyName: "x" }, process.env.JWT_SECRET as string);
    expect((await api(`/site/${qrToken}/device?deviceToken=${encodeURIComponent(other)}`)).json.valid).toBe(false);
    expect((await api(`/site/${qrToken}/device?deviceToken=garbage`)).json.valid).toBe(false);
  });

  it("company autocomplete returns names only", async () => {
    const r = await api(`/site/${qrToken}/companies`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json.every((n: unknown) => typeof n === "string")).toBe(true);
  });
});
