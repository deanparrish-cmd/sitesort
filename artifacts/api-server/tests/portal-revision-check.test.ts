import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * #133: a phone whose list is out of date asks the server whether a drawing
 * it shows has a newer revision. Only for documents the member can see.
 */
describe("portal revision check", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  let revA = "";
  let revB = "";
  let hidden = "";

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    portal = (await portalLogin(member.email, member.password)).token;
    revA = await createTestDocument(co.projectId, admin, { name: "GF Plan", type: "drawing" });
    hidden = await createTestDocument(co.projectId, admin, { name: "Not Shared", type: "drawing" });
    expect((await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: revA, audiences: [{ type: "all" }] } })).status).toBe(201);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    const ids = [revA, revB, hidden].filter(Boolean);
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  const check = (ids: string[]) => api("/portal/documents/revision-check", { method: "POST", token: portal, body: { ids } });

  it("a current drawing is reported current; an unshared one is not revealed", async () => {
    const { status, json } = await check([revA, hidden]);
    expect(status).toBe(200);
    expect(json.documents).toEqual([{ id: revA, status: "current", latest: null }]);
  });

  it("after a new revision, the old one points at it, and says whether it's shared", async () => {
    const shown = ((await api(`/projects/${co.projectId}/portal-shares?itemType=document&itemId=${revA}`, { token: admin })).json as { id: string }[]).map(r => r.id);
    const up = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      // carryShareIds: [] = shared with nobody, so "not shared with you" can be
      // checked. The list the uploader saw must go too (2026-10-21).
      body: { name: "GF Plan", type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, supersededDocumentId: revA, revision: "C", carryShareIds: [], carryShownShareIds: shown },
    });
    expect(up.status).toBe(201);
    revB = up.json.id;
    const before = await check([revA]);
    expect(before.json.documents[0]).toMatchObject({ id: revA, status: "superseded", latest: { id: revB, name: "GF Plan", revision: "C", sharedWithYou: false } });

    await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: revB, audiences: [{ type: "all" }] } });
    const after = await check([revA]);
    expect(after.json.documents[0].latest.sharedWithYou).toBe(true);
  });

  it("needs a portal session", async () => {
    expect((await api("/portal/documents/revision-check", { method: "POST", body: { ids: [revA] } })).status).toBe(401);
  });
});
