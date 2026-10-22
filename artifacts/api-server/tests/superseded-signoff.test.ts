import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * 2026-10-21 (Dean): a replaced revision can't be signed off, and close-out,
 * the project alert count and the compliance list all read the LATEST
 * revision, including a new revision that reached nobody.
 */
describe("sign-off reads the latest revision", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  let revB = "";
  let revC = "";

  const upload = (body: Record<string, unknown>) => api(`/projects/${co.projectId}/documents`, {
    method: "POST", token: admin,
    body: { type: "method_statement", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, requiresAcknowledgment: true, ...body },
  });
  const shareAll = (itemId: string) => api(`/projects/${co.projectId}/portal-shares`, {
    method: "POST", token: admin, body: { itemType: "document", itemId, audiences: [{ type: "all" }] },
  });
  const closeout = async () => (await api(`/projects/${co.projectId}/closeout`, { token: admin })).json.checks.signOffs;
  const projectAlerts = async () => {
    const { json } = await api("/projects", { token: admin });
    const p = (json as { id: string; alertCount: number; alertDocumentId: string | null }[]).find(x => x.id === co.projectId)!;
    return { alertCount: p.alertCount, alertDocumentId: p.alertDocumentId };
  };
  const complianceEntry = async (docId: string) =>
    ((await api("/compliance", { token: admin })).json.pendingAcknowledgments as { documentId: string; notSent?: boolean; pendingCount: number }[])
      .find(a => a.documentId === docId);

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
    const b = await upload({ name: `RAMS ${randomUUID().slice(0, 6)}`, revision: "B" });
    expect(b.status).toBe(201);
    revB = b.json.id;
    expect((await shareAll(revB)).status).toBe(201);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    const ids = [revB, revC].filter(Boolean);
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("before a new revision: one pending sign-off, counted everywhere", async () => {
    expect(await closeout()).toMatchObject({ pendingCount: 1, ok: false });
    expect(await projectAlerts()).toEqual({ alertCount: 1, alertDocumentId: revB });
  });

  it("a new revision shared with nobody is outstanding, not 'all complete'", async () => {
    const name = (await api(`/documents/${revB}`, { token: admin })).json.name;
    // carryShareIds: [] = this upload deliberately shares Rev C with nobody
    // (with the list the uploader saw, required since 2026-10-21).
    const shown = ((await api(`/projects/${co.projectId}/portal-shares?itemType=document&itemId=${revB}`, { token: admin })).json as { id: string }[]).map(r => r.id);
    const c = await upload({ name, supersededDocumentId: revB, revision: "C", carryShareIds: [], carryShownShareIds: shown });
    expect(c.status).toBe(201);
    revC = c.json.id;
    // Rev B's pending row no longer counts; Rev C owes a sign-off from the one person Rev B went to.
    expect(await closeout()).toMatchObject({ pendingCount: 0, notSentCount: 1, ok: false });
    expect(await projectAlerts()).toEqual({ alertCount: 1, alertDocumentId: revC });
    expect(await complianceEntry(revC)).toMatchObject({ notSent: true, pendingCount: 1 });
    expect(await complianceEntry(revB)).toBeUndefined();
  });

  it("the replaced revision can't be signed off, on the portal or the dashboard", async () => {
    const p = await api(`/portal/documents/${revB}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(p.status).toBe(409);
    expect(p.json.error).toBe("superseded");
    const d = await api(`/documents/${revB}/acknowledge`, { method: "POST", token: admin, body: {} });
    expect(d.status).toBe(409);
    expect(d.json.error).toBe("superseded");
    const rows = await db.select().from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, revB));
    expect(rows.every(r => r.status !== "acknowledged")).toBe(true);
  });

  it("sharing and signing off the latest revision clears it", async () => {
    expect((await shareAll(revC)).status).toBe(201);
    expect(await closeout()).toMatchObject({ pendingCount: 1, notSentCount: 0, ok: false });
    // Open before sign-off (2026-10-22): the member opens it, then signs.
    expect((await api(`/portal/documents/${revC}/view`, { method: "POST", token: portal })).status).toBe(200);
    const ack = await api(`/portal/documents/${revC}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(ack.status).toBe(200);
    expect(await closeout()).toMatchObject({ pendingCount: 0, notSentCount: 0, ok: true });
    expect(await projectAlerts()).toEqual({ alertCount: 0, alertDocumentId: null });
  });
});
