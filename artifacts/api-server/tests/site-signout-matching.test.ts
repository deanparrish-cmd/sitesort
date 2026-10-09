import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { siteCheckinsTable, qrCodesTable, notificationsTable, subcontractorsTable, projectMembersTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * Public QR sign-out (#122): nobody can list who is on site, and sign-out needs
 * proof of identity: this phone's remembered-device token, or name + company +
 * the mobile number on the person's record. Before #122 anyone at the gate could
 * list people three letters at a time and sign them out by name or list id.
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
  const subId = `tsub-so-${randomUUID().slice(0, 8)}`;
  const checkout = (body: object) => api(`/site/${qrToken}/checkout`, { method: "POST", body });

  beforeAll(async () => {
    co = await seedCompany();
    const admin = await login(co.email);
    const qr = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["general"] } });
    qrToken = qr.json[0].token;
    // Paul is registered on the project with a mobile number on file.
    await db.insert(subcontractorsTable).values({ id: subId, companyId: co.companyId, companyName: "Acme Construction", contactName: "Paul Smith", contactEmail: `${subId}@example.test`, contactPhone: "07700 900123" });
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: subId } as any);
    await addOpen("Paul Smith", "Acme Construction");
    await addOpen("Paula Jones", "Acme Construction");
    await addOpen("Old Legacy", "Acme Construction", { checkoutMethod: "legacy" });
  });

  afterAll(async () => {
    for (const id of rowIds) await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.id, id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, subId));
    await cleanupFixtures([co]);
  });

  it("the who's-on-site lookup and the status oracle are gone", async () => {
    expect((await api(`/site/${qrToken}/who?workerName=pau&companyName=`)).status).toBe(404);
    expect((await api(`/site/${qrToken}/status?workerName=Paul%20Smith&companyName=Acme%20Construction`)).status).toBe(404);
  });

  it("name alone, or an on-site list id alone, can't sign anyone out", async () => {
    expect((await checkout({ workerName: "Paul Smith", companyName: "Acme Construction" })).status).toBe(400);
    expect((await checkout({ checkinId: rowIds[0] })).status).toBe(400);
    const [row] = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, rowIds[0]));
    expect(row.checkedOutAt).toBeNull();
  });

  it("a number nobody has, and a name with someone else's number, get the same refusal (#124: the number decides)", async () => {
    const wrong = await checkout({ phone: "07700 900999" });
    const named = await checkout({ workerName: "Paula Jones", companyName: "Acme Construction", phone: "07700 900998" });
    expect(wrong.status).toBe(403);
    expect(named.status).toBe(403);
    expect(wrong.json).toEqual(named.json);
    expect(wrong.json.error).toBe("identity_not_confirmed");
    const [paula] = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, rowIds[1]));
    expect(paula.checkedOutAt).toBeNull();
  });

  it("the right mobile number signs the person out, in any common format, including an older row with no identity link", async () => {
    const out = await checkout({ phone: "+44 7700 900123" });
    expect(out.status).toBe(200);
    expect(out.json.checkoutMethod).toBe("self");
    expect(out.json.workerName).toBe("Paul Smith");
    expect(out.json).not.toHaveProperty("photoUrl");
    // Nothing open any more: same refusal as an unknown number.
    expect((await checkout({ phone: "07700900123" })).status).toBe(403);
  });

  it("a remembered-device token signs out its own person; another project's token or garbage is refused", async () => {
    await addOpen("Paul Smith", "Acme Construction");
    const other = jwt.sign({ kind: "site-device", projectId: "some-other-project", workerName: "Paul Smith", companyName: "Acme Construction" }, process.env.JWT_SECRET as string);
    expect((await checkout({ deviceToken: other })).status).toBe(403);
    expect((await checkout({ deviceToken: "garbage" })).status).toBe(403);
    const good = jwt.sign({ kind: "site-device", projectId: co.projectId, workerName: "Paul Smith", companyName: "Acme Construction" }, process.env.JWT_SECRET as string);
    expect((await checkout({ deviceToken: good })).status).toBe(200);
  });

  it("remembered-device token: valid for its own project only, garbage rejected", async () => {
    await addOpen("Paul Smith", "Acme Construction");
    const good = jwt.sign({ kind: "site-device", projectId: co.projectId, workerName: "Paul Smith", companyName: "Acme Construction" }, process.env.JWT_SECRET as string);
    const ok = await api(`/site/${qrToken}/device?deviceToken=${encodeURIComponent(good)}`);
    expect(ok.json).toMatchObject({ valid: true, workerName: "Paul Smith", onSite: true });
    const other = jwt.sign({ kind: "site-device", projectId: "some-other-project", workerName: "Paul Smith", companyName: "x" }, process.env.JWT_SECRET as string);
    expect((await api(`/site/${qrToken}/device?deviceToken=${encodeURIComponent(other)}`)).json.valid).toBe(false);
    expect((await api(`/site/${qrToken}/device?deviceToken=garbage`)).json.valid).toBe(false);
  });

  it("the company list and the name lookup are gone (#124)", async () => {
    expect((await api(`/site/${qrToken}/companies`)).status).toBe(404);
    expect((await api(`/site/${qrToken}/register-match?workerName=Paul%20Smith&companyName=Acme`)).status).toBe(404);
  });
});
