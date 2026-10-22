import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, acknowledgmentAuditTable,
  portalMemberDocumentsTable,
} from "@workspace/db/schema";
import {
  API_BASE, seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Dean, 2026-10-22:
 * - Open before sign-off. A signature means "I have read this and I accept
 *   it". Signing a never-opened document used to stamp an open time anyway,
 *   so the record claimed a read that never happened.
 * - "Pending sign-off" counts only documents that need a sign-off, and
 *   everyone who hasn't signed (opened or not). It used to count unopened
 *   copies of ANY document and skip people who opened but never signed.
 * - "Mark as replaced" on a rejected submission, for a replacement filed
 *   under another kind.
 */
describe("open before sign-off; what counts as waiting for sign-off; mark as replaced", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  const ids: string[] = [];

  const upload = async (type: string, requiresAcknowledgment: boolean) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `${type} ${randomUUID().slice(0, 6)}`, type, fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, requiresAcknowledgment },
    });
    expect(res.status).toBe(201);
    ids.push(res.json.id);
    return res.json.id as string;
  };
  const shareAll = (id: string) => api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: id, audiences: [{ type: "all" }] } });
  const myRow = async (docId: string, userId: string) =>
    (await db.select().from(documentDistributionsTable).where(and(eq(documentDistributionsTable.documentId, docId), eq(documentDistributionsTable.userId, userId))))[0];
  const waiting = async () => (await api("/compliance", { token: admin })).json.pendingAcknowledgments as any[];

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalMemberDocumentsTable).where(eq(portalMemberDocumentsTable.projectId, co.projectId));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("portal: no sign-off before opening, checked before the PIN; no open time is invented", async () => {
    const rams = await upload("method_statement", true);
    expect((await shareAll(rams)).status).toBe(201);
    // Wrong PIN too: refused for not opening, so the PIN isn't spent on it.
    const early = await api(`/portal/documents/${rams}/acknowledge`, { method: "POST", token: portal, body: { pin: "0000" } });
    expect(early.status).toBe(409);
    expect(early.json.error).toBe("open_first");
    expect(early.json.message).toBe("Open the document first. You can sign it off once you've opened it.");
    expect((await myRow(rams, member.userId))?.viewedAt ?? null).toBeNull();
    expect((await api(`/portal/documents/${rams}/view`, { method: "POST", token: portal })).status).toBe(200);
    const opened = (await myRow(rams, member.userId))!.viewedAt!;
    await new Promise(r => setTimeout(r, 20));
    expect((await api(`/portal/documents/${rams}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } })).status).toBe(200);
    const row = (await myRow(rams, member.userId))!;
    expect(row.status).toBe("acknowledged");
    expect(row.viewedAt!.getTime()).toBe(opened.getTime());
    expect(row.acknowledgedAt!.getTime()).toBeGreaterThan(opened.getTime());
  });

  it("portal: downloading the file counts as opening it", async () => {
    const rams = await upload("method_statement", true);
    expect((await shareAll(rams)).status).toBe(201);
    await fetch(`${API_BASE}/portal/documents/${rams}/download`, { headers: { Authorization: `Bearer ${portal}` } }).then(r => r.arrayBuffer()).catch(() => null);
    expect((await myRow(rams, member.userId))?.viewedAt).toBeTruthy();
    expect((await api(`/portal/documents/${rams}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } })).status).toBe(200);
  });

  it("dashboard: a recipient must open it (the Open button records it) before signing", async () => {
    const doc = await upload("general", true);
    await db.insert(documentDistributionsTable).values({ id: randomUUID(), documentId: doc, userId: co.userId, status: "pending" });
    const early = await api(`/documents/${doc}/acknowledge`, { method: "POST", token: admin, body: {} });
    expect(early.status).toBe(409);
    expect(early.json.error).toBe("open_first");
    const v = await api(`/documents/${doc}/view`, { method: "POST", token: admin });
    expect(v.json).toMatchObject({ success: true, recorded: true });
    expect((await api(`/documents/${doc}/acknowledge`, { method: "POST", token: admin, body: {} })).status).toBe(200);
    expect((await myRow(doc, co.userId))!.status).toBe("acknowledged");
  });

  it("waiting for sign-off: only documents that need one; opened-but-unsigned counts; signed doesn't", async () => {
    const noSignoff = await upload("drawing", false);
    expect((await shareAll(noSignoff)).status).toBe(201);
    const needs = await upload("general", true);
    expect((await shareAll(needs)).status).toBe(201);
    let list = await waiting();
    expect(list.find(a => a.documentId === noSignoff)).toBeUndefined(); // unopened copy of a no-sign-off doc
    expect(list.find(a => a.documentId === needs)).toMatchObject({ pendingCount: 1 });
    expect(list.find(a => a.documentId === needs).recipients[0]).toMatchObject({ userId: member.userId, status: "pending" });
    // Opened, not signed: still waiting.
    expect((await api(`/portal/documents/${needs}/view`, { method: "POST", token: portal })).status).toBe(200);
    list = await waiting();
    expect(list.find(a => a.documentId === needs)).toMatchObject({ pendingCount: 1 });
    expect(list.find(a => a.documentId === needs).recipients[0].status).toBe("viewed");
    const alerts = (await api(`/projects/${co.projectId}`, { token: admin })).json;
    expect(alerts.alertCount).toBeGreaterThanOrEqual(1);
    // Signed: gone.
    expect((await api(`/portal/documents/${needs}/acknowledge`, { method: "POST", token: portal, body: {} })).status).toBe(200);
    expect((await waiting()).find(a => a.documentId === needs)).toBeUndefined();
  });

  it("mark as replaced moves a rejected submission to the Rejected folder; only rejected ones", async () => {
    const id = randomUUID();
    await db.insert(portalMemberDocumentsTable).values({ id, projectId: co.projectId, userId: member.userId, name: "Insurance filed as other", fileUrl: "/api/uploads/x.pdf", kind: "other", status: "rejected", reviewNote: "Wrong year" });
    const pending = randomUUID();
    await db.insert(portalMemberDocumentsTable).values({ id: pending, projectId: co.projectId, userId: member.userId, name: "Still pending", fileUrl: "/api/uploads/y.pdf", kind: "insurance", status: "pending" });
    expect((await api(`/projects/${co.projectId}/member-documents/${pending}/mark-replaced`, { method: "POST", token: admin })).status).toBe(409);
    expect((await api(`/projects/${co.projectId}/member-documents/${id}/mark-replaced`, { method: "POST", token: portal })).status).toBeGreaterThanOrEqual(401);
    expect((await api(`/projects/${co.projectId}/member-documents/${id}/mark-replaced`, { method: "POST", token: admin })).status).toBe(200);
    const row = ((await api(`/projects/${co.projectId}/member-documents`, { token: admin })).json as any[]).find(d => d.id === id);
    expect(row).toMatchObject({ status: "rejected", reviewNote: "Wrong year", markedReplaced: { byName: expect.any(String) } });
    expect(row.markedReplaced.at).toBeTruthy();
  });
});
