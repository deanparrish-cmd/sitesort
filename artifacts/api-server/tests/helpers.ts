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
  peopleTable,
  projectMembersTable,
  projectInvitesTable,
  portalSessionsTable,
  documentsTable,
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

export const PORTAL_TEST_PASSWORD = "Str0ng-Portal-Test-Passw0rd!";
export const PORTAL_TEST_PIN = "9182";

export type PortalMemberFixture = {
  email: string;
  password: string;
  pin: string;
  userId: string;
  personIds: string[]; // one people row per company fixture, in the order passed in
};

// Invites the SAME real human (by email) into a project in EACH of the given
// company fixtures, going through the real HTTP invite-creation + accept flow
// (not a DB shortcut) so the cross-tenant test exercises the actual code path.
// The first fixture creates the portalOnly account (email-link accept); every
// subsequent fixture is delivered as an in-portal invite (same email already
// has a portal login) and accepted via the in-portal accept endpoint, which
// requires a sign-off PIN — set once, right after the first accept.
export async function seedCrossTenantPortalMember(fixtures: { companyId: string; projectId: string }[], adminTokens: string[]): Promise<PortalMemberFixture> {
  if (fixtures.length < 1) throw new Error("seedCrossTenantPortalMember needs at least one fixture");
  const suffix = randomUUID().slice(0, 8);
  const email = `portal-crosstenant-${suffix}@sitesort-tests.local`;
  const personIds: string[] = [];
  let sharedToken = "";

  for (let i = 0; i < fixtures.length; i++) {
    const { projectId } = fixtures[i];
    const adminToken = adminTokens[i];
    const personRes = await api(`/projects/${projectId}/in-house-people`, {
      method: "POST", token: adminToken,
      body: { firstName: "Cross", lastName: `Tenant${i}`, email },
    });
    if (personRes.status !== 200 && personRes.status !== 201) {
      throw new Error(`Failed to create person for fixture ${i}: ${personRes.status} ${JSON.stringify(personRes.json)}`);
    }
    personIds.push(personRes.json.id);

    const inviteRes = await api(`/projects/${projectId}/portal-invites`, {
      method: "POST", token: adminToken,
      body: { personId: personRes.json.id, role: "subcontractor" },
    });
    if (inviteRes.status !== 201) {
      throw new Error(`Failed to create invite for fixture ${i}: ${inviteRes.status} ${JSON.stringify(inviteRes.json)}`);
    }

    if (i === 0) {
      // First invite: brand-new person, no portal login yet -> email-link accept.
      const rawToken = String(inviteRes.json.inviteUrl).split("/accept/")[1];
      const acceptRes = await api(`/portal/invite/${rawToken}/accept`, {
        method: "POST", body: { password: PORTAL_TEST_PASSWORD },
      });
      if (acceptRes.status !== 200 || !acceptRes.json.token) {
        throw new Error(`Failed to accept first invite: ${acceptRes.status} ${JSON.stringify(acceptRes.json)}`);
      }
      sharedToken = acceptRes.json.token;
      // Sign-off PIN is required to accept any FURTHER invite in-portal.
      const pinRes = await api("/portal/pin", {
        method: "POST", token: sharedToken,
        body: { currentPassword: PORTAL_TEST_PASSWORD, pin: PORTAL_TEST_PIN },
      });
      if (pinRes.status !== 200) throw new Error(`Failed to set portal PIN: ${pinRes.status} ${JSON.stringify(pinRes.json)}`);
    } else {
      // Same email already has a portal login -> delivered in-portal, accept via PIN.
      const invitesRes = await api("/portal/invites", { token: sharedToken });
      const pending = (invitesRes.json?.invites ?? []).find((iv: any) => iv.projectId === projectId);
      if (!pending) throw new Error(`Expected an in-portal invite for project ${projectId}, got: ${JSON.stringify(invitesRes.json)}`);
      const acceptRes = await api(`/portal/invites/${pending.id}/accept`, {
        method: "POST", token: sharedToken, body: { pin: PORTAL_TEST_PIN },
      });
      if (acceptRes.status !== 200) throw new Error(`Failed to accept in-portal invite: ${acceptRes.status} ${JSON.stringify(acceptRes.json)}`);
    }
  }

  const meRes = await api("/portal/me", { token: sharedToken });
  return { email, password: PORTAL_TEST_PASSWORD, pin: PORTAL_TEST_PIN, userId: meRes.json.member.userId, personIds };
}

export async function portalLogin(email: string, password: string, projectId?: string): Promise<{ token: string; projectId: string }> {
  const { status, json } = await api("/portal/login", { method: "POST", body: { email, password, ...(projectId ? { projectId } : {}) } });
  if (status !== 200) throw new Error(`Portal login failed (${status}): ${JSON.stringify(json)}`);
  return { token: json.token as string, projectId: json.project.id as string };
}

// Removes everything a seedCrossTenantPortalMember() call creates, in FK-safe
// order (project_members/invites/sessions before the projects/companies they
// reference — those don't cascade on project delete).
export async function cleanupPortalMember(m: PortalMemberFixture, projectIds: string[]) {
  if (m.userId) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.userId, m.userId));
  if (projectIds.length) await db.delete(projectMembersTable).where(inArray(projectMembersTable.projectId, projectIds));
  if (projectIds.length) await db.delete(projectInvitesTable).where(inArray(projectInvitesTable.projectId, projectIds));
  if (m.personIds.length) await db.delete(peopleTable).where(inArray(peopleTable.id, m.personIds));
  if (m.userId) await db.delete(usersTable).where(eq(usersTable.id, m.userId));
}

export async function createTestDocument(projectId: string, adminToken: string, opts: { name: string; type: string }): Promise<string> {
  const res = await api(`/projects/${projectId}/documents`, {
    method: "POST", token: adminToken,
    body: { name: opts.name, type: opts.type, fileUrl: `/api/uploads/test-${randomUUID()}.pdf`, fileSize: 100 },
  });
  if (res.status !== 200 && res.status !== 201) throw new Error(`Failed to create test document: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id as string;
}

export async function cleanupTestDocuments(documentIds: string[]) {
  if (documentIds.length) await db.delete(documentsTable).where(inArray(documentsTable.id, documentIds));
}
