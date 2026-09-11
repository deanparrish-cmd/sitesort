import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { failedStripeCancellationsTable } from "@workspace/db/schema";

// Mocks the `stripe` package itself, so this test NEVER makes a real network
// call to Stripe regardless of which key (live or test) is in STRIPE_SECRET_KEY
// — safer than hitting a real test-mode key, since it can't accidentally touch
// the live one. list/cancel are set up per-test below.
const listMock = vi.fn();
const cancelMock = vi.fn();
vi.mock("stripe", () => ({
  default: class {
    subscriptions = { list: listMock, cancel: cancelMock };
  },
}));

// Imported AFTER the mock is registered so it picks up the mocked module.
const { cancelLiveStripeSubscriptions } = await import("../src/lib/stripe-cancellation");

describe("cancelLiveStripeSubscriptions", () => {
  const companyId = "test-stripe-cancel-co";
  const companyName = "Test Stripe Cancel Co";
  const customerId = "cus_test_fake";

  beforeEach(() => {
    listMock.mockReset();
    cancelMock.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_mocked_test";
  });

  afterEach(async () => {
    await db.delete(failedStripeCancellationsTable).where(eq(failedStripeCancellationsTable.companyId, companyId));
  });

  it("does nothing and never calls Stripe when there's no customer id", async () => {
    const result = await cancelLiveStripeSubscriptions(companyId, companyName, null, silentLogger());
    expect(result).toEqual({ cancelled: 0, failed: 0 });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("cancels every active/trialing subscription and records no failure", async () => {
    listMock.mockResolvedValue({
      data: [
        { id: "sub_active", status: "active" },
        { id: "sub_trialing", status: "trialing" },
        { id: "sub_already_cancelled", status: "canceled" }, // must be skipped
      ],
    });
    cancelMock.mockResolvedValue({});

    const result = await cancelLiveStripeSubscriptions(companyId, companyName, customerId, silentLogger());

    expect(result).toEqual({ cancelled: 2, failed: 0 });
    expect(cancelMock).toHaveBeenCalledTimes(2);
    expect(cancelMock).toHaveBeenCalledWith("sub_active");
    expect(cancelMock).toHaveBeenCalledWith("sub_trialing");
    expect(cancelMock).not.toHaveBeenCalledWith("sub_already_cancelled");

    const rows = await db.select().from(failedStripeCancellationsTable).where(eq(failedStripeCancellationsTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });

  it("records a persistent failure (with the subscription id) when a single cancel() call fails, but still cancels the others", async () => {
    listMock.mockResolvedValue({
      data: [
        { id: "sub_good", status: "active" },
        { id: "sub_bad", status: "active" },
      ],
    });
    cancelMock.mockImplementation(async (id: string) => {
      if (id === "sub_bad") throw new Error("stripe API blip");
      return {};
    });

    const result = await cancelLiveStripeSubscriptions(companyId, companyName, customerId, silentLogger());

    expect(result).toEqual({ cancelled: 1, failed: 1 });

    const rows = await db.select().from(failedStripeCancellationsTable).where(eq(failedStripeCancellationsTable.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].subscriptionId).toBe("sub_bad");
    expect(rows[0].stripeCustomerId).toBe(customerId);
    expect(rows[0].companyName).toBe(companyName);
    expect(rows[0].errorMessage).toContain("stripe API blip");
    expect(rows[0].resolvedAt).toBeNull();
  });

  it("records a failure with no subscription id when even listing subscriptions fails", async () => {
    listMock.mockRejectedValue(new Error("network down"));

    const result = await cancelLiveStripeSubscriptions(companyId, companyName, customerId, silentLogger());

    expect(result).toEqual({ cancelled: 0, failed: 1 });
    expect(cancelMock).not.toHaveBeenCalled();

    const rows = await db.select().from(failedStripeCancellationsTable).where(eq(failedStripeCancellationsTable.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].subscriptionId).toBeNull();
    expect(rows[0].errorMessage).toContain("network down");
  });
});

function silentLogger() {
  return { error: () => {}, info: () => {}, warn: () => {} } as any;
}
