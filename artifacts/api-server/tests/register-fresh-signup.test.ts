import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { companiesTable, usersTable } from "@workspace/db/schema";
import { api } from "./helpers";

// Regression coverage for the bug this whole deletion rework started from: a
// genuinely fresh signup (no prior history) must always be asked for a card —
// betaAccess defaults false and subscriptionStatus starts "incomplete", with
// no path for either to be pre-set. See admin-user-deletion.test.ts for the
// deletion side (a deleted company can never leak state into a later signup,
// because there's nothing left for a fresh registration to attach to).
describe("a genuinely fresh signup is correctly gated behind checkout", () => {
  const suffix = randomUUID().slice(0, 8);
  const email = `fresh-signup-${suffix}@sitesort-tests.local`;
  let companyId: string | null = null;

  afterAll(async () => {
    await db.delete(usersTable).where(eq(usersTable.email, email));
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("creates a company with betaAccess false and subscriptionStatus incomplete", async () => {
    const { status } = await api("/auth/register", {
      method: "POST",
      body: { companyName: `Fresh Signup Co ${suffix}`, adminName: "Fresh Signup", email, password: "Str0ng-Test-Passw0rd!", companySize: "1-10" },
    });
    expect(status).toBe(201);

    const [user] = await db.select({ companyId: usersTable.companyId }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    expect(user).toBeTruthy();
    companyId = user.companyId;

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId!)).limit(1);
    expect(company.betaAccess).toBe(false);
    expect(company.subscriptionStatus).toBe("incomplete");
  });
});
