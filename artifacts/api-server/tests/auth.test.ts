import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedCompany, cleanupFixtures, api, TEST_PASSWORD, type Fixture } from "./helpers";

describe("authentication", () => {
  let verified: Fixture;
  let unverified: Fixture;
  let portalOnly: Fixture;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    verified = await seedCompany();
    unverified = await seedCompany({ emailVerified: false });
    portalOnly = await seedCompany({ portalOnly: true });
    fixtures.push(verified, unverified, portalOnly);
  });

  afterAll(async () => {
    await cleanupFixtures(fixtures);
  });

  it("logs in with correct credentials and returns a token + user", async () => {
    const { status, json } = await api("/auth/login", {
      method: "POST",
      body: { email: verified.email, password: TEST_PASSWORD },
    });
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
    expect(json.user.email).toBe(verified.email);
    expect(json.user.companyId).toBe(verified.companyId);
  });

  it("accepts mixed-case email with surrounding whitespace", async () => {
    const messy = `  ${verified.email.toUpperCase()}  `;
    const { status, json } = await api("/auth/login", {
      method: "POST",
      body: { email: messy, password: TEST_PASSWORD },
    });
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
  });

  it("rejects a wrong password with 401", async () => {
    const { status, json } = await api("/auth/login", {
      method: "POST",
      body: { email: verified.email, password: "wrong-password-123" },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("invalid_credentials");
  });

  it("rejects an unknown email with 401 (no user enumeration)", async () => {
    const { status, json } = await api("/auth/login", {
      method: "POST",
      body: { email: `nobody-${crypto.randomUUID().slice(0, 8)}@sitesort-tests.local`, password: TEST_PASSWORD },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("invalid_credentials");
  });

  it("blocks unverified accounts with 403", async () => {
    const { status, json } = await api("/auth/login", {
      method: "POST",
      body: { email: unverified.email, password: TEST_PASSWORD },
    });
    expect(status).toBe(403);
    expect(json.error).toBe("email_not_verified");
  });

  it("blocks portal-only accounts from the dashboard login", async () => {
    const { status, json } = await api("/auth/login", {
      method: "POST",
      body: { email: portalOnly.email, password: TEST_PASSWORD },
    });
    expect(status).toBe(403);
    expect(json.error).toBe("use_portal");
  });

  it("requires a token for authenticated endpoints", async () => {
    const { status } = await api("/auth/me");
    expect(status).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const { status } = await api("/auth/me", { token: "not-a-real-token" });
    expect(status).toBe(401);
  });
});
