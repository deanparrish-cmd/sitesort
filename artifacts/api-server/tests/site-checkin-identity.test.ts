import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable,
  insuranceRecordsTable, notificationsTable, usersTable, companyMembersTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * QR check-in identity (#124: phone first): the mobile number on file
 * identifies a registered person; one person can't appear as two ("Amy" vs
 * "Amy Parrish"); a number nobody has is HELD as unverified for the site
 * manager, and approving it files the number on the record they named; the
 * old name lookups are gone; feed items and the notification detail endpoint.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

describe("site check-in identity", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const subId = `tsub-${sfx}`;
  const personId = `tper-${sfx}`;
  const bobId = `tper-bob-${sfx}`;
  const AMY = "07700 900456";

  async function checkIn(fields: Record<string, string>) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const identify = (phone: string) => api(`/site/${qrToken}/identify`, { method: "POST", body: { phone } });
  const checkOut = (phone = AMY) => api(`/site/${qrToken}/checkout`, { method: "POST", body: { phone } });
  const count = async () => (await api(`/site/${qrToken}/on-site-count`)).json.count as number;

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    const qr = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["general"] } });
    qrToken = qr.json[0].token;
    // A contact "Amy" at "Amy I Cloud" whose primary-contact PERSON is "Amy Parrish" (names drifted apart).
    await db.insert(subcontractorsTable).values({ id: subId, companyId: co.companyId, companyName: "Amy I Cloud", contactName: "Amy", contactEmail: `amy-${sfx}@example.test` });
    await db.insert(peopleTable).values({ id: personId, companyId: co.companyId, name: "Amy Parrish", email: `amyp-${sfx}@example.test`, phone: AMY, subcontractorId: subId, isPrimaryContact: true });
    // Bob works for the same firm but has no mobile on file yet.
    await db.insert(peopleTable).values({ id: bobId, companyId: co.companyId, name: "Bob Builder", email: `bob-${sfx}@example.test`, subcontractorId: subId });
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: subId } as any);
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, personId: bobId } as any);
    await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: subId, type: "public_liability", certificateUrl: "/api/uploads/x.pdf", expiryDate: "2099-01-01" } as any);
  });

  afterAll(async () => {
    // notifications are inserted fire-and-forget by the API; let the last ones land before cleanup
    await new Promise(r => setTimeout(r, 500));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, subId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(inArray(peopleTable.id, [personId, bobId]));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, subId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("the gate finds a person by the mobile on file, in any common format, and shows only first name, initial and company", async () => {
    for (const p of [AMY, "+44 7700 900456", "07700-900-456", "0044 7700 900456"]) {
      const r = await identify(p);
      expect(r.status, p).toBe(200);
      expect(r.json.matches.map((m: any) => m.label), p).toEqual(["Amy P, Amy I Cloud"]);
    }
    const r = await identify(AMY);
    expect(JSON.stringify(r.json)).not.toContain("Parrish");
    expect(r.json.matches[0].matchToken).toBeTruthy();
    expect((await identify("07700 900000")).json.matches).toEqual([]);
    expect((await identify("123")).status).toBe(400);
  });

  it("'Is this you?' signs in the matched person under ONE identity; a second sign-in while open is refused", async () => {
    const tok = (await identify(AMY)).json.matches[0].matchToken;
    const a = await checkIn({ matchToken: tok });
    expect(a.status).toBe(201);
    expect(a.json).not.toHaveProperty("personKey");
    expect(a.json.companyName).toBe("Amy I Cloud");
    expect(a.json.deviceToken).toBeTruthy();
    expect((await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, a.json.id)))[0].personKey).toBe(`person:${personId}`);
    // The number straight to check-in, same human, while still signed in.
    const dup = await checkIn({ phone: "+447700900456" });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("already_signed_in");
    expect(await count()).toBe(1);
  });

  it("the remembered device signs its own person in and out; a forged match token does nothing", async () => {
    expect((await checkOut()).status).toBe(200);
    expect(await count()).toBe(0);
    const tok = (await identify(AMY)).json.matches[0].matchToken;
    const first = await checkIn({ matchToken: tok });
    const device = first.json.deviceToken as string;
    expect((await api(`/site/${qrToken}/checkout`, { method: "POST", body: { deviceToken: device } })).status).toBe(200);
    const again = await checkIn({ deviceToken: device });
    expect(again.status).toBe(201);
    expect((await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, again.json.id)))[0].personKey).toBe(`person:${personId}`);
    expect((await checkIn({ matchToken: "not-a-real-token" })).status).toBe(403);
    expect((await checkIn({ deviceToken: "garbage" })).status).toBe(403);
    await checkOut();
    const rows = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.checkedOutAt && r.personKey === `person:${personId}`)).toBe(true);
  });

  it("a name and company alone never sign anyone in, and the old name lookups are gone", async () => {
    expect((await checkIn({ workerName: "Amy Parrish", companyName: "Amy I Cloud" })).status).toBe(400);
    expect((await api(`/site/${qrToken}/register-match?workerName=Amy&companyName=Amy%20I%20Cloud`)).status).toBe(404);
    expect((await api(`/site/${qrToken}/companies`)).status).toBe(404);
    expect(await count()).toBe(0);
  });

  it("a number nobody has is HELD as unverified with what they typed; approving files it on the named record", async () => {
    const r = await checkIn({ phone: "07700 900777", workerName: "bob  builder", companyName: "AMY I CLOUD" });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: "check_in_held", holdReason: "unverified", reason: "unverified" });
    expect(await count()).toBe(0); // not on the fire roll until approved
    const [row] = await db.select().from(siteCheckinsTable).where(and(eq(siteCheckinsTable.projectId, co.projectId), eq(siteCheckinsTable.holdReason, "unverified")));
    expect(row.personKey).toBe(`person:${bobId}`);
    expect(row.typedPhone).toBe("07700 900777");
    // The same visitor again: the same hold, not a second row.
    expect((await checkIn({ phone: "07700900777", workerName: "Bob Builder", companyName: "Amy I Cloud" })).json.holdToken).toBeTruthy();
    expect((await db.select().from(siteCheckinsTable).where(and(eq(siteCheckinsTable.projectId, co.projectId), eq(siteCheckinsTable.holdReason, "unverified"))))).toHaveLength(1);

    const ok = await api(`/projects/${co.projectId}/checkins/${row.id}/hold-decision`, { method: "POST", token: admin, body: { decision: "approve", note: "Known to the gang" } });
    expect(ok.status).toBe(200);
    expect(ok.json.phoneFiled).toBe(true);
    expect((await db.select().from(peopleTable).where(eq(peopleTable.id, bobId)))[0].phone).toBe("07700 900777");
    expect(await count()).toBe(1);
    // Next time the number finds him, and it signs him out too.
    expect((await identify("07700900777")).json.matches.map((m: any) => m.label)).toEqual(["Bob B, Amy I Cloud"]);
    expect((await checkOut("07700 900777")).status).toBe(200);
  });

  it("someone else's number with a different name ('No, that's not me') is held, never signed in as the number's owner", async () => {
    const r = await checkIn({ phone: AMY, workerName: "Cal Cousin", companyName: "Amy I Cloud" });
    expect(r.status).toBe(403);
    expect(r.json.holdReason).toBe("unverified");
    const [row] = await db.select().from(siteCheckinsTable).where(and(eq(siteCheckinsTable.projectId, co.projectId), eq(siteCheckinsTable.workerName, "Cal Cousin")));
    expect(row.personKey).toBeNull();
    expect(row.holdStatus).toBe("pending");
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.id, row.id));
  });

  it("approving never overwrites a number already on file", async () => {
    const r = await checkIn({ phone: "07700 900888", workerName: "Amy Parrish", companyName: "Amy I Cloud" });
    expect(r.json.holdReason).toBe("unverified");
    const row = (await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.holdStatus, "pending")))
      .find(x => x.projectId === co.projectId)!;
    const ok = await api(`/projects/${co.projectId}/checkins/${row.id}/hold-decision`, { method: "POST", token: admin, body: { decision: "approve", note: "New phone, checked" } });
    expect(ok.json.phoneFiled).toBe(false);
    expect((await db.select().from(peopleTable).where(eq(peopleTable.id, personId)))[0].phone).toBe(AMY);
    expect((await checkOut("07700 900888")).status).toBe(200); // the number they gave still signs them out today
  });

  it("check-in, held and sign-out all reach the feed, and each opens its detail", async () => {
    const feed = await api("/notifications", { token: admin });
    const types = feed.json.map((n: any) => n.type);
    expect(types).toContain("check_in");
    expect(types).toContain("check_out");
    expect(types).toContain("check_in_held");

    const inN = feed.json.find((n: any) => n.type === "check_in");
    const d = await api(`/notifications/${inN.id}/checkin`, { token: admin });
    expect(d.status).toBe(200);
    expect(d.json.kind).toBe("check_in");
    expect(d.json.checkin.workerName).toBeTruthy();
    expect(d.json.checkin.photoUrl).toMatch(/uploads/);
    expect(d.json.project.id).toBe(co.projectId);

    const heldN = feed.json.find((n: any) => n.type === "check_in_held");
    expect(heldN.message).toMatch(/mobile number they gave isn't on file/);
    expect((await api(`/notifications/${heldN.id}/checkin`, { token: admin })).json.kind).toBe("held");

    const outN = feed.json.find((n: any) => n.type === "check_out");
    expect((await api(`/notifications/${outN.id}/checkin`, { token: admin })).json.kind).toBe("check_out");
  });

  it("legacy check-in notifications (project id, message only) still resolve to the check-in row", async () => {
    // The lookup takes the newest row of that name within 5 minutes.
    const row = (await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId)).orderBy(desc(siteCheckinsTable.checkedInAt)))[0];
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
  // Last: it uses up this board's allowance of wrong numbers.
  it("a board under number-guessing never turns a worker away: lookups pause and he is held instead", async () => {
    // Use up this board's allowance of wrong numbers.
    for (let i = 0; i < 60; i++) await identify(`07700 91${String(i).padStart(4, "0")}`);
    const paused = await identify(AMY); // even a number on file isn't looked up now
    expect(paused.status).toBe(200);
    expect(paused.json).toEqual({ matches: [], checkingPaused: true });
    const r = await checkIn({ phone: AMY, workerName: "Real Worker", companyName: "Amy I Cloud" });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: "check_in_held", holdReason: "unverified" });
    const [row] = await db.select().from(siteCheckinsTable).where(and(eq(siteCheckinsTable.projectId, co.projectId), eq(siteCheckinsTable.workerName, "Real Worker")));
    expect(row.holdStatus).toBe("pending");
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.id, row.id));
  });

});
