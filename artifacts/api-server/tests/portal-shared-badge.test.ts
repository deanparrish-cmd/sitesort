import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable,
  permitsTable, photosTable, activityLogTable, portalItemViewsTable,
} from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Dean's bug (2026-10-16): the "Shared with me" badge said 1 but the list
 * didn't show the item. The badge was a second copy of the list's rules and
 * had drifted. Now the badge counts the unseen items of the list itself.
 */
describe("Shared with me badge matches the list", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  let drawing = "";
  let safety = "";
  const permitLive = randomUUID();
  const permitArchived = randomUUID();
  const issue = randomUUID();

  const share = (itemType: string, itemId: string) =>
    api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType, itemId, audiences: [{ type: "all" }] } });

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
    const members = await api(`/projects/${co.projectId}/members`, { token: admin });
    const mine = (members.json as any[]).find(m => m.userId === member.userId);
    expect((await api(`/projects/${co.projectId}/members/${mine.id}/permissions`, { method: "PATCH", token: admin, body: { canLogIssues: true } })).status).toBe(200);

    drawing = await createTestDocument(co.projectId, admin, { name: "Badge Drawing", type: "drawing" });
    safety = await createTestDocument(co.projectId, admin, { name: "Badge Safety", type: "safety" });
    const permit = { projectId: co.projectId, type: "hot_works", description: "Badge permit", responsibleUserId: co.userId, startDate: "2026-01-01", expiryDate: "2099-01-01" };
    await db.insert(permitsTable).values([{ id: permitLive, ...permit }, { id: permitArchived, ...permit, archivedAt: new Date() }]);
    await db.insert(photosTable).values({ id: issue, projectId: co.projectId, uploadedBy: co.userId, category: "snag", referenceNumber: `B-${issue.slice(0, 6)}`, description: "Badge snag", status: "open" });

    for (const [t, id] of [["document", drawing], ["document", safety], ["permit", permitLive], ["permit", permitArchived], ["photo", issue]] as const) {
      expect((await share(t, id)).status).toBe(201);
    }
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    const ids = [drawing, safety, permitLive, permitArchived, issue].filter(Boolean);
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(portalItemViewsTable).where(inArray(portalItemViewsTable.itemId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.delete(permitsTable).where(inArray(permitsTable.id, [permitLive, permitArchived]));
    await db.delete(photosTable).where(eq(photosTable.id, issue));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments([drawing, safety]);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("badge = unseen items in the list; archived permit in neither, safety doc once", async () => {
    const [unseen, list] = await Promise.all([api("/portal/unseen", { token: portal }), api("/portal/shared", { token: portal })]);
    expect(list.status).toBe(200);
    const items = [...list.json.documents, ...list.json.photos, ...list.json.permits, ...list.json.dailyReports];
    const unseenInList = items.filter((i: any) => i.unseen).length;
    expect(unseen.json.counts.shared).toBe(unseenInList);
    expect(list.json.permits.map((p: any) => p.id)).toEqual([permitLive]);
    expect(list.json.documents.filter((d: any) => d.id === safety)).toHaveLength(1);
    // drawing + safety + live permit + issue
    expect(unseen.json.counts.shared).toBe(4);
  });

  it("a shared site issue arrives with its id and description", async () => {
    const list = await api("/portal/shared", { token: portal });
    expect(list.json.photos).toHaveLength(1);
    expect(list.json.photos[0]).toMatchObject({ id: issue, description: "Badge snag", category: "snag" });
  });
});
