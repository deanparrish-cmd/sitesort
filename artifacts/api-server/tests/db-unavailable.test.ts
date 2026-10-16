// Database-down handling: errors are classified (and unwrapped from Drizzle),
// and the watchdog emails once per outage and once on recovery.
import { describe, it, expect, vi, beforeEach } from "vitest";

const probe = vi.fn();
const sendAlert = vi.fn().mockResolvedValue(undefined);
vi.mock("@workspace/db", async (orig) => ({ ...(await orig<typeof import("@workspace/db")>()), probeDb: () => probe() }));
vi.mock("../src/lib/email", () => ({ sendOpsAlertEmail: (...a: unknown[]) => sendAlert(...a) }));

import { classifyDbError, isDbUnavailableError } from "@workspace/db";
import { runDbWatchdogCheck } from "../src/lib/db-watchdog";
import { opsAlertAddresses } from "../src/lib/environment";

describe("classifyDbError", () => {
  it("unwraps a Drizzle query error to the driver error", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const wrapped = Object.assign(new Error("Failed query: select 1"), { cause: inner });
    expect(classifyDbError(wrapped)).toMatchObject({ kind: "unreachable", code: "ECONNREFUSED" });
    expect(isDbUnavailableError(wrapped)).toBe(true);
  });
  it("reads a disabled/suspended endpoint as paused", () => {
    expect(classifyDbError(new Error("The endpoint has been disabled. Enable it and retry.")).kind).toBe("paused");
  });
  it("leaves an ordinary query error alone", () => {
    const err = Object.assign(new Error('relation "invoices" does not exist'), { code: "42P01" });
    expect(isDbUnavailableError(err)).toBe(false);
  });
});

describe("db watchdog", () => {
  beforeEach(() => { sendAlert.mockClear(); process.env.OPS_ALERT_EMAIL = "ops@example.invalid, second@example.invalid"; });
  it("alerts once after two failures, then once on recovery", async () => {
    const failure = { ok: false, failure: { kind: "paused", code: null, message: "endpoint disabled" } };
    probe.mockResolvedValue(failure);
    await runDbWatchdogCheck();
    expect(sendAlert).not.toHaveBeenCalled();
    await runDbWatchdogCheck();
    await runDbWatchdogCheck();
    expect(sendAlert).toHaveBeenCalledTimes(2); // one per address
    expect(sendAlert.mock.calls.map(c => c[0])).toEqual(["ops@example.invalid", "second@example.invalid"]);
    expect(sendAlert.mock.calls[0][1]).toBe("SiteSort database is PAUSED");
    probe.mockResolvedValue({ ok: true });
    await runDbWatchdogCheck();
    await runDbWatchdogCheck();
    expect(sendAlert).toHaveBeenCalledTimes(4);
    expect(sendAlert.mock.calls[2][1]).toBe("SiteSort database is back");
  });
});

describe("OPS_ALERT_EMAIL parsing", () => {
  it("accepts commas, semicolons and spaces, and drops junk", () => {
    process.env.OPS_ALERT_EMAIL = " a@x.co.uk, b@y.com;c@z.org  not-an-email ,, ";
    expect(opsAlertAddresses()).toEqual(["a@x.co.uk", "b@y.com", "c@z.org"]);
  });
});
