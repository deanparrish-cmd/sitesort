import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, documentsTable, acknowledgmentAuditTable } from "@workspace/db/schema";
import {
  API_BASE, seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, type Fixture, type PortalMemberFixture, reachEnd } from "./helpers";

/**
 * Dean, 2026-10-24: if you signed it, you can always open what you signed.
 * Any document a person has signed (PIN) or acknowledged (no PIN) stays
 * visible to them in the portal, read-only, even once it is superseded or the
 * share rule that reached them is deleted. Someone who never signed it gets
 * nothing new.
 */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describe("signed documents stay visible to whoever signed them", () => {
  let co: Fixture;
  let admin = "";
  let signer: PortalMemberFixture;
  let other: PortalMemberFixture;
  let signerToken = "";
  let otherToken = "";
  let fileUrl = "";
  const ids: string[] = [];

  const upload = async (body: Record<string, unknown>) => {
    const res = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `Doc ${randomUUID().slice(0, 6)}`, fileUrl, fileSize: PDF.length, ...body },
    });
    expect(res.status).toBe(201);
    ids.push(res.json.id);
    return res.json as { id: string; name: string };
  };
  const shareAll = async (id: string) => {
    expect((await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: id, audiences: [{ type: "all" }] } })).status).toBe(201);
  };
  const deleteRules = async (id: string) => {
    const rules = await db.select().from(portalSharesTable).where(eq(portalSharesTable.itemId, id));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect((await api(`/projects/${co.projectId}/portal-shares/${r.id}`, { method: "DELETE", token: admin })).status).toBe(200);
  };
  const sign = async (token: string, id: string, pin?: string) => {
    expect((await api(`/portal/documents/${id}/view`, { method: "POST", token })).status).toBe(200);
    expect(await reachEnd(token, id)).toBe(200);
    expect((await api(`/portal/documents/${id}/acknowledge`, { method: "POST", token, body: pin ? { pin } : {} })).status).toBe(200);
  };
  const shared = async (token: string) => (await api("/portal/shared", { token })).json.documents as any[];
  const download = (token: string, id: string) =>
    fetch(`${API_BASE}/portal/documents/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }).then(async r => { await r.arrayBuffer(); return r.status; });
  const view = async (token: string, id: string) => (await api(`/portal/documents/${id}/view`, { method: "POST", token })).status;

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    signer = await seedCrossTenantPortalMember([co], [admin]);
    other = await seedCrossTenantPortalMember([co], [admin]);
    signerToken = (await portalLogin(signer.email, signer.password)).token;
    otherToken = (await portalLogin(other.email, other.password)).token;
    const fd = new FormData();
    fd.append("file", new Blob([PDF], { type: "application/pdf" }), "signed.pdf");
    const up = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${admin}` } });
    expect(up.status).toBe(200);
    fileUrl = ((await up.json()).url as string).replace(/\?.*$/, "");
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, signer.userId, other.userId]));
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.userId, [signer.userId, other.userId]));
    await db.update(documentsTable).set({ previousVersionId: null }).where(inArray(documentsTable.id, ids));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember(signer, [co.projectId]);
    await cleanupPortalMember(other, []);
    await cleanupFixtures([co]);
  });

  let safetyV1 = "";
  let drawing = "";

  it("a signed safety document, once superseded, is still listed, opens and downloads for the signer; sign-off is refused", async () => {
    const v1 = await upload({ type: "safety", name: `Site rules ${randomUUID().slice(0, 6)}` });
    safetyV1 = v1.id;
    await sign(signerToken, v1.id, signer.pin);
    const v2 = await upload({ type: "safety", name: v1.name, supersededDocumentId: v1.id });
    expect((await db.select().from(documentsTable).where(eq(documentsTable.id, v1.id)))[0].status).toBe("superseded");

    const row = (await shared(signerToken)).find(d => d.id === v1.id);
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ status: "superseded", myStatus: "acknowledged", mySignedOffWithPin: true, unseen: false });
    expect((await shared(signerToken)).some(d => d.id === v2.id)).toBe(true);
    expect(((await api("/portal/safety", { token: signerToken })).json as any[]).some(d => d.id === v1.id)).toBe(true);
    expect(await view(signerToken, v1.id)).toBe(200);
    expect(await download(signerToken, v1.id)).toBe(200);
    const again = await api(`/portal/documents/${v1.id}/acknowledge`, { method: "POST", token: signerToken, body: { pin: signer.pin } });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("superseded");
  });

  it("a signed drawing whose share rule is deleted is still listed and opens for the signer", async () => {
    const d = await upload({ type: "drawing" });
    drawing = d.id;
    await shareAll(d.id);
    await sign(signerToken, d.id, signer.pin);
    await deleteRules(d.id);

    const row = (await shared(signerToken)).find(x => x.id === d.id);
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ status: "current", myStatus: "acknowledged", mySignedOffWithPin: true, unseen: false });
    expect(((await api("/portal/drawings", { token: signerToken })).json as any[]).some(x => x.id === d.id)).toBe(true);
    expect((await api(`/portal/drawings/${d.id}`, { token: signerToken })).status).toBe(200);
    expect(await view(signerToken, d.id)).toBe(200);
    expect(await download(signerToken, d.id)).toBe(200);
  });

  it("a member who never signed sees neither the superseded safety document nor the unshared drawing", async () => {
    expect(safetyV1 && drawing).toBeTruthy();
    const list = await shared(otherToken);
    expect(list.some(x => x.id === safetyV1)).toBe(false);
    expect(list.some(x => x.id === drawing)).toBe(false);
    expect(((await api("/portal/safety", { token: otherToken })).json as any[]).some(x => x.id === safetyV1)).toBe(false);
    expect(((await api("/portal/drawings", { token: otherToken })).json as any[]).some(x => x.id === drawing)).toBe(false);
    expect((await api(`/portal/drawings/${drawing}`, { token: otherToken })).status).toBe(404);
    expect(await view(otherToken, drawing)).toBe(404);
    expect(await download(otherToken, drawing)).toBe(404);
  });

  it("acknowledged without a PIN counts the same as signed with a PIN", async () => {
    const d = await upload({ type: "general", requiresAcknowledgment: true });
    await shareAll(d.id);
    await sign(signerToken, d.id);
    const [dist] = await db.select().from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, d.id), eq(documentDistributionsTable.userId, signer.userId)));
    expect(dist).toMatchObject({ status: "acknowledged", signedOffWithPin: false });
    await deleteRules(d.id);

    const row = (await shared(signerToken)).find(x => x.id === d.id);
    expect(row).toMatchObject({ myStatus: "acknowledged", mySignedOffWithPin: false, unseen: false });
    expect(((await api("/portal/general", { token: signerToken })).json.documents as any[] ?? []).some(x => x.id === d.id)).toBe(true);
    expect(await view(signerToken, d.id)).toBe(200);
    expect(await download(signerToken, d.id)).toBe(200);
    expect((await shared(otherToken)).some(x => x.id === d.id)).toBe(false);
  });
});
