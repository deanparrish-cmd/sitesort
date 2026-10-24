import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, documentsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import {
  API_BASE, seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Dean, 2026-10-24, option (a). Safety documents deliberately skip the share
 * check while CURRENT (#65: safety-critical content must never be hidden by
 * a missed share). Once superseded, a safety document opens only for someone
 * who signed it (#173) or whom a share rule reaches, like every other type.
 * Before this, anyone on the project could open or download a superseded one
 * by id.
 */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describe("superseded safety documents obey the share check; current ones stay open", () => {
  let co: Fixture;
  let admin = "";
  let reached: PortalMemberFixture; // a share rule names them on v1
  let nobody: PortalMemberFixture;  // never shared, never signed
  let reachedToken = "";
  let nobodyToken = "";
  let v1 = "";
  let v2 = "";
  const ids: string[] = [];

  const download = (token: string, id: string) =>
    fetch(`${API_BASE}/portal/documents/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }).then(async r => { await r.arrayBuffer(); return r.status; });
  const view = async (token: string, id: string) => (await api(`/portal/documents/${id}/view`, { method: "POST", token })).status;
  const inList = async (token: string, path: string, id: string, pick: (j: any) => any[] = j => j) =>
    pick((await api(path, { token })).json).some((d: any) => d.id === id);

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    reached = await seedCrossTenantPortalMember([co], [admin]);
    nobody = await seedCrossTenantPortalMember([co], [admin]);
    reachedToken = (await portalLogin(reached.email, reached.password)).token;
    nobodyToken = (await portalLogin(nobody.email, nobody.password)).token;
    const fd = new FormData();
    fd.append("file", new Blob([PDF], { type: "application/pdf" }), "site-rules.pdf");
    const up = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${admin}` } });
    expect(up.status).toBe(200);
    const fileUrl = ((await up.json()).url as string).replace(/\?.*$/, "");
    const upload = async (body: Record<string, unknown>) => {
      const res = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { fileUrl, fileSize: PDF.length, type: "safety", ...body } });
      expect(res.status).toBe(201);
      ids.push(res.json.id);
      return res.json.id as string;
    };
    const name = `Site rules ${randomUUID().slice(0, 6)}`;
    v1 = await upload({ name });
    expect((await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: v1, audiences: [{ type: "person", personId: reached.personIds[0] }] } })).status).toBe(201);
    v2 = await upload({ name, supersededDocumentId: v1 });
    expect((await db.select().from(documentsTable).where(eq(documentsTable.id, v1)))[0].status).toBe("superseded");
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, reached.userId, nobody.userId]));
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.userId, [reached.userId, nobody.userId]));
    await db.update(documentsTable).set({ previousVersionId: null }).where(inArray(documentsTable.id, ids));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(reached, [co.projectId]);
    await cleanupPortalMember(nobody, []);
    await cleanupFixtures([co]);
  });

  it("a member nobody shared it with and who never signed cannot open, download or ask about a superseded safety document", async () => {
    expect(await view(nobodyToken, v1)).toBe(404);
    expect(await download(nobodyToken, v1)).toBe(404);
    const ack = await api(`/portal/documents/${v1}/acknowledge`, { method: "POST", token: nobodyToken, body: { pin: nobody.pin } });
    expect(ack.status).toBe(404);
    const check = await api("/portal/documents/revision-check", { method: "POST", token: nobodyToken, body: { ids: [v1] } });
    expect(check.json.documents).toEqual([]);
    expect(await inList(nobodyToken, "/portal/shared", v1, j => j.documents)).toBe(false);
    expect(await inList(nobodyToken, "/portal/safety", v1)).toBe(false);
    expect(await inList(nobodyToken, "/portal/hs", v1, j => j.safety)).toBe(false);
  });

  it("a member a share rule reaches can still list, open and download the superseded safety document", async () => {
    expect(await inList(reachedToken, "/portal/shared", v1, j => j.documents)).toBe(true);
    expect(await inList(reachedToken, "/portal/safety", v1)).toBe(true);
    expect(await inList(reachedToken, "/portal/hs", v1, j => j.safety)).toBe(true);
    expect(await view(reachedToken, v1)).toBe(200);
    expect(await download(reachedToken, v1)).toBe(200);
    const check = await api("/portal/documents/revision-check", { method: "POST", token: reachedToken, body: { ids: [v1] } });
    expect(check.json.documents).toMatchObject([{ id: v1, status: "superseded", latest: { id: v2, sharedWithYou: true } }]);
  });

  it("a current safety document stays open to every member of the project, with no share rule (deliberate, #65)", async () => {
    expect(await db.select().from(portalSharesTable).where(eq(portalSharesTable.itemId, v2))).toHaveLength(0);
    for (const token of [nobodyToken, reachedToken]) {
      expect(await inList(token, "/portal/shared", v2, j => j.documents)).toBe(true);
      expect(await inList(token, "/portal/safety", v2)).toBe(true);
      expect(await view(token, v2)).toBe(200);
      expect(await download(token, v2)).toBe(200);
    }
  });
});
