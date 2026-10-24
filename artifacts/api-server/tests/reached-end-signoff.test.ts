import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, reachEnd, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Dean, 2026-10-24: sign-off (PIN or acknowledgement, one rule) needs the
 * viewer to have reported that the person reached the end of the document,
 * or, for a file SiteSort can't draw, that they opened it outside SiteSort.
 * The server refuses until then, before the PIN, so old phones are told to
 * update. The record says how the end was reached; never "read".
 */
describe("sign-off needs the end of the document reached first", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let outsider: PortalMemberFixture;
  let portal = "";
  let outsiderToken = "";
  const ids: string[] = [];

  const upload = async (type: string, ext: string, extra: Record<string, unknown> = {}) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `Doc ${randomUUID().slice(0, 6)}`, type, fileUrl: `/api/uploads/test-${randomUUID()}.${ext}`, fileSize: 100, requiresAcknowledgment: true, ...extra },
    });
    expect(res.status).toBe(201);
    ids.push(res.json.id);
    return res.json.id as string;
  };
  const shareTo = (id: string, personId: string) =>
    api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: id, audiences: [{ type: "person", personId }] } });
  const view = (id: string) => api(`/portal/documents/${id}/view`, { method: "POST", token: portal });
  const ack = (id: string, body: Record<string, unknown> = {}) => api(`/portal/documents/${id}/acknowledge`, { method: "POST", token: portal, body });
  const mine = async (id: string, userId = member.userId) =>
    (await db.select().from(documentDistributionsTable).where(and(eq(documentDistributionsTable.documentId, id), eq(documentDistributionsTable.userId, userId))))[0];

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    outsider = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
    outsiderToken = (await portalLogin(outsider.email, outsider.password)).token;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId, outsider.userId]));
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.userId, [member.userId, outsider.userId]));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupPortalMember(outsider, []);
    await cleanupFixtures([co]);
  });

  it("a PIN sign-off is refused after opening until the end is reached, before the PIN is checked; the record says how", async () => {
    const rams = await upload("method_statement", "pdf");
    expect((await shareTo(rams, member.personIds[0])).status).toBe(201);
    expect((await view(rams)).status).toBe(200);
    const early = await ack(rams, { pin: "0000" }); // wrong PIN: refused for the end, PIN not spent
    expect(early.status).toBe(409);
    expect(early.json.error).toBe("reach_end_first");
    expect(early.json.message).toMatch(/Tap Reload in the blue bar/);
    expect((await mine(rams)).status).toBe("viewed");
    expect(await reachEnd(portal, rams)).toBe(200);
    expect((await ack(rams, { pin: member.pin })).status).toBe(200);
    expect(await mine(rams)).toMatchObject({ status: "acknowledged", reachedEndHow: "scrolled", signedOffWithPin: true });
    const [audit] = await db.select().from(acknowledgmentAuditTable).where(and(eq(acknowledgmentAuditTable.documentId, rams), eq(acknowledgmentAuditTable.userId, member.userId)));
    expect(audit.reachedEndHow).toBe("scrolled");
  });

  it("an acknowledgement without a PIN follows the same rule", async () => {
    const general = await upload("general", "pdf");
    expect((await shareTo(general, member.personIds[0])).status).toBe(201);
    expect((await view(general)).status).toBe(200);
    expect((await ack(general)).json.error).toBe("reach_end_first");
    expect(await reachEnd(portal, general, { how: "one_screen" })).toBe(200);
    expect((await ack(general)).status).toBe(200);
    expect(await mine(general)).toMatchObject({ status: "acknowledged", reachedEndHow: "one_screen", signedOffWithPin: false });
  });

  it("reaching the end needs an open, fits the file type, and the first report stands", async () => {
    const pdf = await upload("general", "pdf");
    const docx = await upload("general", "docx");
    for (const id of [pdf, docx]) expect((await shareTo(id, member.personIds[0])).status).toBe(201);
    expect((await api(`/portal/documents/${pdf}/reached-end`, { method: "POST", token: portal, body: { how: "scrolled" } })).json.error).toBe("open_first");
    expect((await view(pdf)).status).toBe(200);
    expect((await view(docx)).status).toBe(200);
    // A PDF is drawn in SiteSort: "opened outside" only when it wouldn't draw.
    expect(await reachEnd(portal, pdf, { how: "opened_outside" })).toBe(400);
    expect(await reachEnd(portal, pdf, { how: "read" })).toBe(400);
    // A Word file can only be opened outside SiteSort.
    expect(await reachEnd(portal, docx, { how: "scrolled" })).toBe(400);
    expect(await reachEnd(portal, docx, { how: "opened_outside" })).toBe(200);
    expect(await reachEnd(portal, pdf, { how: "opened_outside_render_failed" })).toBe(200);
    expect(await reachEnd(portal, pdf, { how: "scrolled" })).toBe(200);
    expect((await mine(pdf)).reachedEndHow).toBe("opened_outside_render_failed");
    expect((await mine(docx)).reachedEndHow).toBe("opened_outside");
  });

  it("someone the document isn't shared with can't report reaching its end", async () => {
    const pdf = await upload("general", "pdf");
    expect((await shareTo(pdf, member.personIds[0])).status).toBe(201);
    expect(await reachEnd(outsiderToken, pdf)).toBe(404);
  });

  it("dashboard: the same refusal, and the dashboard's own route", async () => {
    const doc = await upload("general", "pdf");
    await db.insert(documentDistributionsTable).values({ id: randomUUID(), documentId: doc, userId: co.userId, status: "pending" });
    expect((await api(`/documents/${doc}/view`, { method: "POST", token: admin })).status).toBe(200);
    const early = await api(`/documents/${doc}/acknowledge`, { method: "POST", token: admin, body: {} });
    expect(early.status).toBe(409);
    expect(early.json.error).toBe("reach_end_first");
    expect(await reachEnd(admin, doc, { dashboard: true })).toBe(200);
    expect((await api(`/documents/${doc}/acknowledge`, { method: "POST", token: admin, body: {} })).status).toBe(200);
    expect((await mine(doc, co.userId)).reachedEndHow).toBe("scrolled");
  });
});
