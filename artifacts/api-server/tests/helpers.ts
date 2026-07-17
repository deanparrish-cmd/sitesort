import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  usersTable,
  companyMembersTable,
  projectsTable,
  dailyReportsTable,
} from "@workspace/db/schema";

export const API_BASE = process.env.API_BASE ?? "http://localhost:8080/api";
export const TEST_PASSWORD = "Str0ng-Test-Passw0rd!";

export type Fixture = {
  companyId: string;
  userId: string;
  email: string;
  projectId: string;
};

export async function seedCompany(opts: {
  role?: string;
  emailVerified?: boolean;
  portalOnly?: boolean;
} = {}): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `test-co-${suffix}`;
  const userId = `test-user-${suffix}`;
  const projectId = `test-proj-${suffix}`;
  const email = `apitest-${suffix}@sitesort-tests.local`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  await db.insert(companiesTable).values({ id: companyId, name: `Test Co ${suffix}` });
  await db.insert(usersTable).values({
    id: userId,
    companyId,
    email,
    passwordHash,
    name: `Test User ${suffix}`,
    role: opts.role ?? "admin",
    emailVerified: opts.emailVerified ?? true,
    portalOnly: opts.portalOnly ?? false,
  });
  await db.insert(companyMembersTable).values({
    id: `test-mem-${suffix}`,
    userId,
    companyId,
    role: opts.role ?? "admin",
  });
  await db.insert(projectsTable).values({
    id: projectId,
    companyId,
    name: `Test Project ${suffix}`,
    address: "1 Test Street, Testtown",
    startDate: "2026-01-01",
  });

  return { companyId, userId, email, projectId };
}

export async function cleanupFixtures(fixtures: Fixture[]) {
  const projectIds = fixtures.map((f) => f.projectId);
  const userIds = fixtures.map((f) => f.userId);
  const companyIds = fixtures.map((f) => f.companyId);
  if (projectIds.length) {
    await db.delete(dailyReportsTable).where(inArray(dailyReportsTable.projectId, projectIds));
    await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
  }
  if (userIds.length) {
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (companyIds.length) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  }
}

export async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  return { status: res.status, json };
}

export async function login(email: string, password = TEST_PASSWORD): Promise<string> {
  const { status, json } = await api("/auth/login", { method: "POST", body: { email, password } });
  if (status !== 200) throw new Error(`Login failed (${status}): ${JSON.stringify(json)}`);
  return json.token as string;
}
