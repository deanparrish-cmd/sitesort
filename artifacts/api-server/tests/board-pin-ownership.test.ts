import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { qrCodesTable, qrBoardPinsTable, documentsTable, permitsTable, projectsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * #166 (Dean, 2026-10-22): the pin route accepted any item id. Harmless while
 * pinned permits couldn't be opened; once pinning publishes (#167) it would
 * have made another company's document readable by anyone with a QR code.
 * The item must belong to the board's own project, and the board never shows
 * a pin that doesn't.
 */
describe("a board pin must belong to the board's project", () => {
  let co: Fixture, other: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const sameCoOtherProject = `tproj-b-${sfx}`;
  const ownDoc = `tdoc-own-${sfx}`, otherCoDoc = `tdoc-oc-${sfx}`, otherProjDoc = `tdoc-op-${sfx}`, ownPermit = `tper-own-${sfx}`;
  const pin = (body: object) => api(`/projects/${co.projectId}/qr-pins`, { method: "POST", token: admin, body });
  const board = async () => (await fetch(`${API_BASE}/site/${qrToken}`).then(r => r.json())).pinnedItems as { id: string }[];

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    await db.insert(projectsTable).values({ id: sameCoOtherProject, companyId: co.companyId, name: "Other job", address: "2 Test Street", startDate: "2026-01-01" });
    const doc = (id: string, projectId: string, uploadedBy: string, name: string) => ({ id, projectId, uploadedBy, name, type: "drawing", fileUrl: `/api/uploads/${id}.pdf` });
    await db.insert(documentsTable).values([
      doc(ownDoc, co.projectId, co.userId, "Our drawing"),
      doc(otherCoDoc, other.projectId, other.userId, "Someone else's drawing"),
      doc(otherProjDoc, sameCoOtherProject, co.userId, "Other job's drawing"),
    ] as any);
    await db.insert(permitsTable).values({ id: ownPermit, projectId: co.projectId, type: "Hot works", description: "Roof", responsibleUserId: co.userId, startDate: "2026-01-01", expiryDate: "2027-01-01" } as any);
  });

  afterAll(async () => {
    await db.delete(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await db.delete(permitsTable).where(eq(permitsTable.id, ownPermit));
    await db.delete(documentsTable).where(inArray(documentsTable.id, [ownDoc, otherCoDoc, otherProjDoc]));
    await db.delete(projectsTable).where(eq(projectsTable.id, sameCoOtherProject));
    await cleanupFixtures([co, other]);
  });

  it("pins this project's own document and permit", async () => {
    expect((await pin({ itemType: "document", itemId: ownDoc })).status).toBe(201);
    expect((await pin({ itemType: "permit", itemId: ownPermit })).status).toBe(201);
    expect((await board()).map(p => p.id).sort()).toEqual([ownDoc, ownPermit].sort());
  });

  it("refuses another company's document, another project's document, a made-up id and an unknown type", async () => {
    expect((await pin({ itemType: "document", itemId: otherCoDoc })).status).toBe(404);
    expect((await pin({ itemType: "document", itemId: otherProjDoc })).status).toBe(404);
    expect((await pin({ itemType: "document", itemId: `nope-${sfx}` })).status).toBe(404);
    expect((await pin({ itemType: "permit", itemId: ownDoc })).status).toBe(404); // right id, wrong kind
    expect((await pin({ itemType: "user", itemId: co.userId })).status).toBe(400);
    const rows = await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId));
    expect(rows.map(r => r.itemId).sort()).toEqual([ownDoc, ownPermit].sort());
  });

  it("a pin row from before the check, pointing at another company's document, never reaches the public board", async () => {
    await db.insert(qrBoardPinsTable).values({ id: randomUUID(), projectId: co.projectId, itemType: "document", itemId: otherCoDoc });
    const ids = (await board()).map(p => p.id);
    expect(ids).not.toContain(otherCoDoc);
    expect(ids.sort()).toEqual([ownDoc, ownPermit].sort());
  });
});
