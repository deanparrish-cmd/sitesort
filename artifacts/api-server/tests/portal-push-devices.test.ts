import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { pushSubscriptionsTable, portalSessionsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, login, api, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Fire-roll alerts (2026-10-16): a phone used to hold ONE push row, moved to
 * whichever project it opened last, so a site manager on two projects silently
 * lost the first project's held-at-the-gate alerts. Now one row per project.
 */
describe("portal push: one phone, every project", () => {
  let coA: Fixture, coB: Fixture;
  let adminA = "", adminB = "";
  let member: PortalMemberFixture;
  let other: PortalMemberFixture;
  let onA = "", onB = "", otherOnA = "";
  const endpoint = `https://push.example.test/${randomUUID()}`;
  const sub = { endpoint, keys: { p256dh: "BTestP256dhKey", auth: "testAuth" }, userAgent: "vitest" };

  const rows = () => db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));

  beforeAll(async () => {
    coA = await seedCompany();
    coB = await seedCompany();
    adminA = await login(coA.email);
    adminB = await login(coB.email);
    member = await seedCrossTenantPortalMember([coA, coB], [adminA, adminB]);
    onA = (await portalLogin(member.email, member.password, coA.projectId)).token;
    onB = (await portalLogin(member.email, member.password, coB.projectId)).token;
    other = await seedCrossTenantPortalMember([coA], [adminA]);
    otherOnA = (await portalLogin(other.email, other.password, coA.projectId)).token;
  });

  afterAll(async () => {
    await db.delete(pushSubscriptionsTable).where(like(pushSubscriptionsTable.endpoint, "https://push.example.test/%"));
    for (const m of [member, other]) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, m.userId));
    await cleanupPortalMember(other, [coA.projectId]);
    await cleanupPortalMember(member, [coA.projectId, coB.projectId]);
    await cleanupFixtures([coA, coB]);
  });

  it("the old one-row-per-phone index is gone; the per-project one exists", async () => {
    const { rows: idx } = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'push_subscriptions'`);
    const names = idx.map((r: { indexname: string }) => r.indexname);
    expect(names).not.toContain("push_subscriptions_endpoint_uq");
    expect(names).toContain("push_subscriptions_endpoint_project_uq");
  });

  it("turning alerts on from project A registers the phone for A and B", async () => {
    const res = await api("/portal/push/subscribe", { method: "POST", token: onA, body: sub });
    expect(res.status).toBe(200);
    expect((await rows()).map(r => r.projectId).sort()).toEqual([coA.projectId, coB.projectId].sort());
  });

  it("opening project B keeps project A's alerts (no move, no duplicates)", async () => {
    expect((await api("/portal/push/subscribe", { method: "POST", token: onB, body: sub })).status).toBe(200);
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r.map(x => x.projectId)).toContain(coA.projectId);
  });

  it("removed from project B: B's alerts go, A's stay, and a resync doesn't bring B back", async () => {
    const members = await api(`/projects/${coB.projectId}/members`, { token: adminB });
    const mine = (members.json as any[]).find(m => m.userId === member.userId);
    expect((await api(`/projects/${coB.projectId}/members/${mine.id}`, { method: "DELETE", token: adminB })).status).toBeLessThan(300);
    expect((await rows()).map(r => r.projectId)).toEqual([coA.projectId]);
    expect((await api("/portal/push/subscribe", { method: "POST", token: onA, body: sub })).status).toBe(200);
    expect((await rows()).map(r => r.projectId)).toEqual([coA.projectId]);
  });

  it("someone else signing in on the same phone takes it over; the first person's alerts stop landing there", async () => {
    expect((await api("/portal/push/subscribe", { method: "POST", token: otherOnA, body: sub })).status).toBe(200);
    const r = await rows();
    expect(r.map(x => x.userId)).toEqual([other.userId]);
  });

  it("Settings 'Turn off' removes the phone from every project", async () => {
    await api("/portal/push/subscribe", { method: "POST", token: onA, body: sub });
    expect((await api("/portal/push/unsubscribe", { method: "POST", token: onA, body: { endpoint } })).status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });
});
