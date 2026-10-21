import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable, insuranceRecordsTable, notificationsTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * Borrowed phone on the QR site board (Dean, 2026-10-21; workers use their
 * own phones). A remembered phone lasts 7 days; a phone that has seen two
 * different people stops being remembered for good (same mobile on file =
 * same person, so one man on two cards for two firms keeps one tap); signing
 * out with a remembered phone needs the last 4 digits of the mobile, because
 * signing out the wrong person empties the fire roll.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

describe("borrowed phone guard", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const subA = `tsub-a-${sfx}`, subB = `tsub-b-${sfx}`;
  const amy = `tper-amy-${sfx}`, bob = `tper-bob-${sfx}`, danX = `tper-danx-${sfx}`, danY = `tper-dany-${sfx}`, nophone = `tper-np-${sfx}`;
  const AMY = "07700 900456", BOB = "07700 900789", DAN = "07700 900321";

  async function checkIn(fields: Record<string, string>) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const matchFor = async (phone: string, company?: string) => {
    const m = (await api(`/site/${qrToken}/identify`, { method: "POST", body: { phone } })).json.matches as { label: string; matchToken: string }[];
    return (company ? m.find(x => x.label.endsWith(company)) : m[0])!.matchToken;
  };
  const checkOut = (body: object) => api(`/site/${qrToken}/checkout`, { method: "POST", body });
  const signInAs = async (phone: string, held?: string, company?: string) => checkIn({ matchToken: await matchFor(phone, company), ...(held ? { heldDeviceToken: held } : {}) });
  const devToken = (person: string, name: string, company: string, ageDays = 0) =>
    jwt.sign({ kind: "site-device", projectId: co.projectId, workerName: name, companyName: company, key: `person:${person}`, iat: Math.floor(Date.now() / 1000) - ageDays * 86400 }, process.env.JWT_SECRET as string);

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["general"] } })).json[0].token;
    await db.insert(subcontractorsTable).values([
      { id: subA, companyId: co.companyId, companyName: `Firm X ${sfx}`, contactName: "X Office", contactEmail: `x-${sfx}@example.test` },
      { id: subB, companyId: co.companyId, companyName: `Firm Y ${sfx}`, contactName: "Y Office", contactEmail: `y-${sfx}@example.test` },
    ]);
    await db.insert(peopleTable).values([
      { id: amy, companyId: co.companyId, name: "Amy Parrish", email: `amy-${sfx}@example.test`, phone: AMY, subcontractorId: subA },
      { id: bob, companyId: co.companyId, name: "Bob Builder", email: `bob-${sfx}@example.test`, phone: BOB, subcontractorId: subA },
      // One man, two firms, two cards, the same mobile.
      { id: danX, companyId: co.companyId, name: "Dan Two", email: `danx-${sfx}@example.test`, phone: DAN, subcontractorId: subA },
      { id: danY, companyId: co.companyId, name: "Dan Two", email: `dany-${sfx}@example.test`, phone: DAN, subcontractorId: subB },
      { id: nophone, companyId: co.companyId, name: "Nora Nophone", email: `nora-${sfx}@example.test`, subcontractorId: subA },
    ] as any);
    for (const p of [amy, bob, danX, danY, nophone]) await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, personId: p } as any);
    for (const s of [subA, subB]) await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: s, type: "public_liability", certificateUrl: "/api/uploads/x.pdf", expiryDate: "2099-01-01" } as any);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, [subA, subB]));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(inArray(peopleTable.id, [amy, bob, danX, danY, nophone]));
    await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, [subA, subB]));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("a remembered phone lasts 7 days: an 8-day-old token is refused, a 6-day-old one works", async () => {
    const old = devToken(amy, "Amy Parrish", `Firm X ${sfx}`, 8);
    expect((await api(`/site/${qrToken}/device?deviceToken=${encodeURIComponent(old)}`)).json.valid).toBe(false);
    expect((await checkIn({ deviceToken: old })).status).toBe(403);
    const fresh = devToken(amy, "Amy Parrish", `Firm X ${sfx}`, 6);
    const ok = await checkIn({ deviceToken: fresh });
    expect(ok.status).toBe(201);
    // ...and sign-out with the 8-day-old one is refused even with the right digits.
    expect((await checkOut({ deviceToken: old, last4: "0456" })).status).toBe(403);
    expect((await checkOut({ deviceToken: fresh, last4: "0456" })).status).toBe(200);
  });

  it("a different person on a remembered phone: 'shared device', no token", async () => {
    const amyPhone = devToken(amy, "Amy Parrish", `Firm X ${sfx}`);
    const b = await signInAs(BOB, amyPhone);
    expect(b.status).toBe(201);
    expect(b.json.sharedDevice).toBe(true);
    expect(b.json.deviceToken).toBeUndefined();
    expect((await checkOut({ phone: BOB })).status).toBe(200);
  });

  it("an expired token still counts as who used the phone before", async () => {
    const b = await signInAs(BOB, devToken(amy, "Amy Parrish", `Firm X ${sfx}`, 30));
    expect(b.json.sharedDevice).toBe(true);
    expect((await checkOut({ phone: BOB })).status).toBe(200);
  });

  it("the same person keeps one tap, including one man on two cards for two firms with the same mobile", async () => {
    const amyAgain = await signInAs(AMY, devToken(amy, "Amy Parrish", `Firm X ${sfx}`));
    expect(amyAgain.json.deviceToken).toBeTruthy();
    expect(amyAgain.json.sharedDevice).toBeUndefined();
    expect((await checkOut({ phone: AMY })).status).toBe(200);
    const danAtY = await signInAs(DAN, devToken(danX, "Dan Two", `Firm X ${sfx}`), `Firm Y ${sfx}`);
    expect(danAtY.status).toBe(201);
    expect(danAtY.json.companyName).toBe(`Firm Y ${sfx}`);
    expect(danAtY.json.deviceToken).toBeTruthy();
    expect(danAtY.json.sharedDevice).toBeUndefined();
    expect((await checkOut({ phone: DAN })).status).toBe(200);
  });

  it("a held check-in approved later: compared with who used the phone before", async () => {
    const amyPhone = devToken(amy, "Amy Parrish", `Firm X ${sfx}`);
    const held = await checkIn({ phone: "07700 900111", workerName: "Vic Visitor", companyName: "Visit Ltd", heldDeviceToken: amyPhone });
    expect(held.status).toBe(403);
    const row = (await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.workerName, "Vic Visitor")))[0];
    expect((await api(`/projects/${co.projectId}/checkins/${row.id}/hold-decision`, { method: "POST", token: admin, body: { decision: "approve", note: "Known" } })).status).toBe(200);
    const poll = await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(held.json.holdToken)}&heldDeviceToken=${encodeURIComponent(amyPhone)}`);
    expect(poll.json.status).toBe("approved");
    expect(poll.json.sharedDevice).toBe(true);
    expect(poll.json.deviceToken).toBeUndefined();
    // Without a previous person on the phone, the approval hands back a token as before.
    const plain = await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(held.json.holdToken)}`);
    expect(plain.json.deviceToken).toBeTruthy();
    await checkOut({ phone: "07700 900111" });
  });

  it("remembered-phone sign-out needs the last 4 digits; wrong ones are refused; the right ones sign out", async () => {
    const t = (await signInAs(AMY)).json.deviceToken as string;
    const noDigits = await checkOut({ deviceToken: t });
    expect(noDigits.status).toBe(400);
    expect(noDigits.json.error).toBe("last4_required");
    const wrong = await checkOut({ deviceToken: t, last4: "1111" });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error).toBe("wrong_digits");
    const open = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.workerName, "Amy Parrish"));
    expect(open.some(r => !r.checkedOutAt)).toBe(true);
    const ok = await checkOut({ deviceToken: t, last4: "0456" });
    expect(ok.status).toBe(200);
  });

  it("5 wrong tries lock that phone's sign-out, even with the right digits", async () => {
    const t = (await signInAs(BOB)).json.deviceToken as string;
    for (let i = 0; i < 5; i++) expect((await checkOut({ deviceToken: t, last4: "0000" })).status).toBe(403);
    const locked = await checkOut({ deviceToken: t, last4: "0789" });
    expect(locked.status).toBe(429);
    expect(locked.json.message).toMatch(/full mobile number/);
    expect((await checkOut({ phone: BOB })).status).toBe(200);
  });

  it("no mobile on file: remembered-phone sign-out is refused with the way out", async () => {
    await db.insert(siteCheckinsTable).values({ id: randomUUID(), projectId: co.projectId, workerName: "Nora Nophone", companyName: `Firm X ${sfx}`, personKey: `person:${nophone}`, photoUrl: "/api/uploads/x.jpg" });
    const res = await checkOut({ deviceToken: devToken(nophone, "Nora Nophone", `Firm X ${sfx}`), last4: "1234" });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("no_number_on_file");
    expect(res.json.message).toBe("Enter your full mobile number to sign out, or ask the site manager.");
  });
});
