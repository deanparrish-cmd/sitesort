import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  documentsTable, documentDistributionsTable, permitsTable, notificationsTable,
  shareLinksTable, shareAccessRequestsTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";
import { runShareLinkReminders } from "../src/lib/share-links";

/**
 * #127 Part B: drawings, project documents and permits go outside SiteSort
 * only through per-share links (/s/<token>): valid 30 days or until the item
 * is superseded, revocable, with a 3-day reminder to the sender, and an
 * access-request flow (sender or any approver decides; approval sends the
 * CURRENT revision). Bare file links are refused (login-only-files.test.ts).
 *
 * Writes files to the shared bucket but never deletes any (workspace rule).
 */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function upload(token: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([PDF], { type: "application/pdf" }), "drawing.pdf");
  const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return (await res.json()).url.replace(/\?.*$/, "");
}
const tokenOf = (url: string) => url.replace(/^\/s\//, "");
const landing = (url: string) => api(`/share/${tokenOf(url)}`);
const file = (url: string) => fetch(`${API_BASE}/share/${tokenOf(url)}/file`);
const requestAccess = (url: string, body: Record<string, string>) =>
  api(`/share/${tokenOf(url)}/request-access`, { method: "POST", body });

describe("per-share links for drawings, documents and permits", () => {
  let co: Fixture;
  let other: Fixture;
  let admin = "";
  let otherAdmin = "";
  let docId = "";
  let fileUrl = "";
  let linkUrl = "";
  let linkId = "";
  let newDocId = "";
  let requestId = "";

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    admin = await login(co.email);
    otherAdmin = await login(other.email);
    fileUrl = await upload(admin);
    const created = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `GA Plan ${randomUUID().slice(0, 6)}`, type: "drawing", fileUrl },
    });
    expect([200, 201]).toContain(created.status);
    docId = created.json.id;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    const users = [co.userId, other.userId];
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, users));
    await db.delete(shareAccessRequestsTable).where(inArray(shareAccessRequestsTable.projectId, [co.projectId, other.projectId]));
    await db.delete(shareLinksTable).where(inArray(shareLinksTable.projectId, [co.projectId, other.projectId]));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.userId, users));
    await db.delete(documentsTable).where(eq(documentsTable.projectId, co.projectId));
    await db.delete(permitsTable).where(eq(permitsTable.projectId, co.projectId));
    await cleanupFixtures([co, other]);
  });

  it("mints a link for the company's own document only", async () => {
    const res = await api("/share-links", { method: "POST", token: admin, body: { itemType: "document", itemId: docId } });
    expect(res.status).toBe(201);
    expect(res.json.url).toMatch(/^\/s\/[A-Za-z0-9_-]{30,}$/);
    linkUrl = res.json.url;
    linkId = res.json.id;
    const days = (new Date(res.json.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const cross = await api("/share-links", { method: "POST", token: otherAdmin, body: { itemType: "document", itemId: docId } });
    expect(cross.status).toBe(404);
    const photo = await api("/share-links", { method: "POST", token: admin, body: { itemType: "photo", itemId: docId } });
    expect(photo.status).toBe(400);
    const anon = await api("/share-links", { method: "POST", body: { itemType: "document", itemId: docId } });
    expect(anon.status).toBe(401);
  });

  it("the token is stored hashed, never as-is", async () => {
    const [row] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, linkId));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(tokenOf(linkUrl));
  });

  it("the landing page names the item and revision, and the file opens with no login", async () => {
    const l = await landing(linkUrl);
    expect(l.status).toBe(200);
    expect(l.json.state).toBe("ok");
    expect(l.json.item.name).toMatch(/^GA Plan /);
    expect(l.json.item.revisionLabel).toMatch(/^(Revision|Version) /);
    expect(l.json.canRequestAccess).toBe(false);
    expect(JSON.stringify(l.json)).not.toMatch(/\/uploads\//);
    const f = await file(linkUrl);
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toMatch(/pdf/);
    const [row] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, linkId));
    expect(row.openCount).toBe(1);
  });

  it("an unknown token is not found, and a working link can't be requested", async () => {
    expect((await landing("/s/" + "x".repeat(32))).status).toBe(404);
    expect((await file("/s/" + "x".repeat(32))).status).toBe(404);
    expect((await requestAccess(linkUrl, { name: "A", email: "a@example.test" })).status).toBe(400);
  });

  it("counts as sent once the share dialog logs it, and is listed for the item", async () => {
    const before = await api(`/share-links?itemType=document&itemId=${docId}`, { token: admin });
    expect(before.json.find((l: { id: string }) => l.id === linkId)).toBeUndefined();
    const log = await api("/share-logs", {
      method: "POST", token: admin,
      body: { entityType: "document", entityId: docId, entityName: "GA Plan", method: "whatsapp", projectId: co.projectId, shareLinkId: linkId },
    });
    expect(log.status).toBe(201);
    const after = await api(`/share-links?itemType=document&itemId=${docId}`, { token: admin });
    const row = after.json.find((l: { id: string }) => l.id === linkId);
    expect(row).toMatchObject({ method: "whatsapp", state: "ok", openCount: 1, canRevoke: true });
    const cross = await api(`/share-links?itemType=document&itemId=${docId}`, { token: otherAdmin });
    expect(cross.json).toEqual([]);
  });

  it("the sender is reminded once, 3 days before it expires", async () => {
    const [row] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, linkId));
    const nearEnd = new Date(row.expiresAt.getTime() - 2 * 86_400_000);
    expect(await runShareLinkReminders(new Date(row.expiresAt.getTime() - 5 * 86_400_000))).toBe(0);
    expect(await runShareLinkReminders(nearEnd)).toBeGreaterThanOrEqual(1);
    const notes = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    const reminder = notes.find(n => n.type === "share_link_expiring");
    expect(reminder?.relatedEntityId).toBe(docId);
    expect(reminder?.metadata).toMatchObject({ projectId: co.projectId });
    expect(reminder?.title).not.toMatch(/[–—]/);
    const again = await runShareLinkReminders(nearEnd);
    const notes2 = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    expect(notes2.filter(n => n.type === "share_link_expiring").length).toBe(1);
    expect(again).toBe(0);
  });

  it("an expired link stops opening and offers a request, which notifies the sender", async () => {
    await db.update(shareLinksTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinksTable.id, linkId));
    const l = await landing(linkUrl);
    expect(l.json.state).toBe("expired");
    expect(l.json.canRequestAccess).toBe(true);
    expect((await file(linkUrl)).status).toBe(410);
    expect((await requestAccess(linkUrl, { name: "", email: "nope" })).status).toBe(400);
    const r = await requestAccess(linkUrl, { name: "Sam <b>Surveyor</b>", email: "Sam@Example.test", organisation: "QS Ltd", note: "Need it for the tender" });
    expect(r.status).toBe(201);
    const dup = await requestAccess(linkUrl, { name: "Sam Surveyor", email: "sam@example.test" });
    expect(dup.status).toBe(200);
    const reqs = await db.select().from(shareAccessRequestsTable).where(eq(shareAccessRequestsTable.shareLinkId, linkId));
    expect(reqs.length).toBe(1);
    requestId = reqs[0].id;
    const notes = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    expect(notes.some(n => n.type === "share_access_requested" && n.relatedEntityId === requestId)).toBe(true);
    const otherNotes = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, other.userId));
    expect(otherNotes.some(n => n.type === "share_access_requested")).toBe(false);
  });

  it("a waiting request is counted for the sidebar and dashboard, for its own company only", async () => {
    const mine = await api("/share-requests/count", { token: admin });
    expect(mine.status).toBe(200);
    expect(mine.json).toEqual({ pending: 1, onlyId: requestId });
    const theirs = await api("/share-requests/count", { token: otherAdmin });
    expect(theirs.json).toEqual({ pending: 0, onlyId: null });
    expect((await api("/share-requests/count")).status).toBe(401);
  });

  it("a newer revision supersedes the old link, and the request will send the current one", async () => {
    const newUrl = await upload(admin);
    const created = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: "GA Plan rev B", type: "drawing", fileUrl: newUrl, supersededDocumentId: docId },
    });
    expect([200, 201]).toContain(created.status);
    newDocId = created.json.id;
    const l = await landing(linkUrl);
    expect(l.json.state).toBe("superseded");
    const stale = await api("/share-links", { method: "POST", token: admin, body: { itemType: "document", itemId: docId } });
    expect(stale.status).toBe(409);
    const list = await api("/share-requests", { token: admin });
    const req = list.json.find((x: { id: string }) => x.id === requestId);
    expect(req).toMatchObject({ status: "pending", canDecide: true, email: "sam@example.test" });
    expect(req.requested.id).toBe(docId);
    expect(req.willSend.id).toBe(newDocId);
    const cross = await api("/share-requests", { token: otherAdmin });
    expect(cross.json.find((x: { id: string }) => x.id === requestId)).toBeUndefined();
  });

  it("another company can't decide; approving mints a link to the current revision", async () => {
    const cross = await api(`/share-requests/${requestId}/decision`, { method: "POST", token: otherAdmin, body: { approve: true } });
    expect(cross.status).toBe(404);
    const res = await api(`/share-requests/${requestId}/decision`, { method: "POST", token: admin, body: { approve: true } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("approved");
    const [r] = await db.select().from(shareAccessRequestsTable).where(eq(shareAccessRequestsTable.id, requestId));
    const [granted] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, r.grantedShareLinkId!));
    expect(granted).toMatchObject({ itemId: newDocId, method: "request" });
    expect(granted.sentAt).not.toBeNull();
    const twice = await api(`/share-requests/${requestId}/decision`, { method: "POST", token: admin, body: { approve: false } });
    expect(twice.status).toBe(409);
    const notes = await db.select().from(notificationsTable).where(eq(notificationsTable.relatedEntityId, requestId));
    expect(notes.every(n => n.read)).toBe(true);
    expect((await api("/share-requests/count", { token: admin })).json.pending).toBe(0);
  });

  it("caps pending requests per link", async () => {
    for (let i = 0; i < 2; i++) {
      expect((await requestAccess(linkUrl, { name: `P${i}`, email: `p${i}@example.test` })).status).toBe(201);
    }
    expect((await requestAccess(linkUrl, { name: "P2", email: "p2@example.test" })).status).toBe(201);
    expect((await requestAccess(linkUrl, { name: "P3", email: "p3@example.test" })).status).toBe(429);
  });

  it("a stopped link no longer opens; only the sender or an approver can stop it", async () => {
    const minted = await api("/share-links", { method: "POST", token: admin, body: { itemType: "document", itemId: newDocId } });
    expect(minted.status).toBe(201);
    expect((await api(`/share-links/${minted.json.id}/revoke`, { method: "POST", token: otherAdmin })).status).toBe(404);
    expect((await api(`/share-links/${minted.json.id}/revoke`, { method: "POST", token: admin })).status).toBe(200);
    expect((await landing(minted.json.url)).json.state).toBe("revoked");
    expect((await file(minted.json.url)).status).toBe(410);
  });

  it("permits: a re-uploaded permit of the same type supersedes the old link", async () => {
    const docUrl = await upload(admin);
    const body = { type: "Hot works", description: "Roof level", responsibleUserId: co.userId, startDate: "2026-10-01", expiryDate: "2099-01-01", documentUrl: docUrl };
    const p1 = await api(`/projects/${co.projectId}/permits`, { method: "POST", token: admin, body });
    expect([200, 201]).toContain(p1.status);
    const minted = await api("/share-links", { method: "POST", token: admin, body: { itemType: "permit", itemId: p1.json.id } });
    expect(minted.status).toBe(201);
    const l = await landing(minted.json.url);
    expect(l.json).toMatchObject({ state: "ok", item: { itemType: "permit", name: "Hot works" } });
    expect((await file(minted.json.url)).status).toBe(200);
    const p2 = await api(`/projects/${co.projectId}/permits`, { method: "POST", token: admin, body: { ...body, documentUrl: await upload(admin) } });
    expect([200, 201]).toContain(p2.status);
    expect((await landing(minted.json.url)).json.state).toBe("superseded");
  });

  it("an emailed distribution link opens the portal (sign-in), never the file", async () => {
    // Dean, 2026-10-20: these links used to serve the file with no login for
    // 30 days, so a forwarded email gave the document away.
    const noD = await fetch(`${API_BASE}/documents/${newDocId}/open`, { redirect: "manual" });
    expect(noD.status).toBe(302);
    expect(noD.headers.get("location")).toBe(`/projects/${co.projectId}?tab=documents&document=${newDocId}`);
    const distId = randomUUID();
    await db.insert(documentDistributionsTable).values({ id: distId, documentId: newDocId, userId: co.userId });
    const withD = await fetch(`${API_BASE}/documents/${newDocId}/open?d=${distId}`, { redirect: "manual" });
    expect(withD.status).toBe(302);
    expect(withD.headers.get("location")).toBe(`/portal/shared?doc=${newDocId}`);
    // Clicking proves nothing about who opened it: the recipient isn't marked viewed.
    const [dist] = await db.select().from(documentDistributionsTable).where(eq(documentDistributionsTable.id, distId));
    expect(dist.status).toBe("pending");
    // An old revision's link also goes to the portal, which says a newer one exists.
    const oldDist = randomUUID();
    await db.insert(documentDistributionsTable).values({ id: oldDist, documentId: docId, userId: co.userId });
    const old = await fetch(`${API_BASE}/documents/${docId}/open?d=${oldDist}`, { redirect: "manual" });
    expect(old.headers.get("location")).toBe(`/portal/shared?doc=${docId}`);
  });
});
