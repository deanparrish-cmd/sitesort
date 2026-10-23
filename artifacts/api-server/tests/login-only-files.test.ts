import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { documentsTable, insuranceRecordsTable, subcontractorsTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";
import { signUploadUrl } from "../src/lib/signed-uploads";

/**
 * Part A of the file-link work: uploaded files are login-only. A bare link is
 * refused; the server signs every upload link in the responses it sends, and
 * strips the signature from links that come back in a request body. Since
 * Part B that includes drawings, project documents and permits: they go out
 * only through per-share links (share-links.test.ts).
 *
 * Writes files to the shared bucket but never deletes any (workspace rule).
 */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const ORIGIN = API_BASE.replace(/\/api$/, "");
const fetchUrl = (u: string) => fetch(`${ORIGIN}${u}`);

async function upload(token: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([PDF], { type: "application/pdf" }), "cert.pdf");
  const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return (await res.json()).url;
}
const bare = (u: string) => u.replace(/\?.*$/, "");

describe("uploaded files are login-only", () => {
  let co: Fixture;
  let admin = "";
  let certUrl = "";
  let docUrl = "";
  const sub = `tsub-lo-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    await db.insert(subcontractorsTable).values({ id: sub, companyId: co.companyId, companyName: "Login Only Ltd", contactName: "Lou Only", contactEmail: `${sub}@example.test` });
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, sub));
    await db.delete(documentsTable).where(eq(documentsTable.projectId, co.projectId));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, sub));
    await cleanupFixtures([co]);
  });

  it("the upload response hands back a signed link that opens the file", async () => {
    certUrl = await upload(admin);
    expect(certUrl).toMatch(/^\/api\/uploads\/[^?]+\.pdf\?exp=\d+&sig=/);
    const res = await fetchUrl(certUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/pdf/);
  });

  it("the bare link is refused", async () => {
    expect((await fetchUrl(bare(certUrl))).status).toBe(403);
  });

  it("a tampered or expired signature is refused", async () => {
    // Change the signature's first character to a DIFFERENT one. Always
    // writing "A" left the link untouched whenever the real signature began
    // with "A" (about 1 run in 64), which is why this test was flaky.
    const tampered = certUrl.replace(/sig=(.)/, (_m, c: string) => `sig=${c === "A" ? "B" : "A"}`);
    expect(tampered).not.toBe(certUrl);
    expect((await fetchUrl(tampered)).status).toBe(403);
    const old = signUploadUrl(bare(certUrl), Date.now() - 3 * 24 * 3600_000);
    expect((await fetchUrl(old)).status).toBe(403);
  });

  it("a signed link sent back is stored bare, and comes back signed", async () => {
    const created = await api(`/subcontractors/${sub}/insurance`, {
      method: "POST", token: admin,
      body: { type: "public_liability", certificateUrl: certUrl, expiryDate: "2099-01-01" },
    });
    expect([200, 201]).toContain(created.status);
    const [row] = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, sub));
    expect(row.certificateUrl).toBe(bare(certUrl));
    const subRes = await api(`/subcontractors/${sub}`, { token: admin });
    const urls = JSON.stringify(subRes.json).match(/\/api\/uploads\/[^"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/\?exp=\d+&sig=/);
  });

  it("a project document's bare link is refused too, and it is listed signed (Part B)", async () => {
    docUrl = await upload(admin);
    const created = await api(`/projects/${co.projectId}/documents`, {
      method: "POST", token: admin,
      body: { name: `Drawing ${randomUUID().slice(0, 6)}`, type: "drawing", fileUrl: docUrl },
    });
    expect([200, 201]).toContain(created.status);
    expect(created.json.fileUrl).toMatch(/\?exp=\d+&sig=/);
    expect((await fetchUrl(bare(docUrl))).status).toBe(403);
    const [row] = await db.select().from(documentsTable).where(eq(documentsTable.id, created.json.id));
    expect(row.fileUrl).toBe(bare(docUrl));
    const list = await api(`/projects/${co.projectId}/documents`, { token: admin });
    const listed = (list.json as { fileUrl: string }[]).map(d => d.fileUrl);
    expect(listed.some(u => u.startsWith(bare(docUrl)) && /sig=/.test(u))).toBe(true);
    expect((await fetchUrl(listed.find(u => u.startsWith(bare(docUrl)))!)).status).toBe(200);
  });
});
