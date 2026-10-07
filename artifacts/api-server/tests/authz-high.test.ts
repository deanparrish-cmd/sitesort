import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  usersTable, companyMembersTable, projectMembersTable, projectsTable, subcontractorsTable,
  permitsTable, qrBoardPinsTable, subcontractorNotesTable, activityLogTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";
import { generateToken } from "../src/middlewares/auth";

/**
 * #118, the High batch: public-board pins, billing, the test-email tool,
 * permits, contact cards and adding people to projects. Every call goes
 * DIRECTLY to the API with that role's own token; non-managers are refused and
 * the data is unchanged.
 */
describe("High batch: role checks below the buttons", () => {
  let co: Fixture;
  let other: Fixture;
  const tok: Record<string, string> = {};
  const sfx = randomUUID().slice(0, 8);
  const id = { pm: `thb-pm-${sfx}`, worker: `thb-wk-${sfx}`, cover: `thb-cv-${sfx}` };
  const card = `thb-card-${sfx}`;
  let permitId = "";

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    tok.admin = await login(co.email);
    tok.otherAdmin = await login(other.email);
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];
    const add = async (uid: string, role: string, project: { isProjectManager?: boolean } | null) => {
      await db.insert(usersTable).values({ id: uid, companyId: co.companyId, email: `${uid}@example.test`, passwordHash: owner.passwordHash, name: `Name ${uid}`, role, emailVerified: true });
      await db.insert(companyMembersTable).values({ id: randomUUID(), userId: uid, companyId: co.companyId, role });
      if (project) await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: uid, isProjectManager: !!project.isProjectManager } as any);
      return login(`${uid}@example.test`);
    };
    tok.pm = await add(id.pm, "project_manager", {});
    tok.worker = await add(id.worker, "site_worker", {});
    tok.cover = await add(id.cover, "site_worker", { isProjectManager: true });
    // A leftover subcontractor dashboard token (refused at the door since #117).
    tok.oldSub = generateToken({ id: `thb-old-${sfx}`, companyId: co.companyId, role: "subcontractor", email: `old-${sfx}@example.test` });
    await db.insert(subcontractorsTable).values({ id: card, companyId: co.companyId, companyName: "Card Ltd", contactName: "Car D", contactEmail: `card-${sfx}@example.test` });
    const permit = await api(`/projects/${co.projectId}/permits`, { method: "POST", token: tok.admin, body: { type: "hot_works", description: "Welding bay", responsibleUserId: co.userId, startDate: "2026-10-01", expiryDate: "2026-12-01" } });
    expect(permit.status).toBe(201);
    permitId = permit.json.id;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.delete(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId));
    await db.delete(permitsTable).where(eq(permitsTable.projectId, co.projectId));
    await db.delete(subcontractorNotesTable).where(eq(subcontractorNotesTable.subcontractorId, card));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.companyId, co.companyId));
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, Object.values(id)));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(id)));
    await cleanupFixtures([co, other]);
  });

  it("public board pins: a site worker can't pin or unpin; approvers (incl. per-project cover) can; staff can still see what's pinned", async () => {
    const body = { itemType: "document", itemId: `doc-${sfx}` };
    expect((await api(`/projects/${co.projectId}/qr-pins`, { method: "POST", token: tok.worker, body })).status).toBe(403);
    expect([401, 403]).toContain((await api(`/projects/${co.projectId}/qr-pins`, { method: "POST", token: tok.oldSub, body })).status);
    expect(await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId))).toHaveLength(0);
    expect((await api(`/projects/${co.projectId}/qr-pins`, { method: "POST", token: tok.cover, body })).status).toBe(201);
    expect((await api(`/projects/${co.projectId}/qr-pins`, { method: "DELETE", token: tok.worker, body })).status).toBe(403);
    expect(await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, co.projectId))).toHaveLength(1);
    expect((await api(`/projects/${co.projectId}/qr-pins`, { token: tok.worker })).status).toBe(200);
  });

  it("billing: only the company admin reaches it; a site worker or PM calling directly is refused", async () => {
    for (const path of ["/billing/cancel", "/billing/resume", "/billing/portal", "/billing/checkout"]) {
      expect((await api(path, { method: "POST", token: tok.worker, body: { plan: "solo" } })).status, path).toBe(403);
      expect((await api(path, { method: "POST", token: tok.pm, body: { plan: "solo" } })).status, path).toBe(403);
    }
    // The admin gets past the role check (this test company has no subscription).
    expect((await api("/billing/cancel", { method: "POST", token: tok.admin })).status).not.toBe(403);
  });

  it("test-email tool: refused to everyone but SiteSort staff (checked without sending anything)", async () => {
    const body = { template: "welcome", to: "someone-else@example.test" };
    expect((await api("/test-email", { method: "POST", token: tok.worker, body })).status).toBe(403);
    expect((await api("/test-email", { method: "POST", token: tok.admin, body })).status).toBe(403);
  });

  it("permits: a site worker can't create, edit or delete; another company can't touch them; approvers can", async () => {
    const create = { type: "confined_space", description: "x", responsibleUserId: co.userId, startDate: "2026-10-01", expiryDate: "2026-11-01" };
    expect((await api(`/projects/${co.projectId}/permits`, { method: "POST", token: tok.worker, body: create })).status).toBe(403);
    expect((await api(`/permits/${permitId}`, { method: "PATCH", token: tok.worker, body: { description: "Changed" } })).status).toBe(403);
    expect((await api(`/permits/${permitId}`, { method: "DELETE", token: tok.worker })).status).toBe(403);
    expect((await api(`/permits/${permitId}`, { method: "DELETE", token: tok.otherAdmin })).status).toBe(403);
    const [p] = await db.select().from(permitsTable).where(eq(permitsTable.id, permitId));
    expect(p.description).toBe("Welding bay");
    expect((await api(`/permits/${permitId}`, { method: "PATCH", token: tok.cover, body: { description: "Welding bay 2" } })).status).toBe(200);
    expect((await api(`/projects/${co.projectId}/permits`, { method: "POST", token: tok.pm, body: create })).status).toBe(201);
  });

  it("contact cards: a site worker can't create or edit them, but can add a note", async () => {
    expect((await api("/subcontractors", { method: "POST", token: tok.worker, body: { companyName: "Rogue Ltd", contactFirstName: "Rog", contactLastName: "Ue", contactEmail: `rogue-${sfx}@example.test`, trades: ["groundworks"] } })).status).toBe(403);
    expect((await api(`/subcontractors/${card}`, { method: "PATCH", token: tok.worker, body: { companyName: "Renamed Ltd" } })).status).toBe(403);
    const [c] = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.id, card));
    expect(c.companyName).toBe("Card Ltd");
    expect((await api(`/subcontractors/${card}/notes`, { method: "POST", token: tok.worker, body: { body: "Arrived late", content: "Arrived late", note: "Arrived late" } })).status).not.toBe(403);
    expect([401, 403]).toContain((await api(`/subcontractors/${card}/notes`, { method: "POST", token: tok.oldSub, body: { note: "x" } })).status);
  });

  it("adding people to a project (which lets them check in): approvers only", async () => {
    expect((await api(`/projects/${co.projectId}/members/link`, { method: "POST", token: tok.worker, body: { subcontractorId: card } })).status).toBe(403);
    expect((await api(`/projects/${co.projectId}/members`, { method: "POST", token: tok.worker, body: { subcontractorId: card } })).status).toBe(403);
    expect((await api(`/projects/${co.projectId}/tradespeople`, { method: "POST", token: tok.worker, body: { companyName: "X Ltd", contactName: "Ex Why", trade: "roofing" } })).status).toBe(403);
    expect((await api(`/projects/${co.projectId}/trades`, { method: "POST", token: tok.worker, body: { trade: "roofing" } })).status).toBe(403);
    const members = await db.select().from(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    expect(members.some(m => m.subcontractorId === card)).toBe(false);
    expect((await api(`/projects/${co.projectId}/members/link`, { method: "POST", token: tok.cover, body: { subcontractorId: card } })).status).toBe(201);
  });
});
