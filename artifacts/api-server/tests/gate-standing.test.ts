import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable, insuranceRecordsTable,
  notificationsTable, usersTable, activityLogTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * #164 (Dean, 2026-10-22): from #163 someone on a project with no card and no
 * firm is held at the gate every time (Mick and Paul Jones on Elland Road),
 * and nothing told the PM when they created that. One function now decides
 * gate standing; the gate, the Team tab and Add to project all read it, so a
 * warning can never disagree with the barrier. "Give them a card" fixes it.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const HELD = "Held at the gate: no card or firm. They'll be held until you give them a card or a firm.";
const STAFF = "Let on as in-house staff, no insurance check.";

describe("gate standing: the Team tab and Add to project say what the gate will do", () => {
  let co: Fixture, other: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const covered = `gsub-cov-${sfx}`, uncovered = `gsub-unc-${sfx}`, foreign = `gsub-for-${sfx}`;
  const mick = `guser-mick-${sfx}`, paul = `guser-paul-${sfx}`, rita = `guser-rita-${sfx}`, ivan = `guser-ivan-${sfx}`;
  const ivanCard = `gper-ivan-${sfx}`;
  const PHONE: Record<string, string> = { [mick]: "07700 900401", [paul]: "07700 900402", [rita]: "07700 900403", [ivan]: "07700 900404" };
  const logins = [mick, paul, rita, ivan];

  async function checkIn(phone: string) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    fd.append("phone", phone);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const clearCheckins = () => db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
  const members = async () => (await api(`/projects/${co.projectId}/members`, { token: admin })).json as any[];
  const rowOf = async (userId: string) => (await members()).find(m => m.userId === userId);
  const add = (userId: string) => api(`/projects/${co.projectId}/members`, { method: "POST", token: admin, body: { userId, role: "site_worker" } });
  const giveCard = (memberId: string, body: object) => api(`/projects/${co.projectId}/members/${memberId}/card`, { method: "POST", token: admin, body });
  // The barrier and the screen must agree: held on the Team tab <=> 403 at the gate.
  async function agrees(userId: string) {
    const row = await rowOf(userId);
    const gate = await checkIn(PHONE[userId]);
    await clearCheckins();
    expect({ holds: row.gateStanding.holds, gateHeld: gate.status === 403 }).toEqual({ holds: row.gateStanding.holds, gateHeld: row.gateStanding.holds });
    return { row, gate };
  }

  beforeAll(async () => {
    co = await seedCompany();
    other = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    await db.insert(subcontractorsTable).values([
      { id: covered, companyId: co.companyId, companyName: "Covered Groundworks", contactName: "Cal Covered", contactEmail: `cal-${sfx}@example.test` },
      { id: uncovered, companyId: co.companyId, companyName: "Uncovered Scaffolding", contactName: "Una Uncovered", contactEmail: `una-${sfx}@example.test` },
      { id: foreign, companyId: other.companyId, companyName: "Someone Else's Firm", contactName: "Fay Foreign", contactEmail: `fay-${sfx}@example.test` },
    ]);
    await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: covered, type: "public_liability", certificateUrl: "/api/uploads/pl.pdf", expiryDate: day(200) } as any);
    await db.insert(usersTable).values(logins.map(id => ({
      id, companyId: co.companyId, email: `${id}@example.test`, passwordHash: "x", name: `${id.split("-")[1]} Jones`, role: "site_worker", portalOnly: true, phone: PHONE[id],
    })) as any);
    // Ivan already holds an in-house card at this company (on no project here).
    await db.insert(peopleTable).values({ id: ivanCard, companyId: co.companyId, name: "ivan Jones", email: `${ivan}@example.test`, userId: ivan } as any);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await clearCheckins();
    await db.delete(activityLogTable).where(eq(activityLogTable.projectId, co.projectId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(inArray(peopleTable.userId, logins));
    await db.delete(usersTable).where(inArray(usersTable.id, logins));
    await db.delete(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, [covered, uncovered, foreign]));
    await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, [covered, uncovered, foreign]));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co, other]);
  });

  it("Add to project with no card or firm: warned at once, the Team tab says the same, and the gate holds", async () => {
    const res = await add(mick);
    expect(res.status).toBe(201);
    expect(res.json.gateStanding).toEqual({ kind: "held", holds: true, text: HELD });
    const row = await rowOf(mick);
    expect(row.gateStanding).toEqual({ kind: "held", holds: true, text: HELD });
    expect(row.complianceStatus).toBe("none"); // never a green "Compliant" badge beside a held line
    const { gate } = await agrees(mick);
    expect(gate.json.holdReason).toBe("firm_unknown");
  });

  it("Give them a card as our own staff: the warning becomes 'no insurance check' and the gate lets him on, saying so", async () => {
    const row = await rowOf(mick);
    const res = await giveCard(row.id, { inHouse: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ reusedCard: false, gateStanding: { kind: "staff", holds: false, text: STAFF } });
    expect((await rowOf(mick)).complianceStatus).toBe("unchecked"); // never "Compliant" without a check
    const card = (await db.select().from(peopleTable).where(eq(peopleTable.id, res.json.personId)))[0];
    expect(card).toMatchObject({ userId: mick, companyId: co.companyId, subcontractorId: null, email: `${mick}@example.test` });
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    fd.append("phone", PHONE[mick]);
    const gate = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd }).then(async r => ({ status: r.status, json: await r.json() }));
    expect(gate.status).toBe(201);
    expect(gate.json.clearanceText).toBe("Cleared as in-house staff, no insurance check");
    await clearCheckins();
    const log = await db.select().from(activityLogTable).where(eq(activityLogTable.itemId, row.id));
    const meta = (m: unknown) => (typeof m === "string" ? JSON.parse(m) : m) as { gaveCard?: string } | null;
    expect(log.some(l => meta(l.metadata)?.gaveCard === "in_house")).toBe(true);
    // Once he has a card, there's nothing to give.
    expect((await giveCard(row.id, { inHouse: true })).status).toBe(409);
  });

  it("Give them a card at a firm: the gate checks that firm, and the Team tab shows the same verdict", async () => {
    await add(paul);
    const pRow = await rowOf(paul);
    const p = await giveCard(pRow.id, { subcontractorId: uncovered });
    expect(p.json.gateStanding).toMatchObject({ kind: "firm", holds: true });
    expect(p.json.gateStanding.text).toBe("Gate: will hold. No public liability insurance on file.");
    expect((await agrees(paul)).gate.json.holdReason).toBe("insurance_none");
    expect((await rowOf(paul)).complianceStatus).not.toBe("ok"); // no green badge while the gate holds him

    await add(rita);
    const r = await giveCard((await rowOf(rita)).id, { subcontractorId: covered });
    expect(r.json.gateStanding).toMatchObject({ kind: "firm", holds: false });
    expect(r.json.gateStanding.text).toMatch(/^Gate: lets on\. Public liability to /);
    expect((await agrees(rita)).gate.json.clearanceText).toMatch(/^Cleared: public liability to /);
    expect((await rowOf(rita)).complianceStatus).toBe("ok"); // checked and covered: the only "Compliant"
  });

  it("a login that already holds an in-house card at the company is staff when added by account", async () => {
    const res = await add(ivan);
    expect(res.json.gateStanding).toEqual({ kind: "staff", holds: false, text: STAFF });
    expect((await agrees(ivan)).gate.status).toBe(201);
  });

  it("refuses a muddled request, and a firm from another company", async () => {
    const row = await rowOf(ivan);
    expect((await giveCard(row.id, {})).status).toBe(400);
    expect((await giveCard(row.id, { inHouse: true, subcontractorId: covered })).status).toBe(400);
    expect((await giveCard(row.id, { subcontractorId: foreign })).status).toBe(404);
  });
});
