import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  documentsTable, permitsTable, personCertificationsTable, portalMemberDocumentsTable, notificationsTable, portalSessionsTable,
} from "@workspace/db/schema";
import {
  API_BASE, seedCompany, cleanupFixtures, login, api, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Dean, 2026-10-22, from using the dashboard:
 * 1. Every register reads newest first (documents and drawings, permits,
 *    certificates); they came back oldest first or in storage order.
 * 2. A rejected submission sat in "Documents for review" for ever. Once the
 *    same person's replacement (same kind) is approved it moves to a Rejected
 *    folder with its note; and a rejection always carries a reason, which the
 *    sender sees in My documents.
 */
describe("registers newest first; rejected documents", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let ptok = "";
  const mins = (n: number) => new Date(Date.now() - n * 60_000);

  async function upload(name: string, kind: string): Promise<string> {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%test\n")], { type: "application/pdf" }), `${name}.pdf`);
    fd.append("name", name);
    fd.append("kind", kind);
    const res = await fetch(`${API_BASE}/portal/my-documents`, { method: "POST", headers: { Authorization: `Bearer ${ptok}` }, body: fd });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(201);
    return json.id;
  }
  const review = (id: string, body: object) => api(`/projects/${co.projectId}/member-documents/${id}/review`, { method: "POST", token: admin, body });
  const reviewList = async () => (await api(`/projects/${co.projectId}/member-documents`, { token: admin })).json as any[];

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    ptok = (await portalLogin(member.email, member.password, co.projectId)).token;
  });

  afterAll(async () => {
    await db.delete(portalMemberDocumentsTable).where(eq(portalMemberDocumentsTable.projectId, co.projectId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(personCertificationsTable).where(inArray(personCertificationsTable.personId, member.personIds));
    await db.delete(permitsTable).where(eq(permitsTable.projectId, co.projectId));
    await db.delete(documentsTable).where(eq(documentsTable.projectId, co.projectId));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("documents and drawings: newest first", async () => {
    const ids: string[] = [];
    for (const name of ["Old drawing", "Middle drawing", "New drawing"]) {
      const r = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name, type: "drawing", fileUrl: `/api/uploads/${name.replace(/ /g, "-")}.pdf`, fileSize: 10 } });
      expect(r.status).toBeLessThan(300);
      ids.push(r.json.id);
    }
    await db.update(documentsTable).set({ createdAt: mins(30) }).where(eq(documentsTable.id, ids[0]));
    await db.update(documentsTable).set({ createdAt: mins(20) }).where(eq(documentsTable.id, ids[1]));
    await db.update(documentsTable).set({ createdAt: mins(10) }).where(eq(documentsTable.id, ids[2]));
    const list = (await api(`/projects/${co.projectId}/documents`, { token: admin })).json as any[];
    expect(list.map(d => d.name)).toEqual(["New drawing", "Middle drawing", "Old drawing"]);
  });

  it("permits: newest first", async () => {
    const ids: string[] = [];
    for (const description of ["Old permit", "New permit"]) {
      const r = await api(`/projects/${co.projectId}/permits`, { method: "POST", token: admin, body: { type: "hot_works", description, responsibleUserId: co.userId, startDate: "2026-10-01", expiryDate: "2027-12-01" } });
      expect(r.status).toBe(201);
      ids.push(r.json.id);
    }
    await db.update(permitsTable).set({ createdAt: mins(30) }).where(eq(permitsTable.id, ids[0]));
    await db.update(permitsTable).set({ createdAt: mins(10) }).where(eq(permitsTable.id, ids[1]));
    const list = (await api(`/projects/${co.projectId}/permits`, { token: admin })).json as any[];
    expect(list.map(p => p.description)).toEqual(["New permit", "Old permit"]);
  });

  it("certificates on a contact: newest first", async () => {
    const pid = member.personIds[0];
    const ids: string[] = [];
    for (const name of ["Old CSCS", "New CSCS"]) {
      const r = await api(`/people/${pid}/certifications`, { method: "POST", token: admin, body: { name, expiryDate: "2028-01-01", certType: "qualification" } });
      expect(r.status).toBeLessThan(300);
      ids.push(r.json.id);
    }
    await db.update(personCertificationsTable).set({ createdAt: mins(30) }).where(eq(personCertificationsTable.id, ids[0]));
    await db.update(personCertificationsTable).set({ createdAt: mins(10) }).where(eq(personCertificationsTable.id, ids[1]));
    const list = (await api(`/people/${pid}/certifications`, { token: admin })).json as any[];
    expect(list.map(c => c.name)).toEqual(["New CSCS", "Old CSCS"]);
  });

  it("a rejection needs a reason, and the sender sees it in My documents", async () => {
    const id = await upload("Public liability 2025", "insurance");
    const bare = await review(id, { action: "reject" });
    expect(bare.status).toBe(400);
    expect(bare.json.error).toBe("reason_required");
    expect((await review(id, { action: "reject", note: "   " })).status).toBe(400);
    expect((await review(id, { action: "reject", note: "Expired in March. Send the current certificate." })).status).toBe(200);
    const mine = (await api("/portal/my-documents", { token: ptok })).json as any[];
    expect(mine.find(d => d.id === id)).toMatchObject({ status: "rejected", reviewNote: "Expired in March. Send the current certificate." });
  });

  it("the rejected one stays for review until a replacement of the same kind is approved, then moves to Rejected with its note", async () => {
    const rejected = (await reviewList()).find(d => d.status === "rejected")!;
    expect(rejected.replacedBy).toBeUndefined();
    // A different kind from the same person doesn't count.
    const other = await upload("Site photo ID", "other");
    expect((await review(other, { action: "approve" })).status).toBe(200);
    expect((await reviewList()).find(d => d.id === rejected.id).replacedBy).toBeUndefined();
    // The replacement, still pending: not yet.
    const replacement = await upload("Public liability 2026", "insurance");
    expect((await reviewList()).find(d => d.id === rejected.id).replacedBy).toBeUndefined();
    expect((await review(replacement, { action: "approve" })).status).toBe(200);
    const moved = (await reviewList()).find(d => d.id === rejected.id);
    expect(moved).toMatchObject({ status: "rejected", reviewNote: "Expired in March. Send the current certificate.", replacedBy: { id: replacement, name: "Public liability 2026" } });
    expect(moved.replacedBy.approvedAt).toBeTruthy();
    // Newest first in the review list too.
    const names = (await reviewList()).map(d => d.name);
    expect(names.indexOf("Public liability 2026")).toBeLessThan(names.indexOf("Public liability 2025"));
  });
});
