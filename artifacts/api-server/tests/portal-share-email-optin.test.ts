import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable, usersTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
} from "./helpers";

/**
 * Sharing to the Team Portal sends no email unless the sender ticks "Also
 * email them" (Dean, 2026-10-20). The email's open link works without a login
 * for 30 days, so it used to go to every recipient by default. The portal
 * notification and tracking happen either way. A recipient whose email setting
 * is off gets no email even when the box is ticked.
 */
describe("portal share email is opt-in", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  const docs: string[] = [];

  async function share(docId: string, alsoEmail?: boolean) {
    const r = await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: {
      itemType: "document", itemId: docId, audiences: [{ type: "person", personId: member.personIds[0] }],
      ...(alsoEmail === undefined ? {} : { alsoEmail }),
    } });
    expect(r.status).toBe(201);
    return r.json as { recipientCount: number; emailedCount: number };
  }

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    for (const n of ["A", "B", "C", "D"]) docs.push(await createTestDocument(co.projectId, admin, { name: `Email optin ${n}`, type: "drawing" }));
  });
  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, docs));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, docs));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(docs);
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("a plain portal share sends no email, but still notifies and tracks", async () => {
    const r = await share(docs[0]);
    expect(r.recipientCount).toBe(1);
    expect(r.emailedCount).toBe(0);
    const dist = await db.select().from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, docs[0]), eq(documentDistributionsTable.userId, member.userId)));
    expect(dist).toHaveLength(1);
    const note = await db.select().from(notificationsTable)
      .where(and(eq(notificationsTable.userId, member.userId), eq(notificationsTable.relatedEntityId, docs[0])));
    expect(note.length).toBeGreaterThan(0);
  });

  it("alsoEmail false sends no email", async () => {
    expect((await share(docs[1], false)).emailedCount).toBe(0);
  });

  it("ticking Also email them sends it, including on a re-share", async () => {
    expect((await share(docs[2], true)).emailedCount).toBe(1);
    expect((await share(docs[0], true)).emailedCount).toBe(1); // already distributed above
  });

  it("a recipient with email notifications off gets none even when ticked", async () => {
    await db.update(usersTable).set({ emailNotifications: false }).where(eq(usersTable.id, member.userId));
    try {
      expect((await share(docs[3], true)).emailedCount).toBe(0);
    } finally {
      await db.update(usersTable).set({ emailNotifications: true }).where(eq(usersTable.id, member.userId));
    }
  });
});
