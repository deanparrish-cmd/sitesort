import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { projectMembersTable, photosTable, dailyReportsTable } from "@workspace/db/schema";
import {
  seedCompany, cleanupFixtures, api, login, API_BASE, type Fixture,
  seedCrossTenantPortalMember, portalLogin, cleanupPortalMember, type PortalMemberFixture,
} from "./helpers";
import { londonDateStr } from "../src/lib/daily-reports";

/**
 * Photos on the daily report from the Team Portal. One save path shared with the
 * dashboard: each photo is a `photos` row tagged with daily_report_date, so it
 * shows in the report AND the project photo library.
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function portalUpload(token: string, date: string, opts: { name: string; type: string; data: Buffer }) {
  const fd = new FormData();
  fd.append("file", new Blob([opts.data], { type: opts.type }), opts.name);
  const res = await fetch(`${API_BASE}/portal/daily-report/${date}/photos/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("portal daily report photos", () => {
  let co: Fixture;
  let member: PortalMemberFixture;
  let token = "";
  let adminToken = "";
  const today = londonDateStr(new Date());

  beforeAll(async () => {
    co = await seedCompany();
    adminToken = await login(co.email);
    member = await seedCrossTenantPortalMember([{ companyId: co.companyId, projectId: co.projectId }], [adminToken]);
    token = (await portalLogin(member.email, member.password, co.projectId)).token;
  });

  afterAll(async () => {
    await db.delete(photosTable).where(eq(photosTable.projectId, co.projectId));
    await db.delete(dailyReportsTable).where(eq(dailyReportsTable.projectId, co.projectId));
    await cleanupPortalMember(member, [co.projectId]);
    await cleanupFixtures([co]);
  });

  it("is refused without the canEditDailyReport permission", async () => {
    expect((await api(`/portal/daily-report/${today}/photos`, { token })).status).toBe(403);
    expect((await portalUpload(token, today, { name: "a.png", type: "image/png", data: PNG })).status).toBe(403);
    expect((await api(`/portal/daily-report/${today}/photos`, { method: "POST", token, body: { photos: [] } })).status).toBe(403);
  });

  describe("with the permission", () => {
    beforeAll(async () => {
      await db.update(projectMembersTable).set({ canEditDailyReport: true })
        .where(and(eq(projectMembersTable.projectId, co.projectId), eq(projectMembersTable.userId, member.userId)));
    });

    it("rejects non-image uploads", async () => {
      const r = await portalUpload(token, today, { name: "doc.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4") });
      expect(r.status).toBe(400);
    });

    it("uploads, saves with captions, lists, and appears in the project photo library tagged with the date", async () => {
      const up1 = await portalUpload(token, today, { name: "one.png", type: "image/png", data: PNG });
      const up2 = await portalUpload(token, today, { name: "two.png", type: "image/png", data: PNG });
      expect(up1.status).toBe(201);
      expect(up1.json.url).toMatch(/^\/api\/uploads\//);

      const save = await api(`/portal/daily-report/${today}/photos`, {
        method: "POST", token,
        body: { photos: [{ photoUrl: up1.json.url, caption: "Slab poured" }, { photoUrl: up2.json.url }] },
      });
      expect(save.status).toBe(201);
      expect(save.json).toHaveLength(2);
      expect(save.json.find((p: any) => p.caption === "Slab poured")).toBeTruthy();

      const list = await api(`/portal/daily-report/${today}/photos`, { token });
      expect(list.json).toHaveLength(2);

      const library = await api(`/projects/${co.projectId}/photos`, { token: adminToken });
      const tagged = library.json.filter((p: any) => p.dailyReportDate === today);
      expect(tagged).toHaveLength(2);
      expect(tagged.every((p: any) => p.category === "progress")).toBe(true);

      // The dashboard reads the same rows: no second copy exists.
      const dash = await api(`/projects/${co.projectId}/daily-reports/${today}/photos`, { token: adminToken });
      expect(dash.json).toHaveLength(2);
    });

    it("rejects URLs that did not come from an upload", async () => {
      const r = await api(`/portal/daily-report/${today}/photos`, { method: "POST", token, body: { photos: [{ photoUrl: "https://evil.example/x.jpg" }] } });
      expect(r.status).toBe(400);
    });

    it("blocks a locked (old) day and a future day", async () => {
      const old = londonDateStr(new Date(Date.now() - 5 * 86400_000));
      expect((await portalUpload(token, old, { name: "o.png", type: "image/png", data: PNG })).status).toBe(403);
      const future = londonDateStr(new Date(Date.now() + 3 * 86400_000));
      expect((await portalUpload(token, future, { name: "f.png", type: "image/png", data: PNG })).status).toBe(400);
    });

    it("blocks adding photos once the report is submitted", async () => {
      expect((await api(`/portal/daily-report/${today}`, { method: "PATCH", token, body: { workCompleted: "Poured slab" } })).status).toBe(200);
      expect((await api(`/portal/daily-report/${today}/submit`, { method: "POST", token })).status).toBe(200);
      const up = await portalUpload(token, today, { name: "late.png", type: "image/png", data: PNG });
      expect(up.status).toBe(403);
      expect(up.json.error).toBe("submitted");
    });
  });
});
