import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedCompany, cleanupFixtures, login, API_BASE, type Fixture } from "./helpers";
import { removeInvoices } from "../src/lib/invoice-removal";

/**
 * The removed invoices feature is finished off at boot: its attachment files
 * are deleted from storage, then the table is dropped. Afterwards every other
 * upload still serves. Storage deletes are faked: outside the deployed app the
 * storage client refuses them (shared production bucket), which is tested too.
 */
const ORIGIN = API_BASE.replace(/\/api$/, "");

describe("invoice removal", () => {
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
    // The feature's table may already be gone on this database: recreate a
    // minimal one to stand in for production's.
    await db.execute(sql`CREATE TABLE IF NOT EXISTS invoices (id text PRIMARY KEY, company_id text, project_id text, attachment_url text)`);
    await db.execute(sql`INSERT INTO invoices (id, company_id, attachment_url) VALUES (${invoiceId}, ${co.companyId}, ${invoiceFile})`);
  });

  afterAll(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS invoices`);
    await cleanupFixtures([co]);
  });

  it("before removal, other uploads serve", async () => {
    expect((await fetch(`${ORIGIN}${otherFile}`)).status).toBe(200);
  });

  it("outside the deployed app the real delete is refused, and nothing is dropped", async () => {
    // Workspace and production share one bucket: tests never delete files.
    await expect(removeInvoices()).rejects.toThrow(/disabled outside the deployed app/);
    const t = await db.execute(sql`SELECT count(*)::int AS n FROM invoices`);
    expect((t.rows[0] as any).n).toBe(1);
    expect((await fetch(`${ORIGIN}${invoiceFile}`)).status).not.toBe(404); // still in storage
  });

  it("removal deletes the files, then drops the table", async () => {
    const deleted: string[] = [];
    const r = await removeInvoices(async f => { deleted.push(f); });
    expect(r?.files).toBe(1);
    expect(deleted).toEqual([invoiceFile.match(/uploads\/([^?]+)/)![1]]);
    const t = await db.execute(sql`SELECT to_regclass('public.invoices') IS NOT NULL AS present`);
    expect((t.rows[0] as any).present).toBe(false);
    const col = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'invoice_id'`);
    expect(col.rows).toHaveLength(0);
    expect(await removeInvoices()).toBeNull(); // second run is a no-op
  });

  it("if a file can't be deleted, nothing is dropped", async () => {
    await db.execute(sql`CREATE TABLE invoices (id text PRIMARY KEY, company_id text, project_id text, attachment_url text)`);
    await db.execute(sql`INSERT INTO invoices (id, attachment_url) VALUES (${invoiceId}, ${invoiceFile})`);
    await expect(removeInvoices(async () => { throw new Error("storage down"); })).rejects.toThrow("storage down");
    const t = await db.execute(sql`SELECT count(*)::int AS n FROM invoices`);
    expect((t.rows[0] as any).n).toBe(1);
    await db.execute(sql`DROP TABLE invoices`);
  });

  it("after the table is gone, the server that already looked it up still serves other uploads", async () => {
    expect((await fetch(`${ORIGIN}${otherFile}`)).status).toBe(200);
  });
});
