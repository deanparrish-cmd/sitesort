import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  usersTable, projectInvitesTable, credentialEventsTable, credentialResetTokensTable, portalSharesTable,
  documentDistributionsTable, acknowledgmentAuditTable, portalSessionsTable, notificationsTable, peopleTable,
  projectMembersTable, pinAuditLogTable, inviteLinkRefusalsTable,
} from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  cleanupTestDocuments, inviteTokenFromInbox, TEST_PASSWORD, type Fixture, type PortalMemberFixture,
} from "./helpers";
import { recordFailedPinAttempt, clearPinAttempts } from "../src/lib/pin-attempts";

/**
 * Dean, 2026-10-23 (binding): only the account holder controls a login. A PM
 * must never be able to take over a portal member's account, change their
 * password, or set or reset their PIN; and the owner hears of every change.
 * A sign-off record says plainly whether it was signed with a PIN or
 * acknowledged without one.
 */
describe("only the owner controls a login; signatures say how they were given", () => {
  let co: Fixture;
  let co2: Fixture;
  let admin = "";
  let admin2 = "";
  let member: PortalMemberFixture;
  const docIds: string[] = [];
  const extraUsers: string[] = [];
  const extraPeople: string[] = [];

  const events = async (userId: string) =>
    (await db.select().from(credentialEventsTable).where(eq(credentialEventsTable.userId, userId))).map(e => e.kind);
  const newPerson = async (projectId: string, token: string, email: string) => {
    const res = await api(`/projects/${projectId}/in-house-people`, { method: "POST", token, body: { firstName: "Owner", lastName: `Test ${randomUUID().slice(0, 4)}`, email } });
    expect([200, 201]).toContain(res.status);
    extraPeople.push(res.json.id);
    return res.json.id as string;
  };

  beforeAll(async () => {
    co = await seedCompany();
    co2 = await seedCompany();
    admin = await login(co.email);
    admin2 = await login(co2.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    const projectIds = [co.projectId, co2.projectId];
    if (docIds.length) {
      await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, docIds));
      await db.delete(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.documentId, docIds));
      await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docIds));
    }
    const users = [member.userId, co.userId, co2.userId, ...extraUsers];
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, users));
    await db.delete(credentialResetTokensTable).where(inArray(credentialResetTokensTable.userId, users));
    await db.delete(pinAuditLogTable).where(inArray(pinAuditLogTable.userId, users));
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.userId, users));
    await cleanupTestDocuments(docIds);
    await db.delete(projectMembersTable).where(inArray(projectMembersTable.projectId, projectIds));
    await db.delete(projectInvitesTable).where(inArray(projectInvitesTable.projectId, projectIds));
    if (extraPeople.length) await db.delete(peopleTable).where(inArray(peopleTable.id, extraPeople));
    if (extraUsers.length) await db.delete(usersTable).where(inArray(usersTable.id, extraUsers));
    await cleanupPortalMember(member, projectIds);
    await cleanupFixtures([co, co2]);
  });

  it("the inviter is never handed the invite link, on invite or resend", async () => {
    const email = `owner-only-${randomUUID().slice(0, 8)}@sitesort-tests.local`;
    const personId = await newPerson(co.projectId, admin, email);
    const inv = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId, role: "worker" } });
    expect(inv.status).toBe(201);
    expect(inv.json).not.toHaveProperty("inviteUrl");
    expect(JSON.stringify(inv.json)).not.toContain("/portal/accept/");
    const row = (await db.select().from(projectInvitesTable).where(and(eq(projectInvitesTable.personId, personId), eq(projectInvitesTable.status, "pending"))))[0];
    expect(row.emailOnly).toBe(true);
    await db.update(projectInvitesTable).set({ emailLastSentAt: null }).where(eq(projectInvitesTable.id, row.id));
    const re = await api(`/projects/${co.projectId}/portal-invites/${row.id}/resend`, { method: "POST", token: admin });
    expect(re.status).toBe(200);
    expect(re.json).not.toHaveProperty("inviteUrl");
    expect(JSON.stringify(re.json)).not.toContain("/portal/accept/");
  });

  it("an invite link never changes an existing login's password or logs in as them", async () => {
    // Another firm invites the same person: the case where a PM used to hold
    // a link that overwrote their password and handed back a session.
    const personId = await newPerson(co2.projectId, admin2, member.email);
    const inv = await api(`/projects/${co2.projectId}/portal-invites`, { method: "POST", token: admin2, body: { personId, role: "worker" } });
    expect(inv.status).toBe(201);
    const token = await inviteTokenFromInbox(co2.projectId, personId);
    expect((await api(`/portal/invite/${token}`)).json.existingAccount).toBe(true);
    const hijack = "Hijack-Pass-2026!";
    const acc = await api(`/portal/invite/${token}/accept`, { method: "POST", body: { password: hijack } });
    expect(acc.status).toBe(200);
    expect(acc.json.requiresLogin).toBe(true);
    expect(acc.json.token).toBeUndefined();
    expect((await api("/portal/login", { method: "POST", body: { email: member.email, password: hijack } })).status).toBe(401);
    expect((await portalLogin(member.email, member.password, co.projectId)).token).toBeTruthy();
    expect(await events(member.userId)).toContain("invite_accepted");
  });

  it("accepting an email-only invite proves the inbox", async () => {
    const proven = `owner-proven-${randomUUID().slice(0, 8)}@sitesort-tests.local`;
    const p1 = await newPerson(co.projectId, admin, proven);
    expect((await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: p1, role: "worker" } })).status).toBe(201);
    const t1 = await inviteTokenFromInbox(co.projectId, p1);
    expect((await api(`/portal/invite/${t1}/accept`, { method: "POST", body: { password: "Proven-Pass-2026!" } })).status).toBe(200);
    const u1 = (await db.select().from(usersTable).where(eq(usersTable.email, proven)))[0];
    extraUsers.push(u1.id);
    expect(u1.emailProvenAt).toBeTruthy();
    expect(u1.emailVerified).toBe(true);
    const i1 = (await db.select().from(projectInvitesTable).where(eq(projectInvitesTable.personId, p1)))[0];
    expect(i1.acceptedIp).toBeTruthy();
    expect(i1.acceptedUserAgent).toBeTruthy();
  });

  it("a link issued before #169 is refused and logged, the PM is told to send it again, and the fresh link works", async () => {
    const old = `owner-old-${randomUUID().slice(0, 8)}@sitesort-tests.local`;
    const p2 = await newPerson(co.projectId, admin, old);
    expect((await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: p2, role: "worker" } })).status).toBe(201);
    const t2 = await inviteTokenFromInbox(co.projectId, p2);
    const [inv] = await db.update(projectInvitesTable).set({ emailOnly: false, emailLastSentAt: null })
      .where(eq(projectInvitesTable.personId, p2)).returning(); // a pre-#169 token, handed to the inviter
    const opened = await api(`/portal/invite/${t2}`);
    expect(opened.status).toBe(410);
    expect(opened.json.error).toBe("invite_link_outdated");
    expect(opened.json.message).toBe("This invite link is out of date and no longer works. Ask the person who invited you to send it again: the new link will come to your email.");
    const tried = await api(`/portal/invite/${t2}/accept`, { method: "POST", body: { password: "Older-Pass-2026!" } });
    expect(tried.status).toBe(410);
    expect(tried.json.error).toBe("invite_link_outdated");
    expect((await db.select().from(usersTable).where(eq(usersTable.email, old))).length).toBe(0);
    const refusals = await db.select().from(inviteLinkRefusalsTable).where(eq(inviteLinkRefusalsTable.inviteId, inv.id));
    expect(refusals.map(r => r.stage).sort()).toEqual(["accept", "open"]);
    expect(refusals.every(r => r.ipAddress)).toBe(true);

    // The PM sees it on the Team tab card and in the Team Portal invite list.
    const people = (await api(`/projects/${co.projectId}/in-house-people`, { token: admin })).json as any[];
    const card = people.find(x => x.id === p2);
    expect(card.portal).toMatchObject({ status: "invited", linkOutdated: true });
    expect(card.portal.oldLinkRefusedAt).toBeTruthy();
    const listed = ((await api(`/projects/${co.projectId}/invites`, { token: admin })).json as any[]).find(x => x.id === inv.id);
    expect(listed).toMatchObject({ linkOutdated: true });

    // Send again: an email-only link that works; the old one stays refused.
    expect((await api(`/projects/${co.projectId}/portal-invites/${inv.id}/resend`, { method: "POST", token: admin })).status).toBe(200);
    expect((await api(`/portal/invite/${t2}`)).status).toBe(410);
    const fresh = await inviteTokenFromInbox(co.projectId, p2);
    expect((await api(`/portal/invite/${fresh}/accept`, { method: "POST", body: { password: "Fresh-Pass-2026!" } })).status).toBe(200);
    const u2 = (await db.select().from(usersTable).where(eq(usersTable.email, old)))[0];
    extraUsers.push(u2.id);
    expect(u2.emailProvenAt).toBeTruthy();
  });

  it("Send again (or inviting again) kills the previous link: only the newest one opens", async () => {
    const email = `owner-resend-${randomUUID().slice(0, 8)}@sitesort-tests.local`;
    const personId = await newPerson(co.projectId, admin, email);
    expect((await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId, role: "worker" } })).status).toBe(201);
    const first = await inviteTokenFromInbox(co.projectId, personId);
    expect((await api(`/portal/invite/${first}`)).status).toBe(200);
    const row = (await db.select().from(projectInvitesTable).where(and(eq(projectInvitesTable.personId, personId), eq(projectInvitesTable.status, "pending"))))[0];
    await db.update(projectInvitesTable).set({ emailLastSentAt: null }).where(eq(projectInvitesTable.id, row.id));
    expect((await api(`/projects/${co.projectId}/portal-invites/${row.id}/resend`, { method: "POST", token: admin })).status).toBe(200);
    const afterResend = await api(`/portal/invite/${first}`);
    expect(afterResend.status).toBe(410);
    expect(afterResend.json.error).toBe("invalid_invite");
    expect((await api(`/portal/invite/${first}/accept`, { method: "POST", body: { password: "Held-Link-2026!" } })).status).toBe(410);
    // Inviting again from the card does the same.
    const second = await inviteTokenFromInbox(co.projectId, personId);
    expect((await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId, role: "worker" } })).status).toBe(201);
    expect((await api(`/portal/invite/${second}`)).status).toBe(410);
    expect((await db.select().from(projectInvitesTable).where(and(eq(projectInvitesTable.personId, personId), eq(projectInvitesTable.status, "pending")))).length).toBe(1);
    expect((await db.select().from(usersTable).where(eq(usersTable.email, email))).length).toBe(0);
  });

  it("the 3rd lockout in a day switches the PIN off until the owner's emailed reset; the password alone can't bring it back", async () => {
    const portal = (await portalLogin(member.email, member.password, co.projectId)).token;
    const up = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name: `RAMS ${randomUUID().slice(0, 6)}`, type: "method_statement", fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, requiresAcknowledgment: true } });
    expect(up.status).toBe(201);
    const rams = up.json.id as string;
    docIds.push(rams);
    expect((await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: rams, audiences: [{ type: "all" }] } })).status).toBe(201);
    expect((await api(`/portal/documents/${rams}/view`, { method: "POST", token: portal })).status).toBe(200);

    // Three lockouts (5 wrong tries each), the 15 minutes between them simulated.
    let last: Awaited<ReturnType<typeof recordFailedPinAttempt>> | null = null;
    for (let lockout = 0; lockout < 3; lockout++) {
      for (let i = 0; i < 5; i++) last = await recordFailedPinAttempt(member.userId);
      if (lockout < 2) { expect(last!.lock.status).toBe(429); await clearPinAttempts(member.userId); }
    }
    expect(last!.lock.status).toBe(423);
    expect((await db.select().from(usersTable).where(eq(usersTable.id, member.userId)))[0].pinLockedAt).toBeTruthy();
    expect(await events(member.userId)).toContain("pin_switched_off");

    const refused = await api(`/portal/documents/${rams}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(refused.status).toBe(423);
    expect(refused.json.error).toBe("pin_switched_off");
    const viaPassword = await api("/portal/pin", { method: "POST", token: portal, body: { currentPassword: member.password, pin: "1357" } });
    expect(viaPassword.status).toBe(423);

    // The owner's emailed link (raw token as it would arrive in their inbox).
    const raw = randomBytes(32).toString("hex");
    await db.insert(credentialResetTokensTable).values({ id: randomUUID(), userId: member.userId, kind: "pin", context: "portal", tokenHash: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 60_000) });
    expect((await api("/auth/reset-pin", { method: "POST", body: { token: raw, pin: "2468" } })).status).toBe(200);
    expect((await db.select().from(usersTable).where(eq(usersTable.id, member.userId)))[0].pinLockedAt).toBeNull();
    expect((await api(`/portal/documents/${rams}/acknowledge`, { method: "POST", token: portal, body: { pin: "2468" } })).status).toBe(200);
    member.pin = "2468";
    expect(await events(member.userId)).toContain("pin_changed");
  });

  it("the owner is told of every password and PIN change", async () => {
    const ch = await api("/auth/change-password", { method: "POST", token: admin, body: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD } });
    expect(ch.status).toBe(200);
    const pw = (await db.select().from(credentialEventsTable).where(and(eq(credentialEventsTable.userId, co.userId), eq(credentialEventsTable.kind, "password_changed"))))[0];
    expect(pw).toBeTruthy();
    expect(pw.emailNotice).toBe("suppressed"); // sent on prod; never leaves the workspace
    expect(await events(member.userId)).toContain("pin_set"); // the fixture set the member's first PIN
    expect((await api("/auth/forgot-pin", { method: "POST", body: { email: member.email, context: "portal" } })).status).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect(await events(member.userId)).toContain("pin_reset_requested");
  });

  it("every signature says whether it was signed with a PIN or acknowledged without one", async () => {
    const portal = (await portalLogin(member.email, member.password, co.projectId)).token;
    const mk = async (type: string) => {
      const r = await api(`/projects/${co.projectId}/documents`, { method: "POST", token: admin, body: { name: `${type} ${randomUUID().slice(0, 6)}`, type, fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100, requiresAcknowledgment: true } });
      expect(r.status).toBe(201);
      docIds.push(r.json.id);
      expect((await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: r.json.id, audiences: [{ type: "all" }] } })).status).toBe(201);
      expect((await api(`/portal/documents/${r.json.id}/view`, { method: "POST", token: portal })).status).toBe(200);
      return r.json.id as string;
    };
    const permit = await mk("permit");
    const general = await mk("general");
    expect((await api(`/portal/documents/${permit}/acknowledge`, { method: "POST", token: portal, body: { pin: member.pin } })).status).toBe(200);
    expect((await api(`/portal/documents/${general}/acknowledge`, { method: "POST", token: portal, body: {} })).status).toBe(200);

    const shared = (await api("/portal/shared", { token: portal })).json.documents as any[];
    expect(shared.find(d => d.id === permit).mySignedOffWithPin).toBe(true);
    expect(shared.find(d => d.id === general).mySignedOffWithPin).toBe(false);

    const list = (await api(`/projects/${co.projectId}/documents`, { token: admin })).json as any[];
    expect(list.find(d => d.id === permit).distributionSummary).toMatchObject({ acknowledged: 1, signedWithPin: 1 });
    expect(list.find(d => d.id === general).distributionSummary).toMatchObject({ acknowledged: 1, signedWithPin: 0 });

    const close = (await api(`/projects/${co.projectId}/closeout`, { token: admin })).json;
    expect(close.checks.signOffs.signedWithPin).toBeGreaterThanOrEqual(2); // the RAMS above and this permit
    expect(close.checks.signOffs.acknowledgedWithoutPin).toBeGreaterThanOrEqual(1);
  });
});
