import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { channelMessagesTable } from "@workspace/db/schema";
import { seedCompany, cleanupFixtures, api, login, type Fixture } from "./helpers";

/**
 * Company data separation: a logged-in user from company A must never be able
 * to read or modify anything belonging to company B.
 */
describe("tenant isolation", () => {
  let a: Fixture;
  let b: Fixture;
  let tokenA: string;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    a = await seedCompany();
    b = await seedCompany();
    fixtures.push(a, b);
    tokenA = await login(a.email);
  });

  afterAll(async () => {
    await cleanupFixtures(fixtures);
  });

  it("can read its own project", async () => {
    const { status, json } = await api(`/projects/${a.projectId}`, { token: tokenA });
    expect(status).toBe(200);
    expect(json.id ?? json.project?.id).toBeTruthy();
  });

  it("cannot read another company's project", async () => {
    const { status } = await api(`/projects/${b.projectId}`, { token: tokenA });
    expect([403, 404]).toContain(status);
  });

  it("project list only contains own company's projects", async () => {
    const { status, json } = await api("/projects", { token: tokenA });
    expect(status).toBe(200);
    const list = Array.isArray(json) ? json : json.projects ?? [];
    const ids = list.map((p: any) => p.id);
    expect(ids).toContain(a.projectId);
    expect(ids).not.toContain(b.projectId);
  });

  it("cannot update another company's project", async () => {
    const { status } = await api(`/projects/${b.projectId}`, {
      method: "PATCH",
      token: tokenA,
      body: { name: "Hacked name" },
    });
    expect([403, 404]).toContain(status);
  });

  it("cannot list another company's daily reports", async () => {
    const { status } = await api(`/projects/${b.projectId}/daily-reports`, { token: tokenA });
    expect([403, 404]).toContain(status);
  });

  it("cannot generate a daily report for another company's project", async () => {
    const { status } = await api(`/projects/${b.projectId}/daily-reports/generate`, {
      method: "POST",
      token: tokenA,
      body: {},
    });
    expect([403, 404]).toContain(status);
  });

  it("cannot list another company's documents", async () => {
    const { status, json } = await api(`/projects/${b.projectId}/documents`, { token: tokenA });
    if (status === 200) {
      // If the endpoint returns 200 it must return an empty, scoped list — never company B data.
      const list = Array.isArray(json) ? json : json.documents ?? [];
      expect(list.length).toBe(0);
    } else {
      expect([403, 404]).toContain(status);
    }
  });

  it("cannot react to another company's channel message", async () => {
    const messageId = `test-msg-${randomUUID().slice(0, 8)}`;
    await db.insert(channelMessagesTable).values({
      id: messageId,
      projectId: b.projectId,
      companyId: b.companyId,
      senderId: b.userId,
      content: "Company B internal message",
    });
    try {
      const { status } = await api(`/channel-messages/${messageId}/react`, {
        method: "POST",
        token: tokenA,
        body: { emoji: "👍" },
      });
      expect(status).toBe(404);
    } finally {
      await db.delete(channelMessagesTable).where(eq(channelMessagesTable.id, messageId));
    }
  });

  it("cannot list another company's members", async () => {
    const { status, json } = await api(`/projects/${b.projectId}/members`, { token: tokenA });
    if (status === 200) {
      const list = Array.isArray(json) ? json : json.members ?? [];
      expect(list.length).toBe(0);
    } else {
      expect([403, 404]).toContain(status);
    }
  });
});
