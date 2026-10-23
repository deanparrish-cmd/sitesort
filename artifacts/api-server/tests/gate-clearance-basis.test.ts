import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable, insuranceRecordsTable,
  personCertificationsTable, notificationsTable, usersTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * Dean, prod, 2026-10-22 (#162 live): Amy's and Annabelle's cards said "Gate:
 * will hold. No public liability insurance on file.", yet both were "VERIFIED,
 * cleared to enter site" at the QR gate. The rule was shared; the identity step
 * wasn't: a matched record with no firm on it skipped the insurance check (as
 * if staff) even when the same human had a firm card, and a login's firm came
 * from the team row before the person (the card uses the person's).
 * Now: staff is a positive fact, anything else without a firm is held, and
 * every clearance records its grounds, shown in the Site Register.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const ukDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

describe("the gate never clears by default, and says on what grounds it cleared", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const uncovered = `tsub-unc-${sfx}`, covered = `tsub-cov-${sfx}`;
  const amyUser = `tuser-amy-${sfx}`, bobUser = `tuser-bob-${sfx}`, strayUser = `tuser-stray-${sfx}`;
  const amyInHouse = `tper-amyih-${sfx}`, amyFirmCard = `tper-amyfc-${sfx}`, bobPerson = `tper-bob-${sfx}`, ivy = `tper-ivy-${sfx}`, cara = `tper-cara-${sfx}`;
  const PHONE = { amy: "07700 900301", bob: "07700 900302", admin: "07700 900303", ivy: "07700 900304", stray: "07700 900305", cara: "07700 900306" };
  const PLI = day(200);

  async function checkIn(body: Record<string, string>) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    for (const [k, v] of Object.entries(body)) fd.append(k, v);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async function identify(phone: string) {
    const res = await fetch(`${API_BASE}/site/${qrToken}/identify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
    return (await res.json()).matches as { label: string; matchToken: string }[];
  }
  const register = async () => (await api(`/projects/${co.projectId}/site-register`, { token: admin })).json;
  const clearCheckins = () => db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    await db.update(usersTable).set({ phone: PHONE.admin }).where(eq(usersTable.id, co.userId));
    await db.insert(subcontractorsTable).values([
      { id: uncovered, companyId: co.companyId, companyName: "Uncovered Ltd", contactName: "Una Covered", contactEmail: `una-${sfx}@example.test` },
      { id: covered, companyId: co.companyId, companyName: "Covered Ltd", contactName: "Cara Covered", contactEmail: `cara-${sfx}@example.test` },
    ]);
    await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: covered, type: "public_liability", certificateUrl: "/api/uploads/pl.pdf", expiryDate: PLI } as any);
    // Portal-only logins, homed at this company (as a portal invite does).
    await db.insert(usersTable).values([
      { id: amyUser, companyId: co.companyId, email: `amy-${sfx}@example.test`, passwordHash: "x", name: "Amy Parrish", role: "site_worker", portalOnly: true, phone: PHONE.amy },
      { id: bobUser, companyId: co.companyId, email: `bob-${sfx}@example.test`, passwordHash: "x", name: "Bob Builder", role: "site_worker", portalOnly: true, phone: PHONE.bob },
      { id: strayUser, companyId: co.companyId, email: `stray-${sfx}@example.test`, passwordHash: "x", name: "Sam Stray", role: "site_worker", portalOnly: true, phone: PHONE.stray },
    ] as any);
    await db.insert(peopleTable).values([
      // Amy: her login sits on an in-house card (no firm) AND she has a card at
      // Uncovered Ltd with an untyped certificate: the card says "will hold".
      { id: amyInHouse, companyId: co.companyId, name: "Amy Parrish", email: `amy-${sfx}@example.test` },
      { id: amyFirmCard, companyId: co.companyId, name: "Amy Parrish", email: `amy-${sfx}@example.test`, subcontractorId: uncovered, userId: amyUser },
      // Bob: his person is at Uncovered Ltd, but his team row names Covered Ltd.
      { id: bobPerson, companyId: co.companyId, name: "Bob Builder", email: `bob-${sfx}@example.test`, subcontractorId: uncovered, userId: bobUser },
      // Ivy: genuine in-house staff, added with no firm, no login.
      { id: ivy, companyId: co.companyId, name: "Ivy Inhouse", email: `ivy-${sfx}@example.test`, phone: PHONE.ivy },
      // Cara: Covered Ltd's primary contact.
      { id: cara, companyId: co.companyId, name: "Cara Covered", email: `carap-${sfx}@example.test`, phone: PHONE.cara, subcontractorId: covered, isPrimaryContact: true },
    ] as any);
    await db.insert(personCertificationsTable).values({ id: randomUUID(), personId: amyFirmCard, name: "Public liability", expiryDate: day(300), createdBy: co.userId } as any);
    await db.insert(projectMembersTable).values([
      { id: randomUUID(), projectId: co.projectId, userId: amyUser, personId: amyInHouse },
      { id: randomUUID(), projectId: co.projectId, personId: amyFirmCard },
      { id: randomUUID(), projectId: co.projectId, userId: bobUser, personId: bobPerson, subcontractorId: covered },
      { id: randomUUID(), projectId: co.projectId, personId: ivy },
      { id: randomUUID(), projectId: co.projectId, personId: cara },
      { id: randomUUID(), projectId: co.projectId, userId: co.userId },
      { id: randomUUID(), projectId: co.projectId, userId: strayUser },
    ] as any);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await clearCheckins();
    await db.delete(personCertificationsTable).where(eq(personCertificationsTable.personId, amyFirmCard));
    await db.delete(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, [uncovered, covered]));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(inArray(peopleTable.id, [amyInHouse, amyFirmCard, bobPerson, ivy, cara]));
    await db.delete(usersTable).where(inArray(usersTable.id, [amyUser, bobUser, strayUser]));
    await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, [uncovered, covered]));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("Amy: tapping her in-house identity no longer skips the check her firm card fails", async () => {
    const matches = await identify(PHONE.amy);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const r = await checkIn({ matchToken: m.matchToken });
      expect({ label: m.label, status: r.status, holdReason: r.json?.holdReason }).toEqual({ label: m.label, status: 403, holdReason: "insurance_none" });
      await clearCheckins();
    }
    // Straight from the number too.
    expect((await checkIn({ phone: PHONE.amy })).json.holdReason).toBe("insurance_none");
    await clearCheckins();
  });

  it("Bob: the gate judges the same firm as his card (the person's), not the team row's", async () => {
    const r = await checkIn({ phone: PHONE.bob });
    expect(r.status).toBe(403);
    expect(r.json.holdReason).toBe("insurance_none");
    const members = (await api(`/projects/${co.projectId}/members`, { token: admin })).json as any[];
    expect(members.find(m => m.personId === bobPerson)?.gateVerdict).toMatchObject({ holds: true });
    await clearCheckins();
  });

  it("a login with no firm and no staff standing is held, never cleared by default", async () => {
    const r = await checkIn({ phone: PHONE.stray });
    expect(r.status).toBe(403);
    expect(r.json.holdReason).toBe("firm_unknown");
    const reg = await register();
    expect(reg.held.find((h: any) => h.workerName === "Sam Stray")?.why).toMatch(/aren't linked to a firm/);
    // A manager lets him on: the register says so, with the reason.
    const held = reg.held.find((h: any) => h.workerName === "Sam Stray");
    expect((await api(`/projects/${co.projectId}/checkins/${held.id}/hold-decision`, { method: "POST", token: admin, body: { decision: "approve", note: "Works for us this week" } })).status).toBe(200);
    const row = (await register()).onSite.find((x: any) => x.workerName === "Sam Stray");
    expect(row).toMatchObject({ clearance: "Let on by a manager after a hold: Works for us this week", insuranceChecked: false });
    await clearCheckins();
  });

  it("grounds are recorded and shown: public liability with its date, staff as unchecked", async () => {
    const c = await checkIn({ phone: PHONE.cara });
    expect(c.status).toBe(201);
    expect(c.json.clearanceText).toBe(`Cleared: public liability to ${ukDate(PLI)}`);
    const i = await checkIn({ phone: PHONE.ivy });
    expect(i.status).toBe(201);
    expect(i.json.clearanceText).toBe("Cleared as in-house staff, no insurance check");
    const a = await checkIn({ phone: PHONE.admin });
    expect(a.status).toBe(201);
    expect(a.json.clearanceText).toBe("Cleared as in-house staff, no insurance check");

    const stored = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    expect(stored.map(s => [s.workerName, s.clearanceBasis, s.clearancePliExpiry]).sort()).toEqual([
      ["Cara Covered", "public_liability", PLI], ["Ivy Inhouse", "in_house_staff", null], [`Test User ${co.email.slice(8, 16)}`, "in_house_staff", null],
    ].sort());
    const reg = await register();
    expect(reg.onSite.find((x: any) => x.workerName === "Cara Covered")).toMatchObject({ clearance: `Cleared: public liability to ${ukDate(PLI)}`, insuranceChecked: true });
    expect(reg.onSite.find((x: any) => x.workerName === "Ivy Inhouse")).toMatchObject({ clearance: "Cleared as in-house staff, no insurance check", insuranceChecked: false });
    // The dashboard Check-ins list carries the same line.
    const list = (await api(`/projects/${co.projectId}/checkins`, { token: admin })).json as any[];
    expect(list.find((x: any) => x.workerName === "Ivy Inhouse")?.clearanceText).toBe("Cleared as in-house staff, no insurance check");
    await clearCheckins();
  });
});
