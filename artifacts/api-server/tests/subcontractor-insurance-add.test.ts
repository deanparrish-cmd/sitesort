import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { subcontractorsTable, peopleTable, insuranceRecordsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * Task #43 — adding a contact's insurance from the Contacts workflow reuses
 * POST /subcontractors/:id/insurance, the same endpoint the Compliance Centre
 * and Team Insurance & Site Access already write through.
 */
describe("subcontractor insurance add (Contacts workflow)", () => {
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
    if (subIds.length) {
      await db.delete(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, subIds));
      await db.delete(peopleTable).where(inArray(peopleTable.subcontractorId, subIds));
      await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds));
    }
    await cleanupFixtures(fixtures);
  });

  it("flips insuranceStatus from none to valid after adding a certificate", async () => {
    const created = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Robin",
        contactLastName: "Roofer",
        contactEmail: `robin-${Date.now()}@example.com`,
        contactType: "self_employed",
        trades: [],
      },
    });
    subIds.push(created.json.id);
    expect(created.json.insuranceStatus).toBe("none");

    const oneYearOut = new Date();
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
    const expiryDate = oneYearOut.toISOString().slice(0, 10);

    const added = await api(`/subcontractors/${created.json.id}/insurance`, {
      method: "POST",
      token: tokenA,
      body: { type: "public_liability", certificateUrl: "/uploads/test-cert.pdf", expiryDate },
    });
    expect(added.status).toBe(201);
    expect(added.json.status).toBe("valid");

    const detail = await api(`/subcontractors/${created.json.id}`, { token: tokenA });
    expect(detail.json.insuranceStatus).toBe("valid");
    expect(detail.json.insuranceRecords.some((r: any) => r.type === "public_liability")).toBe(true);

    const list = await api("/subcontractors", { token: tokenA });
    const found = list.json.find((s: any) => s.id === created.json.id);
    expect(found.insuranceStatus).toBe("valid");
  });

  it("replaces the previous record of the same type instead of stacking", async () => {
    const created = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Kim",
        contactLastName: "Glazier",
        contactEmail: `kim-${Date.now()}@example.com`,
        contactType: "self_employed",
        trades: [],
      },
    });
    subIds.push(created.json.id);

    await api(`/subcontractors/${created.json.id}/insurance`, {
      method: "POST",
      token: tokenA,
      body: { type: "public_liability", certificateUrl: "/uploads/old-cert.pdf", expiryDate: "2027-01-01" },
    });
    await api(`/subcontractors/${created.json.id}/insurance`, {
      method: "POST",
      token: tokenA,
      body: { type: "public_liability", certificateUrl: "/uploads/new-cert.pdf", expiryDate: "2028-01-01" },
    });

    const detail = await api(`/subcontractors/${created.json.id}`, { token: tokenA });
    const pliRecords = detail.json.insuranceRecords.filter((r: any) => r.type === "public_liability");
    expect(pliRecords.length).toBe(1);
    expect(pliRecords[0].certificateUrl).toBe("/uploads/new-cert.pdf");
  });

  it("cannot add insurance to another company's contact", async () => {
    const created = await api("/subcontractors", {
      method: "POST",
      token: tokenA,
      body: {
        contactFirstName: "Nat",
        contactLastName: "Plumber",
        contactEmail: `nat-${Date.now()}@example.com`,
        contactType: "self_employed",
        trades: [],
      },
    });
    subIds.push(created.json.id);

    const { status } = await api(`/subcontractors/${created.json.id}/insurance`, {
      method: "POST",
      token: tokenB,
      body: { type: "public_liability", certificateUrl: "/uploads/hacked.pdf", expiryDate: "2028-01-01" },
    });
    expect([403, 404]).toContain(status);

    const detail = await api(`/subcontractors/${created.json.id}`, { token: tokenA });
    expect(detail.json.insuranceStatus).toBe("none");
  });
});
