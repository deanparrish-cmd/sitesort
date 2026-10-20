import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { usersTable, emailLogTable } from "@workspace/db/schema";
import {
  __setEmailTransportForTests, sendDocumentNotificationEmail, sendNewMessageEmail, sendSafetyAlertEmail,
} from "../src/lib/email";
import { seedCompany, cleanupFixtures, login, api, seedCrossTenantPortalMember, cleanupPortalMember, createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture } from "./helpers";
import { portalSharesTable, documentDistributionsTable, notificationsTable } from "@workspace/db/schema";
import { distributeDocumentToUser } from "../src/lib/document-distribution";

/**
 * Dean, 2026-10-20:
 *  - an emailed portal share stays a portal share: its link is the portal's
 *    Shared with me page (sign-in), never a no-login file link;
 *  - "You can manage email notifications in your SiteSort account settings"
 *    only for people who have that setting (a dashboard account); portal-only
 *    members and people with no account never see it;
 *  - the safety alert says it ignores the email setting, on purpose.
 * Real-looking addresses are put on the fixture accounts for the run, because
 * test domains are dropped before the (captured) transport.
 */
describe("email links and the email-settings footer", () => {
  let co: Fixture;
  let member: PortalMemberFixture;
  const tag = randomUUID().slice(0, 8);
  const dashEmail = `dash-${tag}@sitesort-footer-check.co.uk`;
  const portalEmail = `portal-${tag}@sitesort-footer-check.co.uk`;
  const noAccountEmail = `nobody-${tag}@sitesort-footer-check.co.uk`;
  let originalDash = "";
  let originalPortal = "";
  let adminToken = "";
  let docId = "";
  const sent: { to: string; html: string; text: string }[] = [];

  beforeAll(async () => {
    co = await seedCompany();
    const admin = await login(co.email);
    adminToken = admin;
    member = await seedCrossTenantPortalMember([co], [admin]);
    originalDash = co.email;
    originalPortal = member.email;
    await db.update(usersTable).set({ email: dashEmail }).where(eq(usersTable.id, co.userId));
    await db.update(usersTable).set({ email: portalEmail }).where(eq(usersTable.id, member.userId));
    docId = await createTestDocument(co.projectId, admin, { name: "Footer Plan", type: "drawing" });
    __setEmailTransportForTests(async p => { sent.push({ to: p.to, html: p.html, text: p.text }); return { data: { id: randomUUID() }, error: null }; });
  });
  afterAll(async () => {
    __setEmailTransportForTests(null);
    await db.delete(portalSharesTable).where(eq(portalSharesTable.itemId, docId));
    await db.delete(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, docId));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await cleanupTestDocuments([docId]);
    await db.delete(emailLogTable).where(inArray(emailLogTable.toAddress, [dashEmail, portalEmail, noAccountEmail]));
    await db.update(usersTable).set({ email: originalDash }).where(eq(usersTable.id, co.userId));
    await db.update(usersTable).set({ email: originalPortal }).where(eq(usersTable.id, member.userId));
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });
  const last = () => sent[sent.length - 1];
  const LINE = "You can manage email notifications in your SiteSort account settings.";

  it("the emailed portal share links to the portal and says a sign-in is needed", async () => {
    const portalUrl = "https://www.sitesort.co.uk/portal/shared?doc=abc";
    for (const ack of [false, true]) {
      await sendDocumentNotificationEmail(portalEmail, "Port Al", "Plan A", 2, "Site X", ack, portalUrl);
      const m = last();
      expect(m.html).toContain(portalUrl);
      expect(m.text).toContain(portalUrl);
      expect(m.html + m.text).not.toMatch(/\/open\?d=|\/api\/uploads\//);
      expect(m.text).toMatch(/sign in/i);
      expect(m.text).toContain("chose to email it as well");
    }
  });

  it("the share's email (distributeDocumentToUser, as POST /portal-shares calls it) links to the portal", async () => {
    // The API server is another process, so call the share's email path here
    // where the transport is captured.
    const before = sent.length;
    const { emailed } = await distributeDocumentToUser(
      { id: docId, name: "Footer Plan", version: 1, requiresAcknowledgment: false }, "Site X", member.userId,
      "New document: Footer Plan", () => {}, { sendEmail: true },
    );
    expect(emailed).toBe(true);
    await new Promise(res => setTimeout(res, 300));
    const mail = sent.slice(before).find(m => m.to === portalEmail);
    expect(mail).toBeTruthy();
    expect(mail!.html).toContain(`/portal/shared?doc=${docId}`);
    expect(mail!.html + mail!.text).not.toMatch(/\/open\?d=|\/api\/uploads\//);
    expect(mail!.html + mail!.text).not.toContain(LINE);
  });

  it("a portal-only member never sees the email-settings line", async () => {
    await sendDocumentNotificationEmail(portalEmail, "Port Al", "Plan A", 2, "Site X", false, "https://x/portal/shared?doc=1");
    expect(last().html).not.toContain(LINE);
    expect(last().text).not.toContain(LINE);
    await sendNewMessageEmail(portalEmail, "Port Al", "Sam Sender", "Hello there", false, "Site X");
    expect(last().html + last().text).not.toContain(LINE);
  });

  it("someone with no SiteSort account never sees it either", async () => {
    await sendNewMessageEmail(noAccountEmail, "No One", "Sam Sender", "Hello there", false, "Site X");
    expect(last().html + last().text).not.toContain(LINE);
  });

  it("a dashboard account does see it (the setting exists for them)", async () => {
    await sendNewMessageEmail(dashEmail, "Dash Board", "Sam Sender", "Hello there", false, "Site X");
    expect(last().html).toContain(LINE);
    expect(last().text).toContain(LINE);
  });

  it("no email carries the placeholder markers", async () => {
    for (const m of sent) expect(m.html + m.text).not.toMatch(/sitesort-settings-line/);
  });

  it("the safety alert says it is sent even with email notifications off", async () => {
    await sendSafetyAlertEmail(dashEmail, "Dash Board", "safety_concern", "REF-1", "Site X");
    expect(last().text).toContain("Safety alerts are always sent, even if you've turned email notifications off");
    expect(last().html).toContain("Safety alerts are always sent, even if you");
  });
});
