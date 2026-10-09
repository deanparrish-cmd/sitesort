import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, projectMembersTable, insuranceRecordsTable,
  notificationsTable, projectsTable, portalSessionsTable,
} from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, API_BASE, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * #124: the Team Portal site register. The designated site manager and anyone
 * given PM cover on the project see who is on site (the fire roll), decide
 * people waiting at the gate and sign someone out, from the portal. Nobody
 * else on the project can, and nothing else moves to the portal.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

describe("portal site register for the site manager and PM cover", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  const sfx = randomUUID().slice(0, 8);
  const sub = `tsub-reg-${sfx}`;
  const members: PortalMemberFixture[] = [];
  const tok = { manager: "", cover: "", plain: "" };
  let coverMemberId = "";

  async function checkIn(fields: Record<string, string>) {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const register = (t: string) => api("/portal/site-register", { token: t });

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    // An insured contractor with a mobile on file, on the project.
    await db.insert(subcontractorsTable).values({ id: sub, companyId: co.companyId, companyName: "Sparks Ltd", contactName: "Sid Sparks", contactEmail: `sid-${sfx}@example.test`, contactPhone: "07700 900601" });
    await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: sub, type: "public_liability", certificateUrl: "/api/uploads/x.pdf", expiryDate: "2099-01-01" } as any);
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: sub } as any);
    // Three Team Portal members: the site manager, one given PM cover, one plain.
    for (let i = 0; i < 3; i++) members.push(await seedCrossTenantPortalMember([co], [admin]));
    tok.manager = (await portalLogin(members[0].email, members[0].password)).token;
    tok.cover = (await portalLogin(members[1].email, members[1].password)).token;
    tok.plain = (await portalLogin(members[2].email, members[2].password)).token;
    expect((await api(`/projects/${co.projectId}`, { method: "PATCH", token: admin, body: { siteManagerId: members[0].userId } })).status).toBe(200);
    coverMemberId = (await db.select().from(projectMembersTable).where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, members[1].userId))))[0].id;
    expect((await api(`/projects/${co.projectId}/members/${coverMemberId}/authority`, { method: "PATCH", token: admin, body: { isProjectManager: true } })).status).toBe(200);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.update(projectsTable).set({ siteManagerId: null }).where(eq(projectsTable.id, co.projectId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, ...members.map(m => m.userId)]));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, sub));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    for (const m of members) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, m.userId));
    for (const m of members) await cleanupPortalMember(m, [co.projectId]);
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, sub));
    await cleanupFixtures([co]);
  });

  it("only the site manager and PM cover see the register; the portal context says so", async () => {
    expect((await api("/portal/me", { token: tok.manager })).json.member.canSeeSiteRegister).toBe(true);
    expect((await api("/portal/me", { token: tok.cover })).json.member.canSeeSiteRegister).toBe(true);
    expect((await api("/portal/me", { token: tok.plain })).json.member.canSeeSiteRegister).toBe(false);
    expect((await register(tok.plain)).status).toBe(403);
    expect((await register(admin)).status).toBe(403); // a dashboard login isn't a portal session
    const r = await register(tok.manager);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ projectId: co.projectId, onSite: [], held: [], notSignedOut: [] });
    expect(r.json.generatedAt).toBeTruthy();
  });

  it("someone signing in by their mobile is on the roll", async () => {
    expect((await checkIn({ phone: "07700900601" })).status).toBe(201);
    const r = await register(tok.cover);
    expect(r.json.onSite.map((x: any) => x.workerName)).toEqual(["Sid Sparks"]);
    expect(r.json.onSite[0]).not.toHaveProperty("photoUrl");
  });

  it("an unknown number waits at the gate: the site manager sees what they gave and lets them on with a reason", async () => {
    const held = await checkIn({ phone: "07700 900602", workerName: "Gina Gate", companyName: "Walk-in Ltd" });
    expect(held.json.holdReason).toBe("unverified");
    const r = await register(tok.manager);
    expect(r.json.onSite).toHaveLength(1);
    expect(r.json.held).toHaveLength(1);
    const h = r.json.held[0];
    expect(h).toMatchObject({ workerName: "Gina Gate", companyName: "Walk-in Ltd", holdReason: "unverified", typedPhone: "07700 900602", claimed: null });
    expect(h.photoUrl).toMatch(/sig=/);
    const path = `/portal/site-register/${h.id}/hold-decision`;
    expect((await api(path, { method: "POST", token: tok.plain, body: { decision: "approve", note: "x" } })).status).toBe(403);
    expect((await api(path, { method: "POST", token: tok.manager, body: { decision: "approve" } })).status).toBe(400);
    const ok = await api(path, { method: "POST", token: tok.manager, body: { decision: "approve", note: "Checked ID at the gate" } });
    expect(ok.status).toBe(200);
    const [row] = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, h.id));
    expect(row.holdDecidedBy).toBe(members[0].userId);
    const after = await register(tok.manager);
    expect(after.json.held).toHaveLength(0);
    expect(after.json.onSite.map((x: any) => x.workerName)).toEqual(["Gina Gate", "Sid Sparks"]);
    // The worker's own page sees the decision.
    expect((await api(`/site/${qrToken}/hold?holdToken=${encodeURIComponent(held.json.holdToken)}`)).json.status).toBe("approved");
  });

  it("PM cover can refuse; refused people never reach the roll", async () => {
    await checkIn({ phone: "07700 900603", workerName: "Ray Refused", companyName: "Nobody Ltd" });
    const h = (await register(tok.cover)).json.held[0];
    expect((await api(`/portal/site-register/${h.id}/hold-decision`, { method: "POST", token: tok.cover, body: { decision: "refuse" } })).status).toBe(200);
    const r = await register(tok.cover);
    expect(r.json.held).toHaveLength(0);
    expect(r.json.onSite.map((x: any) => x.workerName)).not.toContain("Ray Refused");
  });

  it("the site manager signs someone out with a note; a plain member can't", async () => {
    const sid = (await register(tok.manager)).json.onSite.find((x: any) => x.workerName === "Sid Sparks");
    const path = `/portal/site-register/${sid.id}/sign-out`;
    expect((await api(path, { method: "POST", token: tok.plain, body: { note: "x" } })).status).toBe(403);
    expect((await api(path, { method: "POST", token: tok.manager, body: {} })).status).toBe(400);
    const out = await api(path, { method: "POST", token: tok.manager, body: { note: "Left at 3pm, forgot to sign out" } });
    expect(out.status).toBe(200);
    expect(out.json.checkoutMethod).toBe("manual");
    expect((await register(tok.manager)).json.onSite.map((x: any) => x.workerName)).toEqual(["Gina Gate"]);
  });

  it("taking cover away takes the register away at once", async () => {
    await api(`/projects/${co.projectId}/members/${coverMemberId}/authority`, { method: "PATCH", token: admin, body: { isProjectManager: false } });
    expect((await register(tok.cover)).status).toBe(403);
    expect((await api("/portal/me", { token: tok.cover })).json.member.canSeeSiteRegister).toBe(false);
  });

  it("a member files their own mobile in the portal, and the gate then knows them by it", async () => {
    expect((await api("/portal/me", { token: tok.plain })).json.member.mobile).toBeNull();
    expect((await api("/portal/me/mobile", { method: "PUT", token: tok.plain, body: { mobile: "12" } })).status).toBe(400);
    const ok = await api("/portal/me/mobile", { method: "PUT", token: tok.plain, body: { mobile: "07700 900699" } });
    expect(ok.status).toBe(200);
    expect((await api("/portal/me", { token: tok.plain })).json.member.mobile).toBe("07700 900699");
    const found = await api(`/site/${qrToken}/identify`, { method: "POST", body: { phone: "+44 7700 900699" } });
    expect(found.json.matches).toHaveLength(1);
    expect(found.json.matches[0].label).toMatch(/^Cross T/);
  });

  it("another project's held check-in can't be decided through this register", async () => {
    const other = await seedCompany();
    try {
      const id = randomUUID();
      await db.insert(siteCheckinsTable).values({ id, projectId: other.projectId, workerName: "Elsewhere", companyName: "X", photoUrl: "/api/uploads/e.jpg", holdReason: "unverified", holdStatus: "pending" });
      const r = await api(`/portal/site-register/${id}/hold-decision`, { method: "POST", token: tok.manager, body: { decision: "approve", note: "nope" } });
      expect(r.status).toBe(409);
      expect((await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.id, id)))[0].holdStatus).toBe("pending");
      await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.id, id));
    } finally {
      await cleanupFixtures([other]);
    }
  });
});
