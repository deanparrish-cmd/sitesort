import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { qrCodesTable, qrBoardPinsTable, documentsTable, permitsTable, documentDistributionsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";
import { buildSiteBoardPayload } from "../src/lib/site-board";

/**
 * #167 (Dean, 2026-10-22): "Hot works" under Pinned to this board did nothing
 * when tapped, on the QR board and in the portal: a pinned permit was plain
 * text and the board never carried its file. Pinning now publishes: whatever
 * is pinned opens for whoever looks at the board; no file is said plainly;
 * archived items can't go up; a pinned drawing follows its current revision.
 */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const ORIGIN = API_BASE.replace(/\/api$/, "");

describe("pinned to the site board means anyone looking at the board can open it", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const hotWorks = `tper-hw-${sfx}`, noDoc = `tper-nd-${sfx}`, withdrawn = `tper-wd-${sfx}`;
  const docIds: string[] = [];
  const pin = (itemType: string, itemId: string) => api(`/projects/${co.projectId}/qr-pins`, { method: "POST", token: admin, body: { itemType, itemId } });
  const board = async () => (await fetch(`${API_BASE}/site/${qrToken}`).then(r => r.json()));
  const pinned = async (id: string) => ((await board()).pinnedItems as any[]).find(p => p.id === id);

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    const fd = new FormData();
    fd.append("file", new Blob([PDF], { type: "application/pdf" }), "hot-works.pdf");
    const up = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${admin}` } });
    expect(up.status).toBe(200);
    const fileUrl = ((await up.json()).url as string).replace(/\?.*$/, "");
    const permit = (id: string, type: string, documentUrl: string | null, archivedAt: Date | null = null) =>
      ({ id, projectId: co.projectId, type, description: "Level 3 roof", responsibleUserId: co.userId, startDate: "2026-01-01", expiryDate: "2027-01-01", documentUrl, archivedAt });
    await db.insert(permitsTable).values([
      permit(hotWorks, "Hot works", fileUrl),
      permit(noDoc, "Confined space", null),
      permit(withdrawn, "Excavation", fileUrl, new Date()),
    ] as any);
  });

  afterAll(async () => {
    await db.delete(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await db.delete(permitsTable).where(inArray(permitsTable.id, [hotWorks, noDoc, withdrawn]));
    if (docIds.length) {
      await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docIds));
      await db.update(documentsTable).set({ previousVersionId: null }).where(inArray(documentsTable.id, docIds));
      await db.delete(documentsTable).where(inArray(documentsTable.id, docIds));
    }
    await cleanupFixtures([co]);
  });

  it("a pinned permit with a document opens from the public board, no login", async () => {
    const res = await pin("permit", hotWorks);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ noFile: false });
    expect(res.json.message).toMatch(/Anyone who scans the site QR code, and everyone on the Team Portal for this project, can open it/);
    const p = await pinned(hotWorks);
    expect(p.fileUrl).toMatch(/^\/api\/uploads\/.+[?&]sig=/);
    const file = await fetch(`${ORIGIN}${p.fileUrl}`);
    expect(file.status).toBe(200);
  });

  it("a permit with no document is pinnable, and the board says so instead of a dead row", async () => {
    const res = await pin("permit", noDoc);
    expect(res.status).toBe(201);
    expect(res.json.noFile).toBe(true);
    expect(res.json.message).toMatch(/no document attached/);
    expect((await pinned(noDoc)).fileUrl).toBeNull();
  });

  it("an archived permit can't be pinned; an older pin to it is left off the board and listed with the reason", async () => {
    const res = await pin("permit", withdrawn);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("archived");
    await db.insert(qrBoardPinsTable).values({ id: randomUUID(), projectId: co.projectId, itemType: "permit", itemId: withdrawn });
    const b = await board();
    expect((b.pinnedItems as any[]).map(p => p.id)).not.toContain(withdrawn);
    expect((b.permits as any[]).map(p => p.id)).not.toContain(withdrawn); // nor in the board's Permits list
    const list = (await api(`/projects/${co.projectId}/qr-pins`, { token: admin })).json as any[];
    expect(list.find(p => p.itemId === withdrawn)).toMatchObject({ hidden: "archived", hiddenText: "Not shown on the board: it has been archived." });
  });

  it("a pinned drawing moves to the new revision when one is uploaded", async () => {
    const name = `Gate plan ${sfx}`;
    const a = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name, type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100 } });
    expect(a.status).toBe(201); docIds.push(a.json.id);
    expect((await pin("document", a.json.id)).status).toBe(201);
    const b = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name, type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, supersededDocumentId: a.json.id } });
    expect(b.status).toBe(201); docIds.push(b.json.id);
    const rows = await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId));
    expect(rows.filter(r => r.itemType === "document").map(r => r.itemId)).toEqual([b.json.id]);
    expect(await pinned(a.json.id)).toBeUndefined();
    expect(await pinned(b.json.id)).toMatchObject({ superseded: false });
  });

  it("an older pin left on a replaced drawing shows the current revision, and unpinning the current one removes it", async () => {
    const name = `Old pin ${sfx}`;
    const a = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name, type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100 } });
    docIds.push(a.json.id);
    const b = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name, type: "drawing", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, supersededDocumentId: a.json.id } });
    docIds.push(b.json.id);
    // A pin from before #167 still pointing at the replaced revision.
    await db.insert(qrBoardPinsTable).values({ id: randomUUID(), projectId: co.projectId, itemType: "document", itemId: a.json.id });
    expect(await pinned(a.json.id)).toBeUndefined();
    expect(await pinned(b.json.id)).toMatchObject({ superseded: false });
    const list = (await api(`/projects/${co.projectId}/qr-pins`, { token: admin })).json as any[];
    expect(list.find(p => p.itemId === a.json.id)).toMatchObject({ shownId: b.json.id, hidden: null });
    expect((await api(`/projects/${co.projectId}/qr-pins`, { method: "DELETE", token: admin, body: { itemType: "document", itemId: b.json.id } })).status).toBe(200);
    expect(await pinned(b.json.id)).toBeUndefined();
  });

  it("the portal board is built by the same function: the same items open, the same notice shows", async () => {
    const portal = await buildSiteBoardPayload(co.projectId);
    const pub = await board();
    const strip = (items: any[]) => items.map(p => ({ id: p.id, hasFile: !!p.fileUrl })).sort((x, y) => x.id.localeCompare(y.id));
    expect(strip(portal!.pinnedItems as any[])).toEqual(strip(pub.pinnedItems));
  });
});
