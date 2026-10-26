import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  permitsTable, expiryReminderLogsTable, emailLogTable, usersTable, projectInvitesTable, notificationsTable,
  peopleTable, projectMembersTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, login, api, API_BASE, type Fixture } from "./helpers";
import { isReservedTestAddress, __setEmailTransportForTests } from "../src/lib/email";
import { runComplianceReminders } from "../src/lib/permit-reminders";
import { verifySvixSignature } from "../src/routes/email-webhook";

/**
 * Email reliability (2026-10-16). Resend reports a refusal in its return value
 * and does not throw, so a refused expiry reminder used to be recorded as sent
 * and never retried, and nothing in SiteSort ever heard about a bounce.
 */

describe("test addresses never reach Resend", () => {
  it.each([
    "a@example.test", "a@sitesort-tests.local", "a@example.com", "a@x.example.org", "a@foo.invalid",
    "a@test", "a@localhost", "a@local", "a@example", "a@demo.sitesort.test",
    // Real-looking domains tests once used: someone could register them.
    "tom@testsitesort.co.uk", "a@sitesort-footer-check.co.uk", "a@SITESORT-REMINDER-CHECK.co.uk", "a@example-real.co.uk",
  ])("%s is blocked", (a) => expect(isReservedTestAddress(a)).toBe(true));
  it.each(["a@latest.co.uk", "a@contest.com", "a@gmail.com", "a@sitesort.co.uk", "a@testing.com"])(
    "%s is a real address", (a) => expect(isReservedTestAddress(a)).toBe(false));
});

describe("expiry reminders: recorded only once Resend accepts them", () => {
  let co: Fixture;
  const permitId = randomUUID();
  const reminderAddress = `reminder-check-${randomUUID().slice(0, 8)}@reminder-check.sitesort.test`;
  const started = new Date();
  const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    co = await seedCompany();
    // A reserved .test address: the stand-in transport below still receives it
    // (it is never Resend), so nothing can be sent for real.
    await db.update(usersTable).set({ email: reminderAddress, emailNotifications: true }).where(eq(usersTable.id, co.userId));
    await db.insert(permitsTable).values({ id: permitId, projectId: co.projectId, type: "hot_works", description: "Reminder check", responsibleUserId: co.userId, startDate: "2026-01-01", expiryDate: expiry });
    process.env.RESEND_API_KEY ??= "test-key-not-used";
  });

  afterAll(async () => {
    __setEmailTransportForTests(null);
    await db.delete(expiryReminderLogsTable).where(eq(expiryReminderLogsTable.entityId, permitId));
    await db.delete(emailLogTable).where(gte(emailLogTable.createdAt, started));
    await db.delete(permitsTable).where(eq(permitsTable.id, permitId));
    await cleanupFixtures([co]);
  });

  const claims = () => db.select().from(expiryReminderLogsTable).where(eq(expiryReminderLogsTable.entityId, permitId));
  const logged = () => db.select().from(emailLogTable).where(and(eq(emailLogTable.refType, "reminder"), eq(emailLogTable.refId, `permit:${permitId}:7`)));

  it("a refused reminder is NOT recorded as sent, and the refusal is logged", async () => {
    // Refuse everything, so other rows in this database end where they started.
    __setEmailTransportForTests(async () => ({ data: null, error: { message: "The domain is not verified" } }));
    await runComplianceReminders();
    expect(await claims()).toHaveLength(0);
    const l = await logged();
    expect(l.map(r => r.status)).toEqual(["refused"]);
    expect(l[0].error).toMatch(/not verified/);
  });

  it("the next run retries it; accepted, it is recorded once", async () => {
    __setEmailTransportForTests(async (p) => p.to === reminderAddress
      ? { data: { id: `re_${randomUUID()}` }, error: null }
      : { data: null, error: { message: "refused in test" } });
    await runComplianceReminders();
    expect((await claims()).map(c => c.milestone)).toEqual(["7"]);
    expect((await logged()).map(r => r.status).sort()).toEqual(["refused", "sent"]);
    // A third run doesn't send it again.
    await runComplianceReminders();
    expect((await logged()).filter(r => r.status === "sent")).toHaveLength(1);
  });
});

