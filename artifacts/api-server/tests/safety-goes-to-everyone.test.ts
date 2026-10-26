import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, documentsTable, acknowledgmentAuditTable, pushSubscriptionsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, reachEnd, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Dean, 2026-10-26. A current safety document goes to every member of the
 * project (#65), so:
 * - every member owes a signature on it: "waiting for sign-off" must match who
 *   can open it. Before, only people with a distribution row (picked in Share,
 *   or who had opened it) counted, so a safety document read as more complete
 *   than it was (the close-out bug, in the one place it matters most);
 * - a share rule on it would be a choice that controls nothing: the API
 *   refuses it, as the screen no longer offers it;
 * - the one email choice left is "Also email all N".
 */
describe("a current safety document goes to everyone: the count, the share refusal, email all", () => {
  let co: Fixture;
  let admin = "";
  let a: PortalMemberFixture;
  let b: PortalMemberFixture;
  let aToken = "";
  let doc = "";
  const ids: string[] = [];

  const upload = async (body: Record<string, unknown>) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `Site rules ${randomUUID().slice(0, 6)}`, type: "safety", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, ...body },
    });
    expect(res.status).toBe(201);
    ids.push(res.json.id);
    return res.json;
  };
  const waitingFor = async (id: string) => ((await api("/compliance", { token: admin })).json.pendingAcknowledgments as any[]).find(x => x.documentId === id);
  const share = (id: string, audiences: unknown[]) =>
    api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: id, audiences } });

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    a = await seedCrossTenantPortalMember([co], [admin]);
    b = await seedCrossTenantPortalMember([co], [admin]);
    aToken = (await portalLogin(a.email, a.password)).token;
    doc = (await upload({})).id;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, a.userId, b.userId]));
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.userId, [a.userId, b.userId]));
    await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.userId, [a.userId, b.userId]));
    await db.update(documentsTable).set({ previousVersionId: null }).where(inArray(documentsTable.id, ids));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(a, [co.projectId]);
    await cleanupPortalMember(b, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("every member owes a signature on a current safety document, opened or not, everywhere it is counted", async () => {
    // Nobody picked, nobody opened: both members still owe it.
    expect(await waitingFor(doc)).toMatchObject({ pendingCount: 2 });
    expect((await waitingFor(doc)).recipients.map((r: any) => r.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect((await api(`/projects/${co.projectId}`, { token: admin })).json.alertCount).toBe(2);
    expect((await api(`/projects/${co.projectId}/closeout`, { token: admin })).json.checks.signOffs).toMatchObject({ pendingCount: 2, ok: false });
    const row = ((await api(`/projects/${co.projectId}/documents`, { token: admin })).json as any[]).find(d => d.id === doc);
    expect(row.distributionSummary).toMatchObject({ total: 2, pending: 2, acknowledged: 0 });

    // A signs: one left, B, who never opened it.
    expect((await api(`/portal/documents/${doc}/view`, { method: "POST", token: aToken })).status).toBe(200);
    expect(await reachEnd(aToken, doc)).toBe(200);
    expect((await api(`/portal/documents/${doc}/acknowledge`, { method: "POST", token: aToken, body: { pin: a.pin } })).status).toBe(200);
    const after = await waitingFor(doc);
    expect(after).toMatchObject({ pendingCount: 1 });
    expect(after.recipients.filter((r: any) => r.status !== "acknowledged").map((r: any) => r.userId)).toEqual([b.userId]);
    expect((await api(`/projects/${co.projectId}`, { token: admin })).json.alertCount).toBe(1);
    expect((await api(`/projects/${co.projectId}/closeout`, { token: admin })).json.checks.signOffs).toMatchObject({ pendingCount: 1 });
  });

  it("a share rule posted straight to the API on a current safety document is refused and nothing is stored", async () => {
    for (const audiences of [[{ type: "person", personId: a.personIds[0] }], [{ type: "all" }], [{ type: "trade", trade: "Site Staff" }]]) {
      const res = await share(doc, audiences);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("safety_goes_to_everyone");
      expect(res.json.message).toBe("Safety documents go to everyone on this project. You can't choose who gets a safety document, so nobody can be left out by mistake.");
    }
    expect(await db.select().from(portalSharesTable).where(eq(portalSharesTable.itemId, doc))).toHaveLength(0);
  });

  it("a superseded safety document still takes share rules (they decide who sees it, #174)", async () => {
    const v1 = await upload({});
    await upload({ name: v1.name, supersededDocumentId: v1.id });
    expect((await share(v1.id, [{ type: "person", personId: a.personIds[0] }])).status).toBe(201);
  });

  it("says who it reaches, and Also email all N reaches every member", async () => {
    const aud = await api(`/projects/${co.projectId}/safety-audience?documentId=${doc}`, { token: admin });
    expect(aud.status).toBe(200);
    expect(aud.json).toMatchObject({ members: 2, openToEveryone: true, alertsOn: 0 });
    // Phone alerts are counted as they stand now: one member with a phone
    // registered for this project (two phones still count once).
    for (const n of [1, 2]) {
      await db.insert(pushSubscriptionsTable).values({ id: randomUUID(), userId: a.userId, projectId: co.projectId, endpoint: `https://push.example.test/${randomUUID()}-${n}`, p256dh: "k", auth: "a" });
    }
    expect((await api(`/projects/${co.projectId}/safety-audience`, { token: admin })).json).toMatchObject({ members: 2, alertsOn: 1 });
    const email = await api(`/projects/${co.projectId}/documents/${doc}/email-everyone`, { method: "POST", token: admin });
    expect(email.status).toBe(200);
    expect(email.json.recipientCount).toBe(2);
    // From the upload dialog's tick box.
    const up = await upload({ emailEveryone: true });
    expect(up.safetyEmail).toMatchObject({ recipientCount: 2 });
    // Not for anything that is gated.
    const general = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name: "G", type: "general", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 1 } });
    ids.push(general.json.id);
    expect((await api(`/projects/${co.projectId}/documents/${general.json.id}/email-everyone`, { method: "POST", token: admin })).status).toBe(409);
    expect((await api(`/projects/${co.projectId}/safety-audience?documentId=${general.json.id}`, { token: admin })).json.openToEveryone).toBe(false);
    // A portal member can't call either.
    expect((await api(`/projects/${co.projectId}/documents/${doc}/email-everyone`, { method: "POST", token: aToken })).status).toBeGreaterThanOrEqual(401);
  });
});
