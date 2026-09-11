import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { projectMembersTable } from "@workspace/db/schema";
import { api, cleanupFixtures, login, seedCompany, type Fixture } from "./helpers";

describe("weekly hired-plant report access", () => {
  let manager: Fixture;
  let siteWorker: Fixture;
  let managerToken: string;
  let siteWorkerToken: string;
  const fixtures: Fixture[] = [];
  const projectMemberId = "test-weekly-report-approver";

  beforeAll(async () => {
    manager = await seedCompany({ role: "project_manager" });
    siteWorker = await seedCompany({ role: "site_worker" });
    fixtures.push(manager, siteWorker);
    managerToken = await login(manager.email);
    siteWorkerToken = await login(siteWorker.email);
  });

  afterAll(async () => {
    await db.delete(projectMembersTable).where(eq(projectMembersTable.id, projectMemberId));
    await cleanupFixtures(fixtures);
  });

  it("allows a company manager to load the weekly report data", async () => {
    const { status, json } = await api(`/projects/${manager.projectId}/plant-items/weekly-report`, {
      token: managerToken,
    });

    expect(status).toBe(200);
    expect(json).toEqual([]);
  });

  it("denies a non-manager until they receive project-specific authority", async () => {
    const denied = await api(`/projects/${siteWorker.projectId}/plant-items/weekly-report`, {
      token: siteWorkerToken,
    });
    expect(denied.status).toBe(403);

    await db.insert(projectMembersTable).values({
      id: projectMemberId,
      projectId: siteWorker.projectId,
      userId: siteWorker.userId,
      role: "worker",
      isProjectManager: true,
    });

    const allowed = await api(`/projects/${siteWorker.projectId}/plant-items/weekly-report`, {
      token: siteWorkerToken,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.json).toEqual([]);
  });
});