describe("Resend webhook", () => {
  // Svix's published example (docs.svix.com, "Verifying payloads manually").
  it("accepts Svix's documented example signature and rejects a tampered body", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const h = { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" };
    expect(verifySvixSignature(secret, h, '{"test": 2432232314}', 1614265330)).toBe(true);
    expect(verifySvixSignature(secret, h, '{"test": 2432232315}', 1614265330)).toBe(false);
    expect(verifySvixSignature(secret, h, '{"test": 2432232314}', 1614265330 + 3600)).toBe(false);
  });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const sign = (body: string) => {
    const id = `msg_${randomUUID()}`, ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(secret!.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "Content-Type": "application/json" };
  };
  const post = (body: string, headers: Record<string, string>) => fetch(`${API_BASE}/email/webhook`, { method: "POST", headers, body });

  let co: Fixture;
  let inviteId = "";
  let personId = "";
  const providerId = `re_${randomUUID()}`;

  beforeAll(async () => {
    if (!secret) throw new Error("run with RESEND_WEBHOOK_SECRET set for both the API server and the tests");
    co = await seedCompany();
    const admin = await login(co.email);
    const person = await api(`/projects/${co.projectId}/in-house-people`, { method: "POST", token: admin, body: { firstName: "Bounce", lastName: "Check", email: `bounce-${randomUUID().slice(0, 6)}@sitesort-tests.local` } });
    personId = person.json.id;
    const inv = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId } });
    expect(inv.status).toBe(201);
    inviteId = (await db.select().from(projectInvitesTable).where(eq(projectInvitesTable.personId, personId)).limit(1))[0].id;
    // As if the deployed app had sent the invite and Resend accepted it.
    await db.insert(emailLogTable).values({ id: randomUUID(), providerId, toAddress: "builder@bounce-check.sitesort.test", subject: "Invite", refType: "project_invite", refId: inviteId, status: "sent" });
  });

  afterAll(async () => {
    await db.delete(emailLogTable).where(eq(emailLogTable.providerId, providerId));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(projectInvitesTable).where(eq(projectInvitesTable.projectId, co.projectId));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(peopleTable).where(inArray(peopleTable.id, [personId]));
    await cleanupFixtures([co]);
  });

  const bounce = JSON.stringify({ type: "email.bounced", data: { email_id: providerId, to: ["builder@bounce-check.sitesort.test"], subject: "Invite", bounce: { message: "Mailbox does not exist" } } });

  it("refuses an unsigned or wrongly signed report", async () => {
    expect((await post(bounce, { "Content-Type": "application/json" })).status).toBe(401);
    const h = sign(bounce);
    expect((await post(bounce.replace("bounced", "delivered"), h)).status).toBe(401);
  });

  it("a bounced invite: marked failed, sender notified with a link to the person, log updated", async () => {
    expect((await post(bounce, sign(bounce))).status).toBe(200);
    const inv = (await db.select().from(projectInvitesTable).where(eq(projectInvitesTable.id, inviteId)))[0];
    expect(inv.emailStatus).toBe("failed");
    const notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, co.userId), eq(notificationsTable.type, "invite_email_bounced")));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ relatedEntityId: personId, relatedEntityType: "person" });
    expect((notes[0].metadata as { projectId?: string }).projectId).toBe(co.projectId);
    const log = (await db.select().from(emailLogTable).where(eq(emailLogTable.providerId, providerId)))[0];
    expect(log.status).toBe("bounced");
    expect(log.error).toMatch(/does not exist/);
  });

  it("a redelivered report, or a later 'delivered', changes nothing", async () => {
    expect((await post(bounce, sign(bounce))).status).toBe(200);
    const delivered = JSON.stringify({ type: "email.delivered", data: { email_id: providerId } });
    expect((await post(delivered, sign(delivered))).status).toBe(200);
    const notes = await db.select().from(notificationsTable)
      .where(and(eq(notificationsTable.userId, co.userId), eq(notificationsTable.type, "invite_email_bounced")));
    expect(notes).toHaveLength(1);
    const log = await db.select().from(emailLogTable).where(eq(emailLogTable.providerId, providerId));
    expect(log[0].status).toBe("bounced");
  });
});
