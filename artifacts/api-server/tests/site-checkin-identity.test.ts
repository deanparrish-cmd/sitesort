import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable,
  insuranceRecordsTable, notificationsTable, usersTable, companyMembersTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * QR check-in identity: one registered person can't appear as two ("Amy" vs
 * "Amy Parrish"), the double sign-in guard, near-match suggestions at check-in,
 * sign-out feed items, and the check-in notification detail endpoint.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

describe("site check-in identity", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const subId = `tsub-${randomUUID().slice(0, 8)}`;
  const personId = `tper-${randomUUID().slice(0, 8)}`;

  async function checkIn(name: string, company: string) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    fd.append("workerName", name);
    fd.append("companyName", company);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const checkOut = (body: object) => api(`/site/${qrToken}/checkout`, { method: "POST", body });

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    const qr = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["general"] } });
    qrToken = qr.json[0].token;
    // A contact "Amy" at "Amy I Cloud" whose primary-contact PERSON is "Amy Parrish" (names drifted apart).
    await db.insert(subcontractorsTable).values({ id: subId, companyId: co.companyId, companyName: "Amy I Cloud", contactName: "Amy", contactEmail: "amy@example.test" });
    await db.insert(peopleTable).values({ id: personId, companyId: co.companyId, name: "Amy Parrish", email: "amyp@example.test", subcontractorId: subId, isPrimaryContact: true });
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: subId } as any);
    await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: subId, type: "public_liability", certificateUrl: "/api/uploads/x.pdf", expiryDate: "2099-01-01" } as any);
  });

  afterAll(async () => {
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, subId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(eq(peopleTable.id, personId));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, subId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("'Amy' and 'Amy Parrish' resolve to ONE person: same identity key, second sign-in while open is refused", async () => {
    const a = await checkIn("Amy", "Amy I Cloud");
    expect(a.status).toBe(201);
    expect(a.json.personKey).toBe(`person:${personId}`);
    // the other spelling, same human, while still signed in
    const dup = await checkIn("amy  parrish", "AMY I CLOUD");
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("already_signed_in");
    // count and status treat them as one
    expect((await api(`/site/${qrToken}/on-site-count`)).json.count).toBe(1);
    const who = await api(`/site/${qrToken}/who?workerName=Amy%20Parrish&companyName=Amy%20I%20Cloud`);
    expect(who.json.exact?.checkinId).toBe(a.json.id);
  });

  it("signing out under the other spelling closes that person's presence", async () => {
    const out = await checkOut({ workerName: "Amy Parrish", companyName: "Amy I Cloud" });
    expect(out.status).toBe(200);
    expect((await api(`/site/${qrToken}/on-site-count`)).json.count).toBe(0);
  });

  it("a second in/out cycle later is a NEW row under the same identity", async () => {
    const again = await checkIn("Amy Parrish", "Amy I Cloud");
    expect(again.status).toBe(201);
    expect(again.json.personKey).toBe(`person:${personId}`);
    await checkOut({ workerName: "Amy", companyName: "Amy I Cloud" });
    const rows = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.checkedOutAt && r.personKey === `person:${personId}`)).toBe(true);
  });

  it("company typo is blocked but suggested ('Did you mean'), never silently matched", async () => {
    const blocked = await checkIn("Amy Parrish", "I cloud");
    expect(blocked.status).toBe(403);
    expect(blocked.json.reason).toBe("not_registered");
    expect(blocked.json.suggestions.map((s: any) => s.label)).toContain("Amy Parrish, Amy I Cloud");
    const sug = blocked.json.suggestions[0];
    expect(sug.workerName).toBeTruthy();
    // no row was created
    const rows = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    expect(rows).toHaveLength(2);
    // the typing-time endpoint agrees
    const match = await api(`/site/${qrToken}/register-match?workerName=${encodeURIComponent("Amy Parrish")}&companyName=${encodeURIComponent("I cloud")}`);
    expect(match.json.registered).toBe(false);
    expect(match.json.suggestions.length).toBeGreaterThan(0);
    // and an exact registered person gets no suggestions
    expect((await api(`/site/${qrToken}/register-match?workerName=Amy&companyName=Amy%20I%20Cloud`)).json.registered).toBe(true);
    // far-off names get nothing; under 3 letters never lists anyone
    expect((await api(`/site/${qrToken}/register-match?workerName=Zachary&companyName=Other`)).json.suggestions).toHaveLength(0);
    expect((await api(`/site/${qrToken}/register-match?workerName=Am&companyName=`)).json.suggestions).toHaveLength(0);
  });

  it("check-in, blocked and sign-out all reach the feed, and each opens its detail", async () => {
    const feed = await api("/notifications", { token: admin });
    const types = feed.json.map((n: any) => n.type);
    expect(types).toContain("check_in");
    expect(types).toContain("check_out");
    expect(types).toContain("check_in_blocked");

    const inN = feed.json.find((n: any) => n.type === "check_in");
    const d = await api(`/notifications/${inN.id}/checkin`, { token: admin });
    expect(d.status).toBe(200);
    expect(d.json.kind).toBe("check_in");
    expect(d.json.checkin.workerName).toBeTruthy();
    expect(d.json.checkin.photoUrl).toMatch(/uploads/);
    expect(d.json.checkin.checkedOutAt).toBeTruthy();
    expect(d.json.project.id).toBe(co.projectId);

    const blockedN = feed.json.find((n: any) => n.type === "check_in_blocked");
    const b = await api(`/notifications/${blockedN.id}/checkin`, { token: admin });
    expect(b.json.kind).toBe("blocked");
    expect(b.json.attempt).toMatchObject({ workerName: "Amy Parrish", companyName: "I cloud", reason: "not_registered" });

    const outN = feed.json.find((n: any) => n.type === "check_out");
    expect((await api(`/notifications/${outN.id}/checkin`, { token: admin })).json.kind).toBe("check_out");
  });

  it("legacy check-in notifications (project id, message only) still resolve to the check-in row", async () => {
    const row = (await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId)))[0];
    const legacyId = randomUUID();
    await db.insert(notificationsTable).values({
      id: legacyId, userId: co.userId, type: "check_in", title: "Check-in at X",
      message: `${row.workerName} (${row.companyName}) checked in on site at 10:00.`,
      relatedEntityId: co.projectId, relatedEntityType: "project", read: false, createdAt: row.checkedInAt,
    } as any);
    const d = await api(`/notifications/${legacyId}/checkin`, { token: admin });
    expect(d.status).toBe(200);
    expect(d.json.checkin?.id).toBe(row.id);
  });

  it("notification detail is private to its owner", async () => {
    const feed = await api("/notifications", { token: admin });
    const other = await seedCompany();
    try {
      const otherToken = await login(other.email);
      expect((await api(`/notifications/${feed.json[0].id}/checkin`, { token: otherToken })).status).toBe(404);
    } finally {
      await cleanupFixtures([other]);
    }
  });
});
