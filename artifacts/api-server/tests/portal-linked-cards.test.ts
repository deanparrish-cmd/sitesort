import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  portalSharesTable, portalSessionsTable, notificationsTable, documentDistributionsTable,
  projectMembersTable, peopleTable, subcontractorsTable, projectInvitesTable,
} from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, portalLogin, seedCrossTenantPortalMember, cleanupPortalMember,
  createTestDocument, cleanupTestDocuments, type Fixture, type PortalMemberFixture,
  inviteTokenFromInbox,
} from "./helpers";

/**
 * Option B (Dean, 2026-10-20). One login, several cards on one project (the
 * prod case: two "Amy Parrish" cards, same email, two firms).
 *  - Accepting a second invite never moves the login off the first card
 *    (both accept paths); the new card stays on as a linked card.
 *  - Person shares to ANY linked card reach the login.
 *  - A removed card, or an archived one, stays excluded.
 *  - Removing the login-holding card passes access to the remaining card;
 *    removing the last card ends access.
 *  - The Team tab list names the other cards (firm, trades, date added).
 */
describe("one login, several cards on a project (option B)", () => {
  let co: Fixture;
  let admin = "";
  let member: PortalMemberFixture;
  let portal = "";
  let cardA = ""; // in-house card, holds the login from the first accept
  let cardB = ""; // firm card, accepted in the portal (PIN path)
  let cardC = ""; // second firm card, accepted by email link
  const subIds: string[] = [];
  const docs: Record<string, string> = {};

  async function rowOf(personId: string) {
    return (await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.personId, personId))))[0];
  }
  async function loginRow() {
    return (await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, member.userId))))[0];
  }
  async function sharedIds(): Promise<string[]> {
    const r = await api("/portal/shared", { token: portal });
    expect(r.status).toBe(200);
    return r.json.documents.map((d: any) => d.id);
  }
  async function shareTo(personId: string, docId: string) {
    const r = await api(`/projects/${co.projectId}/portal-shares`, { method: "POST", token: admin, body: { itemType: "document", itemId: docId, audiences: [{ type: "person", personId }] } });
    expect(r.status).toBe(201);
    return r.json.recipientCount as number;
  }
  async function firmCard(companyName: string): Promise<string> {
    const sub = await api("/subcontractors", { method: "POST", token: admin, body: {
      companyName, contactFirstName: "Firm", contactLastName: "Contact", contactEmail: `contact-${Date.now()}-${subIds.length}@sitesort-tests.local`, trades: ["Electrical"],
    } });
    expect([200, 201]).toContain(sub.status);
    subIds.push(sub.json.id);
    // Same name and email as the login's first card, like the Amy pair.
    const person = await api(`/subcontractors/${sub.json.id}/people`, { method: "POST", token: admin, body: { firstName: "Cross", lastName: "Tenant0", email: member.email } });
    expect([200, 201]).toContain(person.status);
    const added = await api(`/projects/${co.projectId}/members/person`, { method: "POST", token: admin, body: { personId: person.json.id, role: "subcontractor" } });
    expect([200, 201]).toContain(added.status);
    return person.json.id;
  }

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    member = await seedCrossTenantPortalMember([co], [admin]);
    cardA = member.personIds[0];
    portal = (await portalLogin(member.email, member.password)).token;
    for (const k of ["A", "B", "C", "all"]) docs[k] = await createTestDocument(co.projectId, admin, { name: `Linked ${k}`, type: "drawing" });

    cardB = await firmCard(`Linked Firm B ${Date.now()}`);
    const invB = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: cardB, role: "subcontractor" } });
    expect(invB.status).toBe(201);
    // The portal's invite list hides projects they're already on, so call the
    // in-portal accept endpoint directly: it is the server path under test.
    const pending = (await db.select({ id: projectInvitesTable.id }).from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.personId, cardB), eq(projectInvitesTable.status, "pending"))))[0];
    expect(pending).toBeTruthy();
    const accB = await api(`/portal/invites/${pending.id}/accept`, { method: "POST", token: portal, body: { pin: member.pin } });
    expect(accB.status).toBe(200);

    cardC = await firmCard(`Linked Firm C ${Date.now()}`);
    const invC = await api(`/projects/${co.projectId}/portal-invites`, { method: "POST", token: admin, body: { personId: cardC, role: "subcontractor" } });
    expect(invC.status).toBe(201);
    const raw = await inviteTokenFromInbox(co.projectId, cardC);
    const accC = await api(`/portal/invite/${raw}/accept`, { method: "POST", body: { password: member.password } });
    expect(accC.status).toBe(200);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    const ids = Object.values(docs);
    await db.delete(portalSharesTable).where(inArray(portalSharesTable.itemId, ids));
    await db.delete(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, ids));
    await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [co.userId, member.userId]));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, member.userId));
    await cleanupTestDocuments(ids);
    await cleanupPortalMember({ ...member, personIds: [cardA, cardB, cardC] }, [co.projectId]);
    if (subIds.length) {
      await db.delete(peopleTable).where(inArray(peopleTable.subcontractorId, subIds));
      await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds));
    }
    await cleanupFixtures([co]);
  });

  it("neither accept path moves the login off the first card", async () => {
    expect((await loginRow())?.personId).toBe(cardA);
    for (const card of [cardB, cardC]) {
      const row = await rowOf(card);
      expect(row).toBeTruthy();
      expect(row.userId).toBeNull();
      const p = (await db.select({ userId: peopleTable.userId }).from(peopleTable).where(eq(peopleTable.id, card)))[0];
      expect(p.userId).toBe(member.userId);
    }
  });

  it("a person share to any linked card reaches the login, and notifies it", async () => {
    expect(await shareTo(cardA, docs.A)).toBe(1);
    expect(await shareTo(cardB, docs.B)).toBe(1);
    expect(await shareTo(cardC, docs.C)).toBe(1);
    const ids = await sharedIds();
    expect(ids).toEqual(expect.arrayContaining([docs.A, docs.B, docs.C]));
  });

  it("the share dialog lists every linked card as on the portal", async () => {
    const { json } = await api(`/projects/${co.projectId}/portal-audience`, { token: admin });
    const by = new Map(json.members.map((m: any) => [m.personId, m]));
    for (const card of [cardA, cardB, cardC]) {
      expect((by.get(card) as any).portalStatus).toBe("member");
      expect((by.get(card) as any).userId).toBe(member.userId);
    }
    expect((by.get(cardA) as any).holdsLogin).toBe(true);
    expect((by.get(cardB) as any).holdsLogin).toBe(false);
  });

  it("the Team tab list names the other cards with firm, trades and date added", async () => {
    const { status, json } = await api(`/projects/${co.projectId}/members`, { token: admin });
    expect(status).toBe(200);
    const a = json.find((m: any) => m.personId === cardA);
    expect(a.otherCards.map((o: any) => o.personId).sort()).toEqual([cardB, cardC].sort());
    const b = a.otherCards.find((o: any) => o.personId === cardB);
    expect(b.companyName).toMatch(/^Linked Firm B/);
    expect(b.trades).toContain("Electrical");
    expect(typeof b.addedAt).toBe("string");
    expect(b.holdsLogin).toBe(false);
    expect(a.portalViaOtherCard).toBe(false);
    const bCard = json.find((m: any) => m.personId === cardB);
    expect(bCard.portalViaOtherCard).toBe(true); // no "Invite to Portal" for it
    expect(bCard.otherCards.find((o: any) => o.personId === cardA).holdsLogin).toBe(true);
  });

  it("an archived linked card stays excluded", async () => {
    await db.update(peopleTable).set({ archivedAt: new Date() }).where(eq(peopleTable.id, cardC));
    try {
      expect(await sharedIds()).not.toContain(docs.C);
    } finally {
      await db.update(peopleTable).set({ archivedAt: null }).where(eq(peopleTable.id, cardC));
    }
    expect(await sharedIds()).toContain(docs.C);
  });

  it("removing a linked card excludes its shares and keeps the login's access and session", async () => {
    const row = await rowOf(cardB);
    const del = await api(`/projects/${co.projectId}/members/${row.id}`, { method: "DELETE", token: admin });
    expect(del.status).toBe(200);
    expect(del.json.accessPassedToPersonId).toBeNull();
    const ids = await sharedIds(); // same token: session not revoked
    expect(ids).not.toContain(docs.B);
    expect(ids).toEqual(expect.arrayContaining([docs.A, docs.C]));
    const live = await db.select().from(portalSessionsTable)
      .where(and(eq(portalSessionsTable.userId, member.userId), eq(portalSessionsTable.projectId, co.projectId), isNotNull(portalSessionsTable.revokedAt)));
    expect(live.length).toBe(0);
  });

  it("removing the login-holding card passes access to the remaining card", async () => {
    const row = await rowOf(cardA);
    const del = await api(`/projects/${co.projectId}/members/${row.id}`, { method: "DELETE", token: admin });
    expect(del.status).toBe(200);
    expect(del.json.accessPassedToPersonId).toBe(cardC);
    expect((await loginRow())?.personId).toBe(cardC);
    const ids = await sharedIds();
    expect(ids).toContain(docs.C);
    expect(ids).not.toContain(docs.A);
  });

  it("removing the last card ends access", async () => {
    const row = await rowOf(cardC);
    const del = await api(`/projects/${co.projectId}/members/${row.id}`, { method: "DELETE", token: admin });
    expect(del.status).toBe(200);
    expect(del.json.accessPassedToPersonId).toBeNull();
    expect(await loginRow()).toBeUndefined();
    const r = await api("/portal/shared", { token: portal });
    expect([401, 403]).toContain(r.status);
  });
});
