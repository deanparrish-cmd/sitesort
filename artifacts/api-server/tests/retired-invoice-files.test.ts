import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";

/**
 * The invoices feature was removed but its attachments stayed on permanent,
 * no-login URLs. Those files now answer 410; every other upload is unchanged.
 */
const ORIGIN = API_BASE.replace(/\/api$/, "");

describe("removed invoice attachments are never served", () => {
  let co: Fixture;
  let invoiceFile = "";
  let otherFile = "";
  const invoiceId = `tinv-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    co = await seedCompany();
    const token = await login(co.email);
    const upload = async () => {
      const fd = new FormData();
      fd.append("file", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "x.pdf");
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
      return (await res.json()).url as string;
    };
    invoiceFile = await upload();
    otherFile = await upload();
    await db.execute(sql`INSERT INTO invoices (id, company_id, created_by, direction, counterparty_name, description, amount, due_date, attachment_url)
      VALUES (${invoiceId}, ${co.companyId}, ${co.userId}, 'incoming', 'Test Supplier', 'Test', 100, '2026-12-01', ${invoiceFile})`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM invoices WHERE id = ${invoiceId}`);
    await cleanupFixtures([co]);
  });

  it("an invoice attachment returns 410 with no login", async () => {
    const res = await fetch(`${ORIGIN}${invoiceFile}`);
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("gone");
  });

  it("an ordinary upload still serves", async () => {
    expect((await fetch(`${ORIGIN}${otherFile}`)).status).toBe(200);
  });

  it("health is unaffected (sanity)", async () => {
    expect((await api("/healthz")).status).toBe(200);
  });
});
