import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

describe("daily reports", () => {
  let admin: Fixture;
  let token: string;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    admin = await seedCompany({ role: "admin" });
    fixtures.push(admin);
    token = await login(admin.email);
  });

  afterAll(async () => {
    await cleanupFixtures(fixtures);
  });

  it("generates a report for a date and returns its id", async () => {
    const { status, json } = await api(`/projects/${admin.projectId}/daily-reports/generate`, {
      method: "POST",
      token,
      body: { reportDate: "2026-07-01" },
    });
    expect([200, 201]).toContain(status);
    expect(json.reportId).toBeTruthy();
    expect(json.reportDate).toBe("2026-07-01");
  });

  it("rejects a malformed report date", async () => {
    const { status, json } = await api(`/projects/${admin.projectId}/daily-reports/generate`, {
      method: "POST",
      token,
      body: { reportDate: "01/07/2026" },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("validation_error");
  });

  it("lists the generated report for the project", async () => {
    const { status, json } = await api(`/projects/${admin.projectId}/daily-reports`, { token });
    expect(status).toBe(200);
    const list = Array.isArray(json) ? json : json.reports ?? [];
    expect(list.length).toBeGreaterThan(0);
  });

  it("returns full report detail with a well-formed data payload", async () => {
    const gen = await api(`/projects/${admin.projectId}/daily-reports/generate`, {
      method: "POST",
      token,
      body: { reportDate: "2026-07-02" },
    });
    const { status, json } = await api(`/daily-reports/${gen.json.reportId}`, { token });
    expect(status).toBe(200);
    // The frontend crashed in the past on reports whose data was missing
    // arrays — assert the API returns them so old and new clients are safe.
    expect(json.data).toBeTruthy();
    for (const key of ["subcontractorsOnSite", "sitePhotos", "siteManagerNotes"]) {
      expect(Array.isArray(json.data[key]), `data.${key} must be an array`).toBe(true);
    }
  });

  it("404s for a non-existent report id", async () => {
    const { status } = await api(`/daily-reports/00000000-0000-0000-0000-000000000000`, { token });
    expect(status).toBe(404);
  });
});
