import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { subcontractorsTable, peopleTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * A contact's job role/trade (roleTitle) is stored on its primary-contact
 * `people` row, not on the subcontractor row itself, and is mirrored on
 * create/update the same way name/email/phone already are.
 */
describe("subcontractor roleTitle", () => {
  let a: Fixture;
  let b: Fixture;
  let tokenA: string;
  let tokenB: string;
  const fixtures: Fixture[] = [];
  const subIds: string[] = [];

  beforeAll(async () => {
    a = await seedCompany();
    b = await seedCompany();
    fixtures.push(a, b);
    tokenA = await login(a.email);
    tokenB = await login(b.email);
  });

  afterAll(async () => {
    // subcontractors/people aren't cascade-deleted with the company fixture.
    if (subIds.length) {
      await db.delete(peopleTable).where(inArray(peopleTable.subcontractorId, subIds));
      await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds));
    }
    await cleanupFixtures(fixtures);
  });

  it("sets roleTitle on create and returns it", async () => {
    const { status, json } = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Jo",
        contactLastName: "Carpenter",
        contactEmail: `jo-${Date.now()}@example.com`,
        contactType: "self_employed",
        roleTitle: "  Carpenter  ",
        trades: [],
      },
    });
    expect(status).toBe(201);
    expect(json.roleTitle).toBe("Carpenter");
    subIds.push(json.id);

    const list = await api("/subcontractors", { token: tokenA });
    const found = list.json.find((s: any) => s.id === json.id);
    expect(found.roleTitle).toBe("Carpenter");

    const detail = await api(`/subcontractors/${json.id}`, { token: tokenA });
    expect(detail.json.roleTitle).toBe("Carpenter");
  });

  it("updates roleTitle and mirrors it onto the primary person row", async () => {
    const created = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Sam",
        contactLastName: "Labourer",
        contactEmail: `sam-${Date.now()}@example.com`,
        contactType: "self_employed",
        trades: [],
      },
    });
    subIds.push(created.json.id);
    expect(created.json.roleTitle).toBeNull();

    const patched = await api(`/subcontractors/${created.json.id}`, {
      method: "PATCH",
      token: tokenA,
      body: { roleTitle: "Labourer" },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.roleTitle).toBe("Labourer");

    const person = await db.select({ roleTitle: peopleTable.roleTitle }).from(peopleTable)
      .where(eq(peopleTable.subcontractorId, created.json.id)).limit(1);
    expect(person[0]?.roleTitle).toBe("Labourer");
  });

  it("clears roleTitle when patched with null", async () => {
    const created = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Alex",
        contactLastName: "Fitter",
        contactEmail: `alex-${Date.now()}@example.com`,
        contactType: "self_employed",
        roleTitle: "Fitter",
        trades: [],
      },
    });
    subIds.push(created.json.id);

    const patched = await api(`/subcontractors/${created.json.id}`, {
      method: "PATCH",
      token: tokenA,
      body: { roleTitle: null },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.roleTitle).toBeNull();
  });

  it("cannot set roleTitle on another company's contact", async () => {
    const created = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Pat",
        contactLastName: "Roofer",
        contactEmail: `pat-${Date.now()}@example.com`,
        contactType: "self_employed",
        trades: [],
      },
    });
    subIds.push(created.json.id);

    const { status } = await api(`/subcontractors/${created.json.id}`, {
      method: "PATCH",
      token: tokenB,
      body: { roleTitle: "Hacked" },
    });
    expect([403, 404]).toContain(status);

    const person = await db.select({ roleTitle: peopleTable.roleTitle }).from(peopleTable)
      .where(eq(peopleTable.subcontractorId, created.json.id)).limit(1);
    expect(person[0]?.roleTitle).not.toBe("Hacked");
  });
});
