import { describe, it, expect } from "vitest";
import { API_BASE } from "./helpers";
import { productionUpload, uploadFile, getBucket } from "../src/lib/gcs";
import { environmentSummary, stripeSecretKey, IS_DEPLOYED } from "../src/lib/environment";
import { sendWelcomeEmail } from "../src/lib/email";

/**
 * The workspace shares a storage bucket, secrets and (through copied rows)
 * real people's addresses with production. Outside the deployed app nothing
 * outward-facing or destructive may run. These checks run in the workspace and
 * against the workspace API server; none of them touch a real file.
 */
describe("workspace is isolated from production", () => {
  it("this process is not the deployed app", () => {
    expect(IS_DEPLOYED).toBe(false);
  });

  it("file deletion is refused by the storage client", async () => {
    const f = productionUpload("never-a-real-file.pdf");
    expect(() => f.delete()).toThrow(/disabled outside the deployed app/);
    expect(() => f.move("elsewhere.pdf")).toThrow(/disabled outside the deployed app/);
    expect(() => f.setMetadata({})).toThrow(/disabled outside the deployed app/);
    expect(() => getBucket().deleteFiles({ prefix: "x" })).toThrow(/disabled outside the deployed app/);
  });

  it("writing into production's folder is refused; new uploads go to the workspace folder", () => {
    expect(() => productionUpload("never-a-real-file.pdf").save(Buffer.from("x"))).toThrow(/outside the workspace folder/);
    expect(uploadFile("new.pdf").name).toMatch(/(^|\/)workspace-uploads\/new\.pdf$/);
  });

  it("a live Stripe key is never used here", () => {
    const key = stripeSecretKey();
    expect(key === null || key.startsWith("sk_test_")).toBe(true);
  });

  it("email to a real address is suppressed", async () => {
    const r = await sendWelcomeEmail("someone.real@gmail.com", "Someone Real") as { data?: { id?: string } };
    expect(r?.data?.id).toBe("suppressed-not-deployed");
  });

  it("the running API server reports itself as not deployed, with jobs, email and deletion off", async () => {
    const res = await fetch(`${API_BASE}/health`);
    const env = (await res.json()).environment;
    expect(env).toMatchObject({ deployed: false, email: "off", scheduledJobs: "off", fileDeletion: "off" });
    expect(env.stripe).not.toBe("live");
    expect(environmentSummary().stripe).not.toBe("live");
  });
});
