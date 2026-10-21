import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, documentsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * 2026-10-21 (Dean): a new revision reaches the people the old one was
 * shared with. Chosen in Supersedes = carried by default (narrowable).
 * Replaced only because the name matched = NEVER carried silently: only the
 * rules the uploader confirmed. Sign-off requirement is inherited.
 */
describe("revision carry-forward", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  const docIds: string[] = [];

  const upload = async (body: Record<string, unknown>) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, ...body },
    });
    expect(res.status).toBe(201);
    docIds.push(res.json.id);
    return res.json;
  };
  const share = (itemId: string, audiences: unknown[]) => api(`/projects/${co.projectId}/portal-shares`, {
    method: "POST", token: admin, body: { itemType: "document", itemId, audiences },
  });
  const rulesOf = async (itemId: string) =>
    (await api(`/projects/${co.projectId}/portal-shares?itemType=document&itemId=${itemId}`, { token: admin })).json as { id: string; audienceType: string; personId?: string }[];
  // Rev B shared with Everyone and with the member by name.
  const sharedRevB = async (name: string, extra: Record<string, unknown> = {}) => {
    const b = await upload({ name, revision: "B", ...extra });
    expect((await share(b.id, [{ type: "all" }, { type: "person", personId: member.personIds[0] }])).status).toBe(201);
    return b;
  };
  const sharedIds = async () => ((await api("/portal/shared", { token: portal })).json.documents as { id: string }[]).map(d => d.id);

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, docIds));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docIds));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(docIds);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("chosen in Supersedes: every rule carries, the member is alerted and sees Rev C", async () => {
    const name = `GA Plan ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const c = await upload({ name, supersededDocumentId: b.id, revision: "C" });
    expect(c.portalCarryForward).toEqual({ previousRules: 2, carried: 2, recipientCount: 1 });
    expect((await rulesOf(c.id)).map(r => r.audienceType).sort()).toEqual(["all", "person"]);
    const dist = await db.select().from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, c.id), eq(documentDistributionsTable.userId, member.userId)));
    expect(dist[0]?.status).toBe("pending");
    const note = await db.select().from(notificationsTable)
      .where(and(eq(notificationsTable.userId, member.userId), eq(notificationsTable.relatedEntityId, c.id)));
    expect(note[0]?.title).toBe(`New revision: ${name} Rev C`);
    expect(await sharedIds()).toContain(c.id);
  });

  it("chosen in Supersedes with a narrowed list: only the ticked rules carry", async () => {
    const name = `Section ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const personRule = (await rulesOf(b.id)).find(r => r.audienceType === "person")!;
    const c = await upload({ name, supersededDocumentId: b.id, revision: "C", carryShareIds: [personRule.id] });
    expect(c.portalCarryForward).toMatchObject({ previousRules: 2, carried: 1 });
    expect((await rulesOf(c.id)).map(r => r.audienceType)).toEqual(["person"]);
  });

  it("replaced only because the name matched: nothing carries, and the list flags it", async () => {
    const name = `Roof Plan ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const c = await upload({ name, revision: "C" });
    expect(c.previousVersionId).toBe(b.id);
    expect(c.portalCarryForward).toEqual({ previousRules: 2, carried: 0, recipientCount: 0, notCarriedReason: "name_match" });
    expect(await rulesOf(c.id)).toEqual([]);
    expect(await sharedIds()).not.toContain(c.id);
    const list = (await api(`/projects/${co.projectId}/documents`, { token: admin })).json as { id: string; newRevisionNotShared?: boolean }[];
    expect(list.find(d => d.id === c.id)?.newRevisionNotShared).toBe(true);
    expect(list.find(d => d.id === b.id)?.newRevisionNotShared).toBe(false);
  });

  it("name match with the list confirmed: the confirmed rules carry; a rule from another document is ignored", async () => {
    const name = `Elevations ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const other = await sharedRevB(`Other ${randomUUID().slice(0, 6)}`);
    const foreign = (await rulesOf(other.id))[0].id;
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const c = await upload({ name, revision: "C", carryShareIds: [...ids, foreign] });
    expect(c.portalCarryForward).toEqual({ previousRules: 2, carried: 2, recipientCount: 1 });
    expect(await rulesOf(c.id)).toHaveLength(2);
    const list = (await api(`/projects/${co.projectId}/documents`, { token: admin })).json as { id: string; newRevisionNotShared?: boolean }[];
    expect(list.find(d => d.id === c.id)?.newRevisionNotShared).toBe(false);
  });

  it("the new revision keeps the sign-off requirement of the one it replaces", async () => {
    const name = `RAMS ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name, { type: "method_statement", requiresAcknowledgment: true, requirePinSignoff: true });
    const c = await upload({ name, type: "method_statement", supersededDocumentId: b.id, requiresAcknowledgment: false, requirePinSignoff: false });
    expect(c.requiresAcknowledgment).toBe(true);
    expect(c.requirePinSignoff).toBe(true);
    const row = (await db.select().from(documentsTable).where(eq(documentsTable.id, c.id)))[0];
    expect(row.requiresAcknowledgment).toBe(true);
  });

  it("a first upload with no earlier revision carries nothing and says nothing", async () => {
    const a = await upload({ name: `New ${randomUUID().slice(0, 6)}` });
    expect(a.portalCarryForward).toBeNull();
  });
});
