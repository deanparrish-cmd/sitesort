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
 * Borrowed phone on the QR site board. 2026-10-21 (#152): a phone that saw
 * two people lost one-tap for good, and device sign-out needed the last 4
 * digits. 2026-10-22 (Dean, from testing at the gate): ROLLING instead. A
 * phone offers one-tap only if a single person has checked in on it in the
 * last 7 days; once a week passes with only one person, it comes back. And
 * because a one-tap phone is now a personal phone, sign-out is the name on
 * screen plus a tap, no digits. Same person = same card, same name and
 * company, or a mobile in common (one man on two cards for two firms).
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
  const signInAs = async (phone: string, held?: string, company?: string, extra: Record<string, string> = {}) =>
    checkIn({ matchToken: await matchFor(phone, company), ...(held ? { heldDeviceToken: held } : {}), ...extra });
  // The phone's signed 7-day list, as the server would have written it.
  const history = (entries: { person?: string; ageDays: number; other?: boolean }[]) =>
    jwt.sign({ kind: "site-device-history", projectId: co.projectId, e: entries.map(x => ({
      at: Date.now() - x.ageDays * 86400_000, key: x.person ? `person:${x.person}` : null, nh: null, ...(x.other ? { other: true } : {}),
    })) }, process.env.JWT_SECRET as string);
  const entriesOf = (tok: string) => (jwt.decode(tok) as any).e as { at: number; key: string | null }[];
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
    expect((await checkIn({ deviceToken: fresh })).status).toBe(201);
    expect((await checkOut({ deviceToken: old })).status).toBe(403);
    expect((await checkOut({ deviceToken: fresh })).status).toBe(200);
  });

  it("a fresh phone: one-tap token plus a 7-day list naming nobody", async () => {
    const a = await signInAs(AMY);
    expect(a.json.deviceToken).toBeTruthy();
    expect(a.json.sharedDevice).toBeUndefined();
    const e = entriesOf(a.json.deviceHistory);
    expect(e).toHaveLength(1);
    expect(e[0].key).toBe(`person:${amy}`);
    expect(JSON.stringify(jwt.decode(a.json.deviceHistory))).not.toContain("Amy"); // names are hashed
    expect((await checkOut({ phone: AMY })).status).toBe(200);
  });

  it("a second person within 7 days: no one-tap, and the list carries both", async () => {
    const b = await signInAs(BOB, undefined, undefined, { deviceHistory: history([{ person: amy, ageDays: 2 }]) });
    expect(b.status).toBe(201);
    expect(b.json.sharedDevice).toBe(true);
    expect(b.json.deviceToken).toBeUndefined();
    expect(entriesOf(b.json.deviceHistory).map(x => x.key)).toEqual([`person:${amy}`, `person:${bob}`]);
    expect((await checkOut({ phone: BOB })).status).toBe(200);
    // Amy back on it the next day: Bob is still inside the window, still no one-tap.
    const a = await signInAs(AMY, undefined, undefined, { deviceHistory: b.json.deviceHistory });
    expect(a.json.sharedDevice).toBe(true);
    expect((await checkOut({ phone: AMY })).status).toBe(200);
  });

  it("once 7 days pass with only one person, one-tap comes back (the lender gets his phone back)", async () => {
    const back = await signInAs(AMY, undefined, undefined, { deviceHistory: history([{ person: bob, ageDays: 8 }, { person: amy, ageDays: 3 }]) });
    expect(back.json.deviceToken).toBeTruthy();
    expect(back.json.sharedDevice).toBeUndefined();
    expect(entriesOf(back.json.deviceHistory).map(x => x.key)).toEqual([`person:${amy}`, `person:${amy}`]); // Bob has dropped off
    expect((await checkOut({ phone: AMY })).status).toBe(200);
    const notYet = await signInAs(AMY, undefined, undefined, { deviceHistory: history([{ person: bob, ageDays: 6 }]) });
    expect(notYet.json.sharedDevice).toBe(true);
    expect((await checkOut({ phone: AMY })).status).toBe(200);
  });

  it("a phone with no list yet: the remembered token counts only if it is within 7 days", async () => {
    expect((await signInAs(BOB, devToken(amy, "Amy Parrish", `Firm X ${sfx}`, 3))).json.sharedDevice).toBe(true);
    expect((await checkOut({ phone: BOB })).status).toBe(200);
    expect((await signInAs(BOB, devToken(amy, "Amy Parrish", `Firm X ${sfx}`, 30))).json.deviceToken).toBeTruthy();
    expect((await checkOut({ phone: BOB })).status).toBe(200);
  });

  it("a phone marked shared under the old permanent rule starts a fresh 7-day window", async () => {
    const now = await signInAs(AMY, undefined, undefined, { legacyShared: "1" });
    expect(now.json.sharedDevice).toBe(true);
    expect((await checkOut({ phone: AMY })).status).toBe(200);
    const later = await signInAs(AMY, undefined, undefined, { deviceHistory: history([{ other: true, ageDays: 8 }, { person: amy, ageDays: 1 }]) });
    expect(later.json.deviceToken).toBeTruthy();
    expect((await checkOut({ phone: AMY })).status).toBe(200);
  });

  it("a forged or tampered list is ignored (the phone is judged on what it can prove)", async () => {
    const forged = jwt.sign({ kind: "site-device-history", projectId: co.projectId, e: [] }, "not-the-secret");
    const r = await signInAs(BOB, devToken(amy, "Amy Parrish", `Firm X ${sfx}`, 1), undefined, { deviceHistory: forged });
    expect(r.json.sharedDevice).toBe(true);
    expect((await checkOut({ phone: BOB })).status).toBe(200);
  });

  it("the same person keeps one tap, including one man on two cards for two firms with the same mobile", async () => {
    const amyAgain = await signInAs(AMY, undefined, undefined, { deviceHistory: history([{ person: amy, ageDays: 1 }]) });
    expect(amyAgain.json.deviceToken).toBeTruthy();
    expect((await checkOut({ phone: AMY })).status).toBe(200);
    const danAtY = await signInAs(DAN, undefined, `Firm Y ${sfx}`, { deviceHistory: history([{ person: danX, ageDays: 1 }]) });
    expect(danAtY.status).toBe(201);
    expect(danAtY.json.companyName).toBe(`Firm Y ${sfx}`);
    expect(danAtY.json.deviceToken).toBeTruthy();
    expect(danAtY.json.sharedDevice).toBeUndefined();
    expect((await checkOut({ phone: DAN })).status).toBe(200);
  });

  it("a held check-in approved later: judged against the phone's 7-day list", async () => {
    const hist = history([{ person: amy, ageDays: 1 }]);
    const held = await checkIn({ phone: "07700 900111", workerName: "Vic Visitor", companyName: "Visit Ltd", deviceHistory: hist });
    expect(held.status).toBe(403);
    const row = (await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.workerName, "Vic Visitor")))[0];
    expect((await api(`/projects/${co.projectId}/checkins/${row.id}/hold-decision`, { method: "POST", token: admin, body: { decision: "approve", note: "Known" } })).status).toBe(200);
    const poll = await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(held.json.holdToken)}&deviceHistory=${encodeURIComponent(hist)}`);
    expect(poll.json.status).toBe("approved");
    expect(poll.json.sharedDevice).toBe(true);
    expect(poll.json.deviceHistory).toBeTruthy();
    const plain = await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(held.json.holdToken)}`);
    expect(plain.json.deviceToken).toBeTruthy();
    await checkOut({ phone: "07700 900111" });
  });

  it("sign-out on a one-tap phone needs no digits: the tap after the name signs that person out", async () => {
    const t = (await signInAs(AMY)).json.deviceToken as string;
    const ok = await checkOut({ deviceToken: t });
    expect(ok.status).toBe(200);
    expect(ok.json.workerName).toBe("Amy Parrish");
    const open = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.workerName, "Amy Parrish"));
    expect(open.every(r => !!r.checkedOutAt)).toBe(true);
  });

  it("someone with no mobile on file can sign out from their own one-tap phone", async () => {
    await db.insert(siteCheckinsTable).values({ id: randomUUID(), projectId: co.projectId, workerName: "Nora Nophone", companyName: `Firm X ${sfx}`, personKey: `person:${nophone}`, photoUrl: "/api/uploads/x.jpg" });
    expect((await checkOut({ deviceToken: devToken(nophone, "Nora Nophone", `Firm X ${sfx}`) })).status).toBe(200);
  });

  it("an invalid or expired device token still can't sign anyone out", async () => {
    expect((await checkOut({ deviceToken: "junk" })).status).toBe(403);
  });
});
