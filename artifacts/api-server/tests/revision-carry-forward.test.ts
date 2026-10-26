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
 * shared with, and is never decided silently: replacing a shared revision
 * (chosen in Supersedes OR same name) needs an explicit answer about the list
 * the uploader saw, or the upload is refused with nothing written. A stale
 * dashboard tab once uploaded a same-name revision without asking and it
 * reached nobody. Sign-off requirement is inherited.
 */
describe("revision carry-forward", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  const docIds: string[] = [];

  const uploadRaw = async (body: Record<string, unknown>) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, ...body },
    });
    if (res.status === 201) docIds.push(res.json.id);
    return res;
  };
  const upload = async (body: Record<string, unknown>) => {
    const res = await uploadRaw(body);
    expect(res.status).toBe(201);
    return res.json;
  };
  const statusOf = async (id: string) => (await db.select().from(documentsTable).where(eq(documentsTable.id, id)))[0].status;
  const countNamed = async (name: string) => (await db.select().from(documentsTable).where(and(eq(documentsTable.projectId, co.projectId), eq(documentsTable.name, name)))).length;
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
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const c = await upload({ name, supersededDocumentId: b.id, revision: "C", carryShareIds: ids, carryShownShareIds: ids });
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
    const rules = await rulesOf(b.id);
    const personRule = rules.find(r => r.audienceType === "person")!;
    const c = await upload({ name, supersededDocumentId: b.id, revision: "C", carryShareIds: [personRule.id], carryShownShareIds: rules.map(r => r.id) });
    expect(c.portalCarryForward).toMatchObject({ previousRules: 2, carried: 1 });
    expect((await rulesOf(c.id)).map(r => r.audienceType)).toEqual(["person"]);
  });

  it("same name, uploader answered No: nothing carries, and the list flags it", async () => {
    const name = `Roof Plan ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const c = await upload({ name, revision: "C", carryShareIds: [], carryShownShareIds: ids });
    expect(c.previousVersionId).toBe(b.id);
    expect(c.portalCarryForward).toEqual({ previousRules: 2, carried: 0, recipientCount: 0, notCarriedReason: "declined" });
    expect(await rulesOf(c.id)).toEqual([]);
    expect(await sharedIds()).not.toContain(c.id);
    const list = (await api(`/projects/${co.projectId}/documents`, { token: admin })).json as { id: string; newRevisionNotShared?: boolean }[];
    expect(list.find(d => d.id === c.id)?.newRevisionNotShared).toBe(true);
    expect(list.find(d => d.id === b.id)?.newRevisionNotShared).toBe(false);
  });

  it("same name, shared revision, no answer: refused, nothing written, v1 still current", async () => {
    const name = `Stale tab ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const res = await uploadRaw({ name, revision: "C" });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("share_answer_required");
    expect(res.json.message).toMatch(/Reload the page and upload again/);
    expect(await statusOf(b.id)).toBe("current");
    expect(await countNamed(name)).toBe(1);
  });

  it("chosen in Supersedes, shared revision, no answer: refused too, v1 still current", async () => {
    const name = `Chosen stale ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const res = await uploadRaw({ name: `${name} new`, supersededDocumentId: b.id });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("share_answer_required");
    expect(await statusOf(b.id)).toBe("current");
    expect(await countNamed(`${name} new`)).toBe(0);
  });

  it("an answer without the list the uploader saw is refused", async () => {
    const name = `No shown ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const res = await uploadRaw({ name, carryShareIds: ids });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("share_answer_required");
    expect(await statusOf(b.id)).toBe("current");
  });

  it("shares changed since the dialog loaded: refused, v1 still current", async () => {
    const name = `Changed ${randomUUID().slice(0, 6)}`;
    const b = await upload({ name, revision: "B" });
    expect((await share(b.id, [{ type: "all" }])).status).toBe(201);
    const seen = (await rulesOf(b.id)).map(r => r.id);
    // Someone shares it with the member by name while the dialog is open.
    expect((await share(b.id, [{ type: "person", personId: member.personIds[0] }])).status).toBe(201);
    const res = await uploadRaw({ name, carryShareIds: seen, carryShownShareIds: seen });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("share_list_changed");
    expect(await statusOf(b.id)).toBe("current");
    // The dialog showed no shares, someone shared it meanwhile: also refused.
    const name2 = `Changed empty ${randomUUID().slice(0, 6)}`;
    const b2 = await upload({ name: name2, revision: "B" });
    expect((await share(b2.id, [{ type: "all" }])).status).toBe(201);
    const res2 = await uploadRaw({ name: name2, carryShareIds: [], carryShownShareIds: [] });
    expect(res2.status).toBe(409);
    expect(res2.json.error).toBe("share_list_changed");
    expect(await statusOf(b2.id)).toBe("current");
  });

  it("same name, revision shared with nobody: replaced as before, no answer needed", async () => {
    const name = `Unshared ${randomUUID().slice(0, 6)}`;
    const b = await upload({ name, revision: "B" });
    const c = await upload({ name, revision: "C" });
    expect(c.previousVersionId).toBe(b.id);
    expect(c.portalCarryForward).toBeNull();
    expect(await statusOf(b.id)).toBe("superseded");
  });

  it("safety documents need no answer (every member sees them)", async () => {
    const name = `Safety ${randomUUID().slice(0, 6)}`;
    const b = await upload({ name, type: "safety" });
    // The API refuses new rules on a current safety document (2026-10-26),
    // but rules from before that still exist on prod: one stands in for them.
    expect((await share(b.id, [{ type: "all" }])).status).toBe(409);
    await db.insert(portalSharesTable).values({ id: randomUUID(), projectId: co.projectId, itemType: "document", itemId: b.id, audienceType: "all", sharedByUserId: co.userId });
    const c = await upload({ name, type: "safety" });
    expect(c.previousVersionId).toBe(b.id);
  });

  it("name match with the list confirmed: the confirmed rules carry; a rule from another document is ignored", async () => {
    const name = `Elevations ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name);
    const other = await sharedRevB(`Other ${randomUUID().slice(0, 6)}`);
    const foreign = (await rulesOf(other.id))[0].id;
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const c = await upload({ name, revision: "C", carryShareIds: [...ids, foreign], carryShownShareIds: ids });
    expect(c.portalCarryForward).toEqual({ previousRules: 2, carried: 2, recipientCount: 1 });
    expect(await rulesOf(c.id)).toHaveLength(2);
    const list = (await api(`/projects/${co.projectId}/documents`, { token: admin })).json as { id: string; newRevisionNotShared?: boolean }[];
    expect(list.find(d => d.id === c.id)?.newRevisionNotShared).toBe(false);
  });

  it("the new revision keeps the sign-off requirement of the one it replaces", async () => {
    // A drawing: RAMS/permits/safety always require sign-off anyway (#149),
    // so only another type shows the inheritance.
    const name = `Signed drawing ${randomUUID().slice(0, 6)}`;
    const b = await sharedRevB(name, { requiresAcknowledgment: true, requirePinSignoff: true });
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const c = await upload({ name, supersededDocumentId: b.id, requiresAcknowledgment: false, requirePinSignoff: false, carryShareIds: ids, carryShownShareIds: ids });
    expect(c.requiresAcknowledgment).toBe(true);
    expect(c.requirePinSignoff).toBe(true);
    const row = (await db.select().from(documentsTable).where(eq(documentsTable.id, c.id)))[0];
    expect(row.requiresAcknowledgment).toBe(true);
  });

  it("portal: a replaced revision says whether the newer one is shared with you, and sign-off says so too", async () => {
    const name = `Truth ${randomUUID().slice(0, 6)}`;
    const b = await upload({ name, revision: "B", requiresAcknowledgment: true });
    expect((await share(b.id, [{ type: "person", personId: member.personIds[0] }])).status).toBe(201);
    const ids = (await rulesOf(b.id)).map(r => r.id);
    const c = await upload({ name, revision: "C", carryShareIds: [], carryShownShareIds: ids });
    const detail = await api(`/portal/drawings/${b.id}`, { token: portal });
    expect(detail.status).toBe(200);
    expect(detail.json.supersededBy).toMatchObject({ id: c.id, sharedWithYou: false });
    const ack = await api(`/portal/documents/${b.id}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(ack.status).toBe(409);
    expect(ack.json.message).toMatch(/hasn't been shared with you yet/);
    expect(ack.json.message).not.toMatch(/Open the latest revision/);
    expect((await share(c.id, [{ type: "person", personId: member.personIds[0] }])).status).toBe(201);
    expect((await api(`/portal/drawings/${b.id}`, { token: portal })).json.supersededBy).toMatchObject({ id: c.id, sharedWithYou: true });
    const ack2 = await api(`/portal/documents/${b.id}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(ack2.status).toBe(409);
    expect(ack2.json.message).toMatch(/Open the latest revision/);
  });

  it("a first upload with no earlier revision carries nothing and says nothing", async () => {
    const a = await upload({ name: `New ${randomUUID().slice(0, 6)}` });
    expect(a.portalCarryForward).toBeNull();
  });
});
