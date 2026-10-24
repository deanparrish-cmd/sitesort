import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, documentsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture, reachEnd } from "./helpers";

/**
 * Dean, 2026-10-23, option (a): new drawings and new revisions require a PIN
 * signature. Drawings already on a project keep their own setting, and nothing
 * already recorded on them is reset.
 */
describe("drawings require a PIN signature from now on; nothing recorded is reset", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  const ids: string[] = [];

  const upload = async (body: Record<string, unknown>) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `GA plan ${randomUUID().slice(0, 6)}`, type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, ...body },
    });
    expect(res.status).toBe(201);
    ids.push(res.json.id);
    return res.json as { id: string; requiresAcknowledgment: boolean; pinRequired: boolean; name: string };
  };
  const share = (id: string) => api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: id, audiences: [{ type: "all" }] } });
  // A drawing as it was before 2026-10-23: no sign-off (written directly, as
  // the old upload path stored it).
  const oldDrawing = async (requiresAcknowledgment: boolean) => {
    const d = await upload({ requiresAcknowledgment: true });
    await db.update(documentsTable).set({ requiresAcknowledgment }).where(eq(documentsTable.id, d.id));
    return d;
  };

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("a new drawing requires sign-off with a PIN, even uploaded with the box unticked", async () => {
    const d = await upload({ requiresAcknowledgment: false });
    expect(d.requiresAcknowledgment).toBe(true);
    expect(d.pinRequired).toBe(true);
    expect((await share(d.id)).status).toBe(201);
    expect((await api(`/portal/documents/${d.id}/view`, { method: "POST", token: portal })).status).toBe(200);
    expect(await reachEnd(portal, d.id)).toBe(200);
    const noPin = await api(`/portal/documents/${d.id}/acknowledge`, { method: "POST", token: portal, body: {} });
    expect(noPin.status).toBe(400);
    expect((await api(`/portal/documents/${d.id}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } })).status).toBe(200);
    const [row] = await db.select().from(documentDistributionsTable).where(and(eq(documentDistributionsTable.documentId, d.id), eq(documentDistributionsTable.userId, member.userId)));
    expect(row.signedOffWithPin).toBe(true);
  });

  it("an existing drawing without sign-off is left alone; its next revision requires a PIN signature", async () => {
    const old = await oldDrawing(false);
    expect((await share(old.id)).status).toBe(201);
    expect((await api(`/portal/documents/${old.id}/view`, { method: "POST", token: portal })).status).toBe(200);
    const shared = ((await api("/portal/shared", { token: portal })).json.documents as any[]).find(x => x.id === old.id);
    expect(shared.requiresAcknowledgment).toBe(false);
    expect(shared.myStatus).toBe("viewed"); // its Opened mark is kept
    expect((await db.select().from(documentsTable).where(eq(documentsTable.id, old.id)))[0].requiresAcknowledgment).toBe(false);
    // A real revision: supersededDocumentId plus the carry-forward answer
    // (the upload route reads these; an unknown field would upload an
    // unrelated new drawing and prove nothing about revisions).
    const ruleIds = (await db.select().from(portalSharesTable).where(eq(portalSharesTable.itemId, old.id))).map(r => r.id);
    expect(ruleIds.length).toBeGreaterThan(0);
    const rev = await upload({ name: old.name, supersededDocumentId: old.id, requiresAcknowledgment: false, carryShareIds: ruleIds, carryShownShareIds: ruleIds });
    const [oldRow] = await db.select().from(documentsTable).where(eq(documentsTable.id, old.id));
    expect(oldRow.status).toBe("superseded");
    const [revRow] = await db.select().from(documentsTable).where(eq(documentsTable.id, rev.id));
    expect(revRow.previousVersionId).toBe(old.id);
    expect(rev.requiresAcknowledgment).toBe(true);
    expect(rev.pinRequired).toBe(true);
    // The member gets the revision and must sign it with a PIN.
    expect((await api(`/portal/documents/${rev.id}/view`, { method: "POST", token: portal })).status).toBe(200);
    expect(await reachEnd(portal, rev.id)).toBe(200);
    expect((await api(`/portal/documents/${rev.id}/acknowledge`, { method: "POST", token: portal, body: {} })).status).toBe(400);
  });

  it("on an existing drawing that already required sign-off, an earlier no-PIN acknowledgement stays; anyone still to sign now needs a PIN", async () => {
    const d = await oldDrawing(true);
    await db.insert(documentDistributionsTable).values({ id: randomUUID(), documentId: d.id, userId: co.userId, status: "acknowledged", viewedAt: new Date(Date.now() - 60_000), acknowledgedAt: new Date(), signedOffWithPin: false });
    expect((await share(d.id)).status).toBe(201);
    expect((await api(`/portal/documents/${d.id}/view`, { method: "POST", token: portal })).status).toBe(200);
    expect(await reachEnd(portal, d.id)).toBe(200);
    expect((await api(`/portal/documents/${d.id}/acknowledge`, { method: "POST", token: portal, body: {} })).status).toBe(400);
    expect((await api(`/portal/documents/${d.id}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } })).status).toBe(200);
    const rows = await db.select().from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, d.id));
    expect(rows.find(r => r.userId === co.userId)).toMatchObject({ status: "acknowledged", signedOffWithPin: false });
    expect(rows.find(r => r.userId === member.userId)).toMatchObject({ status: "acknowledged", signedOffWithPin: true });
    const summary = ((await api(`/projects/${co.projectId}/documents`, { token: admin })).json as any[]).find(x => x.id === d.id).distributionSummary;
    expect(summary).toMatchObject({ acknowledged: 2, signedWithPin: 1 });
  });
});
