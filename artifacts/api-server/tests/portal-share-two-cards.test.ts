import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, usersTable, activityLogTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * One person, two cards on the same project (Dean, 2026-10-16): only the card
 * with a portal login sees shares. The share dialog must say which card is on
 * the portal, a share to the other card must report that it reached nobody,
 * and an "Everyone" share reaches the person whichever card exists.
 */
describe("same name, two cards: share dialog tells them apart", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  let docId = "";
  let onPortalCard = "";
  let noPortalCard = "";
  let invitedCard = "";

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    onPortalCard = member.personIds[0];
    portal = (await portalLogin(member.email, member.password)).token;
    // Same name, different email, never invited: like the mong.com card.
    const twin = await api(`/projects/${co.projectId}/in-house-people`, { method: "POST", token: admin, body: { firstName: "Cross", lastName: "Tenant0", email: `twin-${Date.now()}@sitesort-tests.local` } });
    noPortalCard = twin.json.id;
    // On the project's team, never invited (Team tab "Invite to Portal").
    const added = await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId: noPortalCard, role: "subcontractor" } });
    expect([200, 201]).toContain(added.status);
    const inv = await api(`/projects/${co.projectId}/in-house-people`, { method: "POST", token: admin, body: { firstName: "Invited", lastName: "Only", email: `inv-${Date.now()}@sitesort-tests.local` } });
    invitedCard = inv.json.id;
    await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId: invitedCard, role: "worker" } });
    expect((await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: invitedCard, role: "worker" } })).status).toBe(201);
    docId = await createTestDocument(co.projectId, admin, { name: "Twin Plan", type: "drawing" });
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

  it("audience marks which card is on the portal", async () => {
    const { status, json } = await api(`/projects/${co.projectId}/portal-audience`, { token: admin });
    expect(status).toBe(200);
    const by = new Map(json.members.map((m: any) => [m.personId, m.portalStatus]));
    expect(by.get(onPortalCard)).toBe("member");
    expect(by.get(noPortalCard)).toBe("none");
    expect(by.get(invitedCard)).toBe("invited");
  });

  it("a share to the card with no portal access reaches nobody, and says so", async () => {
    const share = await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: docId, audiences: [{ type: "person", personId: noPortalCard }] } });
    expect(share.status).toBe(201);
    expect(share.json.recipientCount).toBe(0);
    const shared = await api("/portal/shared", { token: portal });
    expect(shared.json.documents.map((d: any) => d.id)).not.toContain(docId);
    const rules = await api(`/projects/${co.projectId}/portal-shares?itemType=document&itemId=${docId}`, { token: admin });
    const rule = rules.json.find((r: any) => r.personId === noPortalCard);
    expect(rule.portalStatus).toBe("none");
    expect(rule.personName).toBe("Cross Tenant0");
  });

  it("an Everyone share reaches the person whichever card was picked before", async () => {
    const share = await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: docId, audiences: [{ type: "all" }] } });
    expect(share.status).toBe(201);
    expect(share.json.recipientCount).toBeGreaterThanOrEqual(1);
    const shared = await api("/portal/shared", { token: portal });
    expect(shared.json.documents.map((d: any) => d.id)).toContain(docId);
  });

  it("admin trace runs the real code: drawing is in the member's response", async () => {
    await db.update(usersTable).set({ platformAdmin: true }).where(eq(usersTable.id, co.userId));
    try {
      const q = `email=${encodeURIComponent(member.email)}&projectId=${co.projectId}&itemId=${docId}`;
      const { status, json } = await api(`/admin/portal-trace?${q}`, { token: admin });
      expect(status).toBe(200);
      expect(json.step1_memberships.passesPortalGuard).toBe(true);
      expect(json.step2_resolveViewer.personId).toBe(onPortalCard);
      expect(json.step3_rules.some((r: any) => r.audienceType === "all" && r.matches)).toBe(true);
      expect(json.step4_visibleShareMap.includesItem).toBe(true);
      expect(json.step5_fullResponse.inResponse).toBe(true);
      expect(json.error).toBeNull();
    } finally {
      await db.update(usersTable).set({ platformAdmin: false }).where(eq(usersTable.id, co.userId));
    }
  });

  it("admin trace is platform admins only", async () => {
    const { status } = await api(`/admin/portal-trace?email=x@y.z&projectId=${co.projectId}&itemId=${docId}`, { token: admin });
    expect(status).toBe(403);
  });

  it("the portal activity log records the status each view got", async () => {
    await api("/portal/shared", { token: portal });
    await new Promise(r => setTimeout(r, 300));
    const row = (await db.select().from(activityLogTable)
      .where(and(eq(activityLogTable.userId, member.userId), eq(activityLogTable.section, "shared")))
      .orderBy(desc(activityLogTable.createdAt)).limit(1))[0];
    expect(JSON.parse(row.metadata ?? "{}").status).toBe(200);
  });
});
