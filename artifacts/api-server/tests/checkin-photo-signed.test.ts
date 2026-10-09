import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  siteCheckinsTable, qrCodesTable, subcontractorsTable, projectMembersTable, insuranceRecordsTable, notificationsTable,
} from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture } from "./helpers";
import { signUploadUrl } from "../src/lib/signed-uploads";

/**
 * Check-in photos (workers' faces) are never served from a bare URL: only a
 * short-lived signed URL handed out by an authenticated endpoint works, and the
 * public QR responses never carry the photo, GPS or identity key at all.
 */
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const ORIGIN = API_BASE.replace(/\/api$/, "");
const fetchUrl = (u: string) => fetch(`${ORIGIN}${u}`);

describe("check-in photos need a signed, expiring URL", () => {
  let co: Fixture;
  let admin = "";
  let qrToken = "";
  let bareUrl = "";
  const sub = `tsub-sig-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    co = await seedCompany();
    admin = await login(co.email);
    qrToken = (await api(`/projects/${co.projectId}/qr-codes`, { method: "POST", token: admin, body: { categories: ["site_board"] } })).json[0].token;
    await db.insert(subcontractorsTable).values({ id: sub, companyId: co.companyId, companyName: "Signed Ltd", contactName: "Sam Signed", contactEmail: `${sub}@example.test`, contactPhone: "07700 900321" });
    await db.insert(insuranceRecordsTable).values({ id: randomUUID(), subcontractorId: sub, type: "public_liability", certificateUrl: "/api/uploads/y.pdf", expiryDate: "2099-01-01" } as any);
    await db.insert(projectMembersTable).values({ id: randomUUID(), projectId: co.projectId, subcontractorId: sub } as any);
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 600));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, co.userId));
    await db.delete(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, sub));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, co.projectId));
    await db.delete(subcontractorsTable).where(inArray(subcontractorsTable.id, [sub]));
    await db.delete(qrCodesTable).where(eq(qrCodesTable.projectId, co.projectId));
    await cleanupFixtures([co]);
  });

  it("the public check-in response carries no photo, GPS or identity key", async () => {
    const fd = new FormData();
    fd.append("photo", new Blob([JPG], { type: "image/jpeg" }), "c.jpg");
    fd.append("phone", "07700 900321");
    fd.append("lat", "51.5");
    fd.append("lng", "-0.1");
    const res = await fetch(`${API_BASE}/site/${qrToken}/checkin`, { method: "POST", body: fd });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json).not.toHaveProperty("photoUrl");
    expect(json).not.toHaveProperty("lat");
    expect(json).not.toHaveProperty("lng");
    expect(json).not.toHaveProperty("personKey");
    const [row] = await db.select().from(siteCheckinsTable).where(eq(siteCheckinsTable.projectId, co.projectId));
    bareUrl = row.photoUrl;
    expect(bareUrl).toMatch(/^\/api\/uploads\/checkin-/);
  });

  it("the bare stored URL is refused with no login", async () => {
    expect((await fetchUrl(bareUrl)).status).toBe(403);
  });

  it("the manager's list hands out a signed URL that serves the photo", async () => {
    const list = await api(`/projects/${co.projectId}/checkins`, { token: admin });
    expect(list.status).toBe(200);
    const signed: string = list.json[0].photoUrl;
    expect(signed).toMatch(/^\/api\/uploads\/checkin-[^?]+\?exp=\d+&sig=/);
    const res = await fetchUrl(signed);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image/);
  });

  it("a tampered or expired signature is refused", async () => {
    const signed = signUploadUrl(bareUrl);
    // Always a DIFFERENT first character (a fixed "X" did nothing when the sig began with X).
    const tampered = signed.replace(/sig=(.)/, (_m, c: string) => `sig=${c === "X" ? "Y" : "X"}`);
    expect((await fetchUrl(tampered)).status).toBe(403);
    const old = signUploadUrl(bareUrl, Date.now() - 3 * 3_600_000);
    expect((await fetchUrl(old)).status).toBe(403);
  });

  it("public sign-out returns no photo or GPS", async () => {
    const res = await api(`/site/${qrToken}/checkout`, { method: "POST", body: { workerName: "Sam Signed", companyName: "Signed Ltd", phone: "07700 900321" } });
    expect(res.status).toBe(200);
    expect(res.json).not.toHaveProperty("photoUrl");
    expect(res.json).not.toHaveProperty("lat");
  });
});
