import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, pendingPushesTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * The alert for a shared document must open a page the portal has. It linked
 * to /portal/drawings?doc=<id> (and method-statements/safety/general), pages
 * retired into Shared with me in July, so every tap landed on "Section not
 * found" (2026-10-19, all portal users).
 */
describe("portal alerts for shared documents open Shared with me", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  const docIds: string[] = [];

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    await portalLogin(member.email, member.password);
    for (const type of ["drawing", "method_statement", "general"]) {
      docIds.push(await createTestDocument(co.projectId, admin, { name: `Alert link ${type}`, type }));
    }
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(pendingPushesTable).where(inArray(pendingPushesTable.itemId, docIds));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, docIds));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docIds));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(docIds);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("every document type's alert links to /portal/shared?doc=<id>", async () => {
    for (const docId of docIds) {
      const share = await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: docId, audiences: [{ type: "all" }] } });
      expect(share.status).toBe(201);
      const queued = await db.select().from(pendingPushesTable).where(eq(pendingPushesTable.itemId, docId));
      expect(queued.length).toBeGreaterThan(0);
      for (const q of queued) expect(q.deepLink).toBe(`/portal/shared?doc=${docId}`);
    }
  });
});
