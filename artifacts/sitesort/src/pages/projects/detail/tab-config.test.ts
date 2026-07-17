import { describe, it, expect } from "vitest";
import { buildManagementTabs, buildActivityTabs } from "./tab-config";
import { deriveCapabilities, type Role } from "@/hooks/use-capabilities";

const capsFor = (role: Role | null) => deriveCapabilities(role);

const values = (tabs: { value: string }[]) => tabs.map(t => t.value);

describe("project detail tab gating", () => {
  it("admin sees closeout, reports and teamportal", () => {
    const caps = capsFor("admin");
    expect(values(buildManagementTabs(caps, 0))).toContain("closeout");
    const activity = values(buildActivityTabs(caps, 0));
    expect(activity).toContain("reports");
    expect(activity).toContain("teamportal");
  });

  it("project_manager sees closeout, reports and teamportal", () => {
    const caps = capsFor("project_manager");
    expect(values(buildManagementTabs(caps, 0))).toContain("closeout");
    const activity = values(buildActivityTabs(caps, 0));
    expect(activity).toContain("reports");
    expect(activity).toContain("teamportal");
  });

  it("site_worker sees reports but NOT closeout or teamportal", () => {
    const caps = capsFor("site_worker");
    expect(values(buildManagementTabs(caps, 0))).not.toContain("closeout");
    const activity = values(buildActivityTabs(caps, 0));
    expect(activity).toContain("reports");
    expect(activity).not.toContain("teamportal");
  });

  it("subcontractor sees neither reports, teamportal nor closeout", () => {
    const caps = capsFor("subcontractor");
    expect(values(buildManagementTabs(caps, 0))).not.toContain("closeout");
    const activity = values(buildActivityTabs(caps, 0));
    expect(activity).not.toContain("reports");
    expect(activity).not.toContain("teamportal");
  });

  it("always-visible tabs are present for every role", () => {
    for (const role of ["admin", "project_manager", "site_worker", "subcontractor", null] as (Role | null)[]) {
      const caps = capsFor(role);
      const mgmt = values(buildManagementTabs(caps, 0));
      for (const v of ["overview", "progress", "team", "issues", "qr", "documents", "permits"]) {
        expect(mgmt).toContain(v);
      }
      const activity = values(buildActivityTabs(caps, 0));
      expect(activity).toContain("finances");
      expect(activity).toContain("checkins");
    }
  });

  it("issue and check-in counts appear in labels only when non-zero", () => {
    const caps = capsFor("admin");
    expect(buildManagementTabs(caps, 3).find(t => t.value === "issues")?.label).toBe("Site Issues (3)");
    expect(buildManagementTabs(caps, 0).find(t => t.value === "issues")?.label).toBe("Site Issues");
    expect(buildActivityTabs(caps, 2).find(t => t.value === "checkins")?.label).toBe("Check-ins (2)");
    expect(buildActivityTabs(caps, 0).find(t => t.value === "checkins")?.label).toBe("Check-ins");
  });
});
