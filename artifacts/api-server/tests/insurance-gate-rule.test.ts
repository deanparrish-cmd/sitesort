import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable, insuranceRecordsTable,
  personCertificationsTable, notificationsTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";
import { verdictFrom, suggestCertType } from "../src/lib/insurance";

/**
 * Dean, prod, 2026-10-22: held at the gate for "no insurance on file" while his
 * card showed green "Public liability" (to 1 Jan 2027) and "Certs". The gate
 * counted a person certificate as insurance only if its typed NAME contained
 * "insur": a covered man refused, and "Car insurance" would have let anyone on.
 * Now: certificates have a TYPE a manager sets or confirms; covered = an
 * in-date public liability (firm record or confirmed certificate), latest one
 * wins; the card shows the gate's own verdict.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

describe("one insurance rule for the gate and the card", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const deanSub = `tsub-dean-${sfx}`, renewedSub = `tsub-ren-${sfx}`, elSub = `tsub-el-${sfx}`;
  const deanPerson = `tper-dean-${sfx}`;
  const PHONE = { dean: "07700 900201", renewed: "07700 900202", el: "07700 900203" };

  async function checkIn(phone: string) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    fd.append("phone", phone);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const clearCheckins = () => db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
  const deanCerts = () => api(`/people/${deanPerson}/certifications`, { token: admin });
  const contact = async (id: string) => ((await api("/subcontractors", { token: admin })).json as any[]).find(s => s.id === id);

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    await db.insert(subcontractorsTable).values([
      { id: deanSub, companyId: co.companyId, companyName: "Dean's Diggers", contactName: "Dean Digger", contactEmail: `dean-${sfx}@example.test`, contactPhone: PHONE.dean },
      { id: renewedSub, companyId: co.companyId, companyName: "Renewed Ltd", contactName: "Rita Renewed", contactEmail: `rita-${sfx}@example.test`, contactPhone: PHONE.renewed },
      { id: elSub, companyId: co.companyId, companyName: "Employers Only Ltd", contactName: "Eli Employer", contactEmail: `eli-${sfx}@example.test`, contactPhone: PHONE.el },
    ]);
    // Dean's Diggers: no firm records; Dean's own card has two certificates
    // added before typing existed (no type), exactly as on prod.
    await db.insert(peopleTable).values({ id: deanPerson, companyId: co.companyId, name: "Dean Digger", email: `deanp-${sfx}@example.test`, subcontractorId: deanSub, isPrimaryContact: true } as any);
    await db.insert(personCertificationsTable).values([
      { id: randomUUID(), personId: deanPerson, name: "Certs", expiryDate: "2026-12-31", createdBy: co.userId },
      { id: randomUUID(), personId: deanPerson, name: "Public liability", expiryDate: "2027-01-01", createdBy: co.userId },
    ] as any);
    // Renewed Ltd: last year's public liability never archived, plus the renewal.
    await db.insert(insuranceRecordsTable).values([
      { id: randomUUID(), subcontractorId: renewedSub, type: "public_liability", certificateUrl: "/api/uploads/old.pdf", expiryDate: day(-30) },
      { id: randomUUID(), subcontractorId: renewedSub, type: "public_liability", certificateUrl: "/api/uploads/new.pdf", expiryDate: day(300) },
      { id: randomUUID(), subcontractorId: elSub, type: "employers_liability", certificateUrl: "/api/uploads/el.pdf", expiryDate: day(300) },
    ] as any);
    for (const sub of [deanSub, renewedSub, elSub]) await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: sub } as any);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await clearCheckins();
    await db.delete(personCertificationsTable).where(eq(personCertificationsTable.personId, deanPerson));
    await db.delete(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, [deanSub, renewedSub, elSub]));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(eq(peopleTable.id, deanPerson));
    await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, [deanSub, renewedSub, elSub]));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("the rule itself: only public liability decides, the latest one wins, a name decides nothing", () => {
    expect(verdictFrom([], [{ certType: null, expiryDate: day(300) }])).toMatchObject({ status: "none", holds: true, unconfirmedCerts: 1 });
    expect(verdictFrom([{ type: "public_liability", expiryDate: day(-10) }, { type: "public_liability", expiryDate: day(200) }], [])).toMatchObject({ status: "valid", holds: false });
    expect(verdictFrom([{ type: "public_liability", expiryDate: day(-10) }], [])).toMatchObject({ status: "expired", holds: true });
    expect(verdictFrom([{ type: "employers_liability", expiryDate: day(200) }], [{ certType: "other_insurance", expiryDate: day(200) }])).toMatchObject({ status: "none", holds: true });
    expect(verdictFrom([], [{ certType: "public_liability", expiryDate: day(10) }])).toMatchObject({ status: "expiring_soon", holds: false });
    expect(suggestCertType("Public liability")).toBe("public_liability");
    expect(suggestCertType("PLI 2026")).toBe("public_liability");
    expect(suggestCertType("Employers Liability")).toBe("employers_liability");
    expect(suggestCertType("Car insurance")).toBe("other_insurance");
    expect(suggestCertType("Certs")).toBe("qualification");
  });

  it("Dean's case: untyped certificates don't count, so he's held, and his card says so", async () => {
    const r = await checkIn(PHONE.dean);
    expect(r.status).toBe(403);
    expect(r.json.holdReason).toBe("insurance_none");
    const c = await contact(deanSub);
    expect(c.insuranceStatus).toBe("none");
    expect(c.gateVerdict).toMatchObject({ holds: true, unconfirmedCerts: 2 });
    expect(c.gateVerdict.reason).toBe("Gate: will hold. No public liability insurance on file. 2 certificates are waiting for a manager to confirm the type.");
    const certs = (await deanCerts()).json as any[];
    expect(certs.find(x => x.name === "Public liability")).toMatchObject({ certType: null, suggestedType: "public_liability" });
    expect(certs.find(x => x.name === "Certs")).toMatchObject({ certType: null, suggestedType: "qualification" });
    const queue = (await api("/certifications/unconfirmed", { token: admin })).json as any[];
    expect(queue.filter(q => q.personId === deanPerson).map(q => q.suggestedType).sort()).toEqual(["public_liability", "qualification"]);
    await clearCheckins();
  });

  it("a PM confirms the type: the gate lets him on and the card agrees", async () => {
    const pl = ((await deanCerts()).json as any[]).find(x => x.name === "Public liability");
    const res = await api(`/people/${deanPerson}/certifications/${pl.id}/type`, { method: "PATCH", token: admin, body: { certType: "public_liability" } });
    expect(res.status).toBe(200);
    expect(res.json.certType).toBe("public_liability");
    const r = await checkIn(PHONE.dean);
    expect(r.status).toBe(201);
    const c = await contact(deanSub);
    expect(c.insuranceStatus).toBe("valid");
    expect(c.gateVerdict.reason).toBe("Gate: lets on. Public liability to 1 Jan 2027.");
    // The Team tab card reads the same verdict.
    const members = (await api(`/projects/${co.projectId}/members`, { token: admin })).json as any[];
    expect(members.find(m => m.subcontractorId === deanSub)?.gateVerdict).toMatchObject({ holds: false, status: "valid" });
    await clearCheckins();
  });

  it("calling a certificate something else never makes it insurance: typed as a qualification, it doesn't count", async () => {
    const pl = ((await deanCerts()).json as any[]).find(x => x.name === "Public liability");
    expect((await api(`/people/${deanPerson}/certifications/${pl.id}/type`, { method: "PATCH", token: admin, body: { certType: "qualification" } })).status).toBe(200);
    expect((await checkIn(PHONE.dean)).json.holdReason).toBe("insurance_none");
    await clearCheckins();
  });

  it("an old expired public liability nobody archived no longer blocks the renewal", async () => {
    expect((await checkIn(PHONE.renewed)).status).toBe(201);
    expect((await contact(renewedSub)).gateVerdict).toMatchObject({ holds: false, status: "valid" });
    await clearCheckins();
  });

  it("employer's liability alone isn't public liability: held", async () => {
    expect((await checkIn(PHONE.el)).json.holdReason).toBe("insurance_none");
    await clearCheckins();
  });

  it("a new certificate must say what it is; a manager's choice counts at once", async () => {
    const bare = await api(`/people/${deanPerson}/certifications`, { method: "POST", token: admin, body: { name: "PL 2027", expiryDate: day(400) } });
    expect(bare.status).toBe(400);
    const typed = await api(`/people/${deanPerson}/certifications`, { method: "POST", token: admin, body: { name: "PL 2027", expiryDate: day(400), certType: "public_liability" } });
    expect(typed.status).toBe(201);
    expect(typed.json.certType).toBe("public_liability");
    expect((await checkIn(PHONE.dean)).status).toBe(201);
    await clearCheckins();
  });
});
