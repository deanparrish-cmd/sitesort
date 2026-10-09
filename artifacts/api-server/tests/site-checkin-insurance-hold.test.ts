import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, peopleTable, projectMembersTable,
  insuranceRecordsTable, notificationsTable, usersTable, companyMembersTable, projectsTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, dashboardToken, API_BASE, type Fixture } from "./helpers";
import { checkinState, runCheckinAutoClose } from "../src/routes/qr";
import { closeDueAfter, wallClockUtc } from "../src/lib/site-clock";

/**
 * #114: the check-in insurance gate covers EVERY way in (a subcontractor's own
 * portal login included), a failed check HOLDS the check-in for an admin / PM
 * decision that is recorded, expiry is judged against today, and the end-of-day
 * close never makes anyone vanish from today's register.
 * #124: people are identified by the mobile number on their record.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const dayStr = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe("site check-in insurance gate, hold + override, auto-close", () => {
  let co: Fixture;
  let admin = "";
  let worker = "";
  let qrToken = "";
  let ownCompany = "";
  const sfx = randomUUID().slice(0, 8);
  const uninsuredSub = `tsub-un-${sfx}`;
  const expiredSub = `tsub-ex-${sfx}`;
  const insuredSub = `tsub-ok-${sfx}`;
  const portalUserId = `tusr-portal-${sfx}`;
  const workerUserId = `tusr-worker-${sfx}`;
  const portalPersonId = `tper-portal-${sfx}`;

  const PHONE = { pat: "07700 900101", una: "07700900102", lee: "+44 7700 900103", cara: "07700-900-104", owner: "07700900105" };
  async function checkIn(phone: string, extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    fd.append("phone", phone);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const rowsFor = (name: string) => db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId)).then(r => r.filter(x => x.workerName === name));
  const count = async () => (await api(`/site/${qrToken}/on-site-count`)).json.count as number;

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    ownCompany = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0] ? `Test Co ${co.companyId.replace("test-co-", "")}` : "";
    const qr = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } });
    qrToken = qr.json[0].token;
    const owner = (await db.select().from(usersTable).where(eq(usersTable.id, co.userId)))[0];

    // Three cards: no insurance, insurance that lapsed last week, valid insurance.
    await db.insert(subcontractorsTable).values([
      { id: uninsuredSub, companyId: co.companyId, companyName: "Uninsured Ltd", contactName: "Una Nobody", contactEmail: `una-${sfx}@example.test`, contactPhone: PHONE.una },
      { id: expiredSub, companyId: co.companyId, companyName: "Lapsed Ltd", contactName: "Lee Lapsed", contactEmail: `lee-${sfx}@example.test`, contactPhone: PHONE.lee },
      { id: insuredSub, companyId: co.companyId, companyName: "Covered Ltd", contactName: "Cara Covered", contactEmail: `cara-${sfx}@example.test`, contactPhone: PHONE.cara },
    ]);
    await db.insert(insuranceRecordsTable).values([
      { id: randomUUID(), subcontractorId: expiredSub, type: "public_liability", certificateUrl: "/api/uploads/x.pdf", expiryDate: dayStr(-7) } as any,
      { id: randomUUID(), subcontractorId: insuredSub, type: "public_liability", certificateUrl: "/api/uploads/y.pdf", expiryDate: "2099-01-01" } as any,
    ]);
    for (const sub of [uninsuredSub, expiredSub, insuredSub]) {
      await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: sub } as any);
    }

    // A subcontractor who joined the Team Portal: a USER account whose project
    // membership points at a person on the UNINSURED card. This was the bypass.
    await db.insert(usersTable).values({ id: portalUserId, companyId: co.companyId, email: `portal-${sfx}@example.test`, passwordHash: owner.passwordHash, name: "Pat Portal", role: "subcontractor", emailVerified: true, portalOnly: true });
    await db.insert(peopleTable).values({ id: portalPersonId, companyId: co.companyId, name: "Pat Portal", email: `portal-${sfx}@example.test`, phone: PHONE.pat, subcontractorId: uninsuredSub, userId: portalUserId });
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: portalUserId, personId: portalPersonId } as any);

    // A site worker in the same company (not allowed to decide holds or change the site clock).
    await db.insert(usersTable).values({ id: workerUserId, companyId: co.companyId, email: `worker-${sfx}@example.test`, passwordHash: owner.passwordHash, name: "Wes Worker", role: "site_worker", emailVerified: true });
    await db.insert(companyMembersTable).values({ id: randomUUID(), userId: workerUserId, companyId: co.companyId, role: "site_worker" });
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: workerUserId } as any);
    worker = await dashboardToken(workerUserId, co.companyId, "site_worker", `worker-${sfx}@example.test`);

    // The owner is an in-house member of the project too.
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, userId: co.userId } as any);
    await db.update(usersTable).set({ phone: PHONE.owner }).where(eq(usersTable.id, co.userId));
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, workerUserId]));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, [uninsuredSub, expiredSub, insuredSub]));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(eq(peopleTable.id, portalPersonId));
    await db.delete(companyMembersTable).where(eq(companyMembersTable.userId, workerUserId));
    await db.delete(usersTable).where(inArray(usersTable.id, [portalUserId, workerUserId]));
    await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, [uninsuredSub, expiredSub, insuredSub]));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("a subcontractor's own portal login no longer skips the insurance check: held, not on site", async () => {
    const r = await checkIn(PHONE.pat);
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("check_in_held");
    expect(r.json.holdReason).toBe("insurance_none");
    expect(r.json.reason).toBe("no_valid_insurance"); // older pages show Access Denied
    const [row] = await rowsFor("Pat Portal");
    expect(row.holdStatus).toBe("pending");
    expect(row.personKey).toBe(`person:${portalPersonId}`);
    expect(await count()).toBe(0);
  });

  it("an unknown number can't pass as in-house staff by giving this company's name: held as unverified", async () => {
    const r = await checkIn("07700900199", { workerName: "Pat Portal", companyName: ownCompany });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("check_in_held");
    expect(r.json.holdReason).toBe("unverified");
    const rows = (await rowsFor("Pat Portal")).filter(x => x.holdReason === "unverified");
    expect(rows).toHaveLength(1);
    expect(rows[0].personKey).toBeNull(); // not a registered name + company
    expect(await count()).toBe(0);
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.id, rows[0].id));
  });

  it("a repeat attempt while waiting returns the same hold, not a second row", async () => {
    const r = await checkIn(PHONE.pat);
    expect(r.json.error).toBe("check_in_held");
    expect(await rowsFor("Pat Portal")).toHaveLength(1);
  });

  it("the contact-card path: no insurance holds; insurance that lapsed last week holds as expired; valid passes", async () => {
    expect((await checkIn(PHONE.una)).json.holdReason).toBe("insurance_none");
    const lapsed = await checkIn(PHONE.lee);
    expect(lapsed.status).toBe(403);
    expect(lapsed.json.holdReason).toBe("insurance_expired");
    const ok = await checkIn(PHONE.cara);
    expect(ok.status).toBe(201);
    expect(ok.json.presence).toBe("on_site");
    expect(ok.json.siteTzLabel).toBe("UK time");
    expect(await count()).toBe(1);
  });

  it("in-house staff check in by their mobile number without a subcontractor insurance check", async () => {
    const r = await checkIn(PHONE.owner);
    expect(r.status).toBe(201);
    expect(r.json.companyName).toBe(ownCompany);
  });

  it("only an admin / PM decides; approving needs a reason and is recorded; the worker's page sees it", async () => {
    const [held] = await rowsFor("Pat Portal");
    const path = `/projects/${co.projectId}/checkins/${held.id}/hold-decision`;
    expect((await api(path, { method: "POST", token: worker, body: { decision: "approve", note: "x" } })).status).toBe(403);
    expect((await api(path, { method: "POST", token: admin, body: { decision: "approve" } })).status).toBe(400);
    const ok = await api(path, { method: "POST", token: admin, body: { decision: "approve", note: "Cert seen on his phone, upload promised today" } });
    expect(ok.status).toBe(200);
    expect(ok.json.holdStatus).toBe("approved");
    expect(ok.json.presence).toBe("on_site");
    const [row] = await rowsFor("Pat Portal");
    expect(row.holdDecidedBy).toBe(co.userId);
    expect(row.holdNote).toMatch(/Cert seen/);
    expect(row.holdDecidedAt).toBeTruthy();
    // Can't be decided twice.
    expect((await api(path, { method: "POST", token: admin, body: { decision: "refuse" } })).status).toBe(409);

    // The worker's page polls with its hold token.
    const first = await checkIn(PHONE.una); // repeat -> same pending hold, fresh token
    const status = await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(first.json.holdToken)}`);
    expect(status.json.status).toBe("pending");
    const una = (await rowsFor("Una Nobody"))[0];
    await api(`/projects/${co.projectId}/checkins/${una.id}/hold-decision`, { method: "POST", token: admin, body: { decision: "refuse", note: "No cover" } });
    expect((await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(first.json.holdToken)}`)).json.status).toBe("refused");
    // Approved + insured on site; refused and still-pending don't count.
    expect(await count()).toBe(3);
  });

  it("site clock: only an admin / PM can change it, and it is validated", async () => {
    const path = `/projects/${co.projectId}`;
    expect((await api(path, { method: "PATCH", token: worker, body: { siteCloseTime: "16:00" } })).status).toBe(403);
    expect((await api(path, { method: "PATCH", token: admin, body: { siteTimeZone: "Mars/Olympus" } })).status).toBe(400);
    expect((await api(path, { method: "PATCH", token: admin, body: { siteCloseTime: "25:00" } })).status).toBe(400);
    const ok = await api(path, { method: "PATCH", token: admin, body: { siteTimeZone: "Europe/Madrid", siteCloseTime: "18:30" } });
    expect(ok.status).toBe(200);
    expect(ok.json.siteTimeZone).toBe("Europe/Madrid");
    expect(ok.json.siteCloseTime).toBe("18:30");
    await api(path, { method: "PATCH", token: admin, body: { siteTimeZone: "Europe/London", siteCloseTime: "20:00" } });
  });

  it("end of day: a stale open row is closed automatically, never as a sign-out, and stops counting", async () => {
    const before = await count();
    const id = randomUUID();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await db.insert(siteCheckinsTable).values({ id, projectId: co.projectId, workerName: "Stan Stale", companyName: "Covered Ltd", photoUrl: "/api/uploads/s.jpg", checkedInAt: threeDaysAgo, personKey: `sub:${insuredSub}-stale` });
    // Even before the job runs, a passed close time doesn't count as on site.
    expect(await count()).toBe(before);
    await runCheckinAutoClose();
    const [row] = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, id));
    expect(row.autoClosedAt).toBeTruthy();
    expect(row.checkedOutAt).toBeNull();
    const list = await api(`/projects/${co.projectId}/checkins`, { token: admin });
    const s = list.json.find((c: any) => c.id === id);
    expect(s.presence).toBe("auto_closed");
    expect(s.notSignedOut).toBe(true);
    // A manager can still record when they actually left.
    const out = await api(`/projects/${co.projectId}/checkins/${id}/sign-out`, { method: "POST", token: admin, body: { note: "Left at 17:00 that day" } });
    expect(out.status).toBe(200);
    expect(out.json.presence).toBe("signed_out");
  });
});

describe("check-in presence on the site clock (pure)", () => {
  const london = { tz: "Europe/London", close: "20:00" };
  it("closes at the first close time AFTER check-in, so a night shift isn't cut at once", () => {
    const morning = wallClockUtc("2026-10-07", "07:30", "Europe/London");
    expect(closeDueAfter(morning, "Europe/London", "20:00").toISOString()).toBe(wallClockUtc("2026-10-07", "20:00", "Europe/London").toISOString());
    const night = wallClockUtc("2026-10-07", "21:00", "Europe/London");
    expect(closeDueAfter(night, "Europe/London", "20:00").toISOString()).toBe(wallClockUtc("2026-10-08", "20:00", "Europe/London").toISOString());
  });

  it("a man working past the close time stays on today's register, marked, but isn't counted", () => {
    const inAt = wallClockUtc("2026-10-07", "07:30", "Europe/London");
    const at2030 = wallClockUtc("2026-10-07", "20:30", "Europe/London");
    const s = checkinState({ checkedInAt: inAt, checkedOutAt: null }, london, at2030);
    expect(s.presence).toBe("auto_closed_today");
    expect(s.onSite).toBe(false);
    expect(s.notSignedOut).toBe(true);
    const next = checkinState({ checkedInAt: inAt, checkedOutAt: null }, london, wallClockUtc("2026-10-08", "09:00", "Europe/London"));
    expect(next.presence).toBe("auto_closed");
    const before = checkinState({ checkedInAt: inAt, checkedOutAt: null }, london, wallClockUtc("2026-10-07", "19:59", "Europe/London"));
    expect(before.presence).toBe("on_site");
  });

  it("the same instant reads on each site's own clock", () => {
    const inAt = new Date("2026-10-07T06:30:00Z");
    expect(checkinState({ checkedInAt: inAt, checkedOutAt: null }, london, inAt).siteTzLabel).toBe("UK time");
    expect(checkinState({ checkedInAt: inAt, checkedOutAt: null }, { tz: "Europe/Madrid", close: "20:00" }, inAt).siteTzLabel).toBe("CEST time");
  });

  it("held, refused and lapsed rows are never on site", () => {
    const inAt = new Date();
    for (const holdStatus of ["pending", "refused", "lapsed"]) {
      expect(checkinState({ checkedInAt: inAt, checkedOutAt: null, holdStatus }, london, inAt).onSite).toBe(false);
    }
    expect(checkinState({ checkedInAt: inAt, checkedOutAt: null, holdStatus: "approved" }, london, inAt).onSite).toBe(true);
  });
});
