import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@workspace/db";
import { and, eq, like, inArray } from "drizzle-orm";
import { pushSubscriptionsTable, pushAlertsTable, portalSessionsTable, projectsTable, siteCheckinsTable, qrCodesTable, notificationsTable } from "@workspace/db/schema";
import {
  API_BASE, seedCompany, cleanupFixtures, login, api, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Phone alert receipts (2026-10-22). Dean, prod 2026-10-21: a gate hold went to
 * 4 phones, Apple accepted all 4, no banner appeared, and SiteSort could not
 * tell. Now every alert carries a receipt id the phone posts back, a test alert
 * asks "Did a banner appear?" (recorded for the PM), and a phone that stops
 * answering is removed after 7 in a row (only counting after its first reply).
 *
 * A local HTTPS server stands in for Apple's push service and decrypts each
 * payload with the phone's keys. The API under test must accept its
 * self-signed certificate: run it with NODE_TLS_REJECT_UNAUTHORIZED=0 (only
 * for the :8090 test copy), else the send-dependent tests are skipped.
 */
const ece = createRequire(createRequire(import.meta.url).resolve("web-push"))("http_ece");

describe("phone alert receipts", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let other: PortalMemberFixture;
  let tok = "", otherTok = "";
  let server: Server;
  let port = 0;
  const received: Array<{ path: string; payload: any }> = [];
  let pushReachable = false;

  // A phone: real P-256 keys so web-push can encrypt to it and we can decrypt.
  const phones = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();
  function phone(name: string) {
    const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
    const auth = randomBytes(16);
    const id = `${name}-${randomUUID()}`;
    phones.set(id, { ecdh, auth });
    return {
      id,
      endpoint: () => `https://localhost:${port}/push/${id}`,
      body: (ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile", swVersion?: string) => ({
        endpoint: `https://localhost:${port}/push/${id}`,
        keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
        userAgent: ua,
        ...(swVersion ? { swVersion } : {}),
      }),
    };
  }
  const deviceKey = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
  const subsFor = (endpoint: string) => db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  // Each test alert is rate-limited to one per 20 s per login: age earlier ones.
  const ageTests = (userId: string) => db.update(pushAlertsTable).set({ sentAt: new Date(Date.now() - 60_000) })
    .where(and(eq(pushAlertsTable.userId, userId), eq(pushAlertsTable.kind, "test")));
  const sendTest = (token: string) => api("/portal/push/test", { method: "POST", token, body: { delaySeconds: 0 } });

  const A = phone("a");
  const B = phone("b");

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "push-mock-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-days", "1",
      "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
    server = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const id = String(req.url).split("/push/")[1];
        const p = phones.get(id);
        let payload: any = null;
        if (p) {
          try { payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: "aes128gcm", privateKey: p.ecdh, authSecret: p.auth.toString("base64url") }).toString()); }
          catch { payload = null; }
        }
        received.push({ path: id, payload });
        res.writeHead(id.startsWith("gone") ? 410 : 201); res.end();
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;

    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    other = await seedCrossTenantPortalMember([co], [admin]);
    tok = (await portalLogin(member.email, member.password, co.projectId)).token;
    otherTok = (await portalLogin(other.email, other.password, co.projectId)).token;
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 500)); // hold alerts are fire-and-forget
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId, other.userId]));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await db.update(projectsTable).set({ siteManagerId: null }).where(eq(projectsTable.id, co.projectId));
    await db.delete(pushAlertsTable).where(like(pushAlertsTable.endpoint, `https://localhost:${port}/push/%`));
    await db.delete(pushSubscriptionsTable).where(like(pushSubscriptionsTable.endpoint, `https://localhost:${port}/push/%`));
    for (const m of [member, other]) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, m.userId));
    await cleanupPortalMember(other, [co.projectId]);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
    server?.close();
  });

  it("the receipt endpoint needs no login, validates, and says nothing about unknown ids", async () => {
    expect((await api("/push/receipt", { method: "POST", body: { event: "received" } })).status).toBe(400);
    expect((await api("/push/receipt", { method: "POST", body: { id: randomUUID(), event: "opened" } })).status).toBe(400);
    expect((await api("/push/receipt", { method: "POST", body: { id: randomUUID(), event: "received" } })).status).toBe(200);
  });

  it("no phone set up: the test alert says so, and the PM sees 'none'", async () => {
    const r = await sendTest(tok);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("no_devices");
    const people = await api(`/projects/${co.projectId}/in-house-people`, { token: admin });
    const me = (people.json as any[]).find(p => p.id === member.personIds[0]);
    expect(me.portal.phoneAlerts).toMatchObject({ state: "none", devices: 0 });
  });

  it("a test alert carries a receipt id to the phone; Apple accepting it is not 'reached'", async () => {
    expect((await api("/portal/push/subscribe", { method: "POST", token: tok, body: A.body() })).status).toBe(200);
    const r = await sendTest(tok);
    expect(r.status).toBe(200);
    expect(r.json.sent).toHaveLength(1);
    pushReachable = r.json.sent[0].result === "accepted";
    if (!pushReachable) console.warn("push-receipts: API can't reach the mock push service; run it with NODE_TLS_REJECT_UNAUTHORIZED=0");
    expect(r.json.sent[0].deviceId).toBe(deviceKey(A.endpoint()));
    if (!pushReachable) return;
    const got = received.filter(x => x.path === A.id).at(-1)!;
    expect(got.payload).toMatchObject({ title: "SiteSort test alert", receipt: r.json.sent[0].alertId, url: "/portal/settings?alertTest=1" });

    const devs = await api("/portal/push/devices", { token: tok });
    expect(devs.status).toBe(200);
    expect(JSON.stringify(devs.json)).not.toContain(`localhost:${port}`); // endpoints never leave the server
    expect(devs.json.pruneAfter).toBe(7);
    const d = devs.json.devices[0];
    expect(d).toMatchObject({ deviceId: deviceKey(A.endpoint()), label: "iPhone", lastConfirmedAt: null });
    expect(d.lastTest).toMatchObject({ sendResult: "accepted", receivedAt: null, bannerAnswer: null });

    const people = await api(`/projects/${co.projectId}/in-house-people`, { token: admin });
    expect((people.json as any[]).find(p => p.id === member.personIds[0]).portal.phoneAlerts).toMatchObject({ state: "never", devices: 1, confirmedDevices: 0 });
  });

  it("the phone's receipt confirms it; 'no banner' is recorded and the PM sees the phone hid it", async (ctx) => {
    if (!pushReachable) ctx.skip();
    const alertId = (await api("/portal/push/devices", { token: tok })).json.devices[0].lastTest.alertId;
    expect((await api("/push/receipt", { method: "POST", body: { id: alertId, event: "received", shown: true, permission: "granted" } })).status).toBe(200);
    const d = (await api("/portal/push/devices", { token: tok })).json.devices[0];
    expect(d.lastTest).toMatchObject({ shown: true, permission: "granted" });
    expect(d.lastTest.receivedAt).toBeTruthy();
    expect(d.lastConfirmedAt).toBeTruthy();

    // Someone else can't answer for this phone.
    expect((await api("/portal/push/test-answer", { method: "POST", token: otherTok, body: { alertId, answer: "yes" } })).status).toBe(404);
    expect((await api("/portal/push/test-answer", { method: "POST", token: tok, body: { alertId, answer: "no" } })).status).toBe(200);

    const people = await api(`/projects/${co.projectId}/in-house-people`, { token: admin });
    const pa = (people.json as any[]).find(p => p.id === member.personIds[0]).portal.phoneAlerts;
    expect(pa).toMatchObject({ state: "confirmed", devices: 1, confirmedDevices: 1, banner: { answer: "no", reachedPhone: true } });
  });

  it("a second test within 20 seconds is refused", async (ctx) => {
    if (!pushReachable) ctx.skip();
    expect((await sendTest(tok)).status).toBe(429);
  });

  it("a tap counts as arrived even if the 'received' report was lost", async (ctx) => {
    if (!pushReachable) ctx.skip();
    await ageTests(member.userId);
    const r = await sendTest(tok);
    const alertId = r.json.sent[0].alertId;
    expect((await api("/push/receipt", { method: "POST", body: { id: alertId, event: "tapped" } })).status).toBe(200);
    const [row] = await db.select().from(pushAlertsTable).where(eq(pushAlertsTable.id, alertId));
    expect(row.tappedAt).toBeTruthy();
    expect(row.arrivedAt).toBeTruthy();
    const d = (await api("/portal/push/devices", { token: tok })).json.devices.find((x: any) => x.deviceId === deviceKey(A.endpoint()));
    expect(d.lastTest.outcome).toBe("displayed");
  });

  it("removes one of my phones, never someone else's", async (ctx) => {
    if (!pushReachable) ctx.skip();
    expect((await api("/portal/push/subscribe", { method: "POST", token: otherTok, body: B.body("Mozilla/5.0 (Linux; Android 14) Mobile") })).status).toBe(200);
    expect((await api("/portal/push/devices/remove", { method: "POST", token: tok, body: { deviceId: deviceKey(B.endpoint()) } })).status).toBe(404);
    expect(await subsFor(B.endpoint())).toHaveLength(1);
    expect((await api("/portal/push/devices/remove", { method: "POST", token: otherTok, body: { deviceId: deviceKey(B.endpoint()) } })).status).toBe(200);
    expect(await subsFor(B.endpoint())).toHaveLength(0);
  });

  // Rows standing in for real alerts sent to the phone, older than the 10 min grace.
  async function pastAlerts(userId: string, endpoint: string, n: number, opts: { answered?: boolean; minutesAgo: number }) {
    await db.insert(pushAlertsTable).values(Array.from({ length: n }, (_, i) => ({
      id: randomUUID(), userId, projectId: co.projectId, endpoint, kind: "alert", tag: "test-fixture", sendResult: "accepted",
      sentAt: new Date(Date.now() - (opts.minutesAgo - i) * 60_000),
      receivedAt: opts.answered ? new Date(Date.now() - (opts.minutesAgo - i) * 60_000 + 1000) : null,
    })));
  }

  it("a phone that has never replied (old service worker) is never removed for silence", async (ctx) => {
    if (!pushReachable) ctx.skip();
    const C = phone("c");
    expect((await api("/portal/push/subscribe", { method: "POST", token: otherTok, body: C.body() })).status).toBe(200);
    await pastAlerts(other.userId, C.endpoint(), 12, { minutesAgo: 300 });
    await ageTests(other.userId);
    expect((await sendTest(otherTok)).status).toBe(200);
    expect((await subsFor(C.endpoint())).length).toBeGreaterThan(0);
  });

  it("6 unanswered in a row after a reply: kept. The 7th: removed, with a marker the PM sees", async (ctx) => {
    if (!pushReachable) ctx.skip();
    const D = phone("d");
    expect((await api("/portal/push/subscribe", { method: "POST", token: tok, body: D.body() })).status).toBe(200);
    // A's rows would keep the member "confirmed"; take A off so D decides the state.
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, A.endpoint()));
    await pastAlerts(member.userId, D.endpoint(), 1, { answered: true, minutesAgo: 600 });
    await pastAlerts(member.userId, D.endpoint(), 6, { minutesAgo: 500 });
    await ageTests(member.userId);
    expect((await sendTest(tok)).status).toBe(200); // this send is under 10 min old: not counted yet
    expect((await subsFor(D.endpoint())).length).toBeGreaterThan(0);

    // Let the send just made pass the grace period (it is unanswered): 7 in a row.
    await ageTests(member.userId);
    await db.update(pushAlertsTable).set({ sentAt: new Date(Date.now() - 30 * 60_000) })
      .where(and(eq(pushAlertsTable.endpoint, D.endpoint()), eq(pushAlertsTable.kind, "test")));
    expect((await sendTest(tok)).status).toBe(200);
    expect(await subsFor(D.endpoint())).toHaveLength(0);
    const marker = await db.select().from(pushAlertsTable)
      .where(and(eq(pushAlertsTable.endpoint, D.endpoint()), inArray(pushAlertsTable.sendResult, ["pruned"])));
    expect(marker).toHaveLength(1);

    const people = await api(`/projects/${co.projectId}/in-house-people`, { token: admin });
    expect((people.json as any[]).find(p => p.id === member.personIds[0]).portal.phoneAlerts).toMatchObject({ state: "removed", devices: 0 });

    // Opening the portal on that phone again (resync) puts it back.
    expect((await api("/portal/push/subscribe", { method: "POST", token: tok, body: D.body() })).status).toBe(200);
    expect((await subsFor(D.endpoint())).length).toBeGreaterThan(0);
  });

  it("an expired registration (410) is removed and reported as gone", async (ctx) => {
    if (!pushReachable) ctx.skip();
    const G = phone("gone");
    expect((await api("/portal/push/subscribe", { method: "POST", token: otherTok, body: G.body() })).status).toBe(200);
    await ageTests(other.userId);
    const r = await sendTest(otherTok);
    expect(r.json.sent.find((s: any) => s.deviceId === deviceKey(G.endpoint())).result).toBe("gone");
    expect(await subsFor(G.endpoint())).toHaveLength(0);
  });

  // Dean, 2026-10-22: tell apart (1) the service worker never ran, (2) it ran
  // but showNotification failed, (3) it ran and displayed. Plus: an old
  // service worker that can't report must not read as (1).
  describe("what the phone's service worker did", () => {
    const E = phone("e");
    const outcome = async () => (await api("/portal/push/devices", { token: otherTok })).json.devices
      .find((d: any) => d.deviceId === deviceKey(E.endpoint())).lastTest;
    const freshTest = async () => {
      await ageTests(other.userId);
      const r = await sendTest(otherTok);
      expect(r.status).toBe(200);
      return r.json.sent.find((x: any) => x.deviceId === deviceKey(E.endpoint())).alertId as string;
    };
    const receipt = (body: Record<string, unknown>) => api("/push/receipt", { method: "POST", body: { sw: "receipts-2", ...body } });

    it("an old service worker (no version at registration): silence is 'no receipt, old app', not 'never arrived'", async (ctx) => {
      if (!pushReachable) ctx.skip();
      expect((await api("/portal/push/subscribe", { method: "POST", token: otherTok, body: E.body() })).status).toBe(200);
      const id = await freshTest();
      await db.update(pushAlertsTable).set({ sentAt: new Date(Date.now() - 5 * 60_000) }).where(eq(pushAlertsTable.id, id));
      expect((await outcome()).outcome).toBe("no_receipt_old_app");
    });

    it("(1) new service worker, no word within a minute: never arrived", async (ctx) => {
      if (!pushReachable) ctx.skip();
      expect((await api("/portal/push/subscribe", { method: "POST", token: otherTok, body: E.body(undefined, "receipts-2") })).status).toBe(200);
      const id = await freshTest();
      expect((await db.select().from(pushAlertsTable).where(eq(pushAlertsTable.id, id)))[0].deviceSw).toBe("receipts-2");
      expect((await outcome()).outcome).toBe("waiting");
      await db.update(pushAlertsTable).set({ sentAt: new Date(Date.now() - 10 * 60_000) })
        .where(and(eq(pushAlertsTable.endpoint, E.endpoint()), eq(pushAlertsTable.kind, "test")));
      await db.update(pushAlertsTable).set({ sentAt: new Date(Date.now() - 5 * 60_000) }).where(eq(pushAlertsTable.id, id));
      expect((await outcome()).outcome).toBe("never_arrived");
    });

    it("ran, then nothing more (killed while showing): arrived, no result", async (ctx) => {
      if (!pushReachable) ctx.skip();
      const id = await freshTest();
      await receipt({ id, event: "arrived", permission: "granted" });
      expect((await outcome()).outcome).toBe("arrived_no_result");
    });

    it("the exact bodies sw.js sends on success are accepted, nulls included (a 400 here once dropped every success)", async (ctx) => {
      if (!pushReachable) ctx.skip();
      const id = await freshTest();
      for (const body of [
        { id, event: "arrived", permission: "granted", sw: "receipts-2" },
        { id, event: "received", permission: "granted", sw: "receipts-2", shown: true, error: null, posted: null, foreground: false },
      ]) expect((await api("/push/receipt", { method: "POST", body })).status).toBe(200);
      expect((await outcome()).outcome).toBe("displayed");
    });

    it("(2) ran and showNotification threw: show failed, with the error", async (ctx) => {
      if (!pushReachable) ctx.skip();
      const id = await freshTest();
      await receipt({ id, event: "arrived" });
      await receipt({ id, event: "received", shown: false, error: "TypeError: No active registration", posted: false, foreground: false });
      expect(await outcome()).toMatchObject({ outcome: "show_failed", showError: "TypeError: No active registration" });
    });

    it("showNotification resolved but nothing is in the phone's list: not posted", async (ctx) => {
      if (!pushReachable) ctx.skip();
      const id = await freshTest();
      await receipt({ id, event: "received", shown: true, posted: false, foreground: false });
      expect((await outcome()).outcome).toBe("not_posted");
    });

    it("(3) displayed; and displayed while SiteSort was open on screen is told apart", async (ctx) => {
      if (!pushReachable) ctx.skip();
      let id = await freshTest();
      await receipt({ id, event: "arrived" });
      await receipt({ id, event: "received", shown: true, posted: true, foreground: false });
      expect((await outcome()).outcome).toBe("displayed");
      id = await freshTest();
      await receipt({ id, event: "received", shown: true, posted: true, foreground: true });
      expect((await outcome()).outcome).toBe("displayed_app_open");
    });

    it("a real gate hold sends the site manager's phone an alert that leaves a receipt row tagged hold-<id>", async (ctx) => {
      if (!pushReachable) ctx.skip();
      await db.update(projectsTable).set({ siteManagerId: other.userId }).where(eq(projectsTable.id, co.projectId));
      const qr = await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["general"] } });
      const fd = new FormData();
      fd.append("photo", new Blob([Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64")], { type: "image/jpeg" }), "c.jpg");
      for (const [k, v] of Object.entries({ phone: "07700 900999", workerName: "Gate Tester", companyName: "Nobody Ltd" })) fd.append(k, v);
      const res = await fetch(`${API_BASE}/site/${qr.json[0].token}/checkin`, { method: "POST", body: fd });
      const held = await res.json();
      expect(res.status).toBe(403);
      expect(held.error).toBe("check_in_held");
      const [row] = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
      let alert: any;
      for (let i = 0; i < 20 && !alert; i++) {
        await new Promise(r => setTimeout(r, 250));
        [alert] = await db.select().from(pushAlertsTable).where(and(eq(pushAlertsTable.endpoint, E.endpoint()), eq(pushAlertsTable.tag, `hold-${row.id}`)));
      }
      expect(alert).toMatchObject({ sendResult: "accepted", deviceSw: "receipts-2", kind: "alert" });
      const got = received.filter(x => x.path === E.id).at(-1)!;
      expect(got.payload).toMatchObject({ tag: `hold-${row.id}`, receipt: alert.id, url: "/portal/site-register" });
    });
  });
});
