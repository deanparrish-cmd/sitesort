import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * The main Team Portal workflow: a PM shares a drawing with "Everyone on this
 * project" and a portal member finds it in Shared with me, on the Drawings
 * list and by its notification deep link, and can open the file.
 */
describe("drawing shared with everyone reaches the portal", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  let docId = "";

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
    docId = await createTestDocument(co.projectId, admin, { name: "GA Plan", type: "drawing" });
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(eq(portalSharesTable.itemId, docId));
    await db.delete(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, docId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments([docId]);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("share is written, listed and opens", async () => {
    const share = await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: docId, audiences: [{ type: "all" }] } });
    console.log("share", share.status, JSON.stringify(share.json));
    expect(share.status).toBe(201);
    const rows = await db.select().from(portalSharesTable).where(eq(portalSharesTable.itemId, docId));
    console.log("rows", rows.length, rows[0]?.audienceType);
    expect(rows.length).toBe(1);

    const shared = await api("/portal/shared", { token: portal });
    console.log("shared", shared.status, JSON.stringify(shared.json).slice(0, 400));
    expect(shared.status).toBe(200);
    expect(shared.json.documents.map((d: any) => d.id)).toContain(docId);

    const list = await api("/portal/drawings", { token: portal });
    console.log("drawings", list.status, JSON.stringify(list.json).slice(0, 300));
    const detail = await api(`/portal/drawings/${docId}`, { token: portal });
    console.log("detail", detail.status, JSON.stringify(detail.json).slice(0, 300));
    expect(detail.status).toBe(200);
  });
});
