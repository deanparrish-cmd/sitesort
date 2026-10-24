import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, documentsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture, reachEnd } from "./helpers";

/**
 * 2026-10-21 (Dean): RAMS, permits and safety documents always require
 * sign-off. A real customer's RAMS went out with sign-off off: nobody could
 * sign it and close-out would report the project complete.
 */
describe("sign-off always required for RAMS, permits and safety documents", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  const ids: string[] = [];

  const upload = async (type: string, requiresAcknowledgment?: unknown) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `${type} ${randomUUID().slice(0, 6)}`, type, fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, ...(requiresAcknowledgment === undefined ? {} : { requiresAcknowledgment }) },
    });
    expect(res.status).toBe(201);
    ids.push(res.json.id);
    return res.json as { id: string; requiresAcknowledgment: boolean };
  };
  const stored = async (id: string) => (await db.select().from(documentsTable).where(eq(documentsTable.id, id)))[0].requiresAcknowledgment;

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

  // Drawings joined 2026-10-23 (Dean, option a).
  it.each(["drawing", "method_statement", "permit", "safety"])("%s uploaded with sign-off off is stored with sign-off on", async (type) => {
    for (const asked of [false, undefined]) {
      const d = await upload(type, asked);
      expect(d.requiresAcknowledgment).toBe(true);
      expect(await stored(d.id)).toBe(true);
    }
  });

  it("other types keep the uploader's choice", async () => {
    for (const type of ["general", "programme"]) {
      expect((await upload(type, false)).requiresAcknowledgment).toBe(false);
      expect((await upload(type, true)).requiresAcknowledgment).toBe(true);
    }
  });

  it("a RAMS uploaded without the tick can be signed off on the portal", async () => {
    const d = await upload("method_statement", false);
    expect((await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: d.id, audiences: [{ type: "all" }] } })).status).toBe(201);
    const row = ((await api("/portal/shared", { token: portal })).json.documents as { id: string; requiresAcknowledgment: boolean }[]).find(x => x.id === d.id);
    expect(row?.requiresAcknowledgment).toBe(true);
    // Open before sign-off (2026-10-22).
    expect((await api(`/portal/documents/${d.id}/view`, { method: "POST", token: portal })).status).toBe(200);
    expect(await reachEnd(portal, d.id)).toBe(200);
    const ack = await api(`/portal/documents/${d.id}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(ack.status).toBe(200);
  });
});
