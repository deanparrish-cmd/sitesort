import { describe, expect, it } from "vitest";
import type { PlantItem } from "@workspace/api-client-react";
import {
  buildPlantWeeklyReportHtml,
  canAccessPlantWeeklyReport,
} from "./plant-weekly-report-export";

const plantItem = (overrides: Partial<PlantItem> = {}): PlantItem => ({
  id: "plant-1",
  projectId: "project-1",
  name: "Excavator",
  category: "plant_equipment",
  status: "on_site",
  quantity: 1,
  unit: "item",
  location: "North compound",
  supplierOwnerText: "Safe Supplier",
  supplierContactId: null,
  supplierContactName: null,
  notes: null,
  onSiteDate: "2026-08-17",
  expectedOffHireDate: "2026-08-23",
  actualOffHireDate: null,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  portalDraft: false,
  submittedAt: null,
  submittedBy: null,
  lastUpdatedBy: null,
  lastUpdatedByName: null,
  attachmentCount: 0,
  createdAt: "2026-08-17T09:00:00.000Z",
  updatedAt: "2026-08-17T09:00:00.000Z",
  ...overrides,
} as PlantItem);

describe("weekly hired-plant report access", () => {
  it("allows managers and project-authorised users", () => {
    expect(canAccessPlantWeeklyReport(true)).toBe(true);
  });

  it("rejects users without project-management authority", () => {
    expect(canAccessPlantWeeklyReport(false)).toBe(false);
  });
});

describe("weekly hired-plant report export", () => {
  it("renders user-entered HTML and script-like text as plain text", () => {
    const attack = `<img src=x onerror="globalThis.pwned=1"><script>alert('x')</script>`;
    const quantityAttack = `<svg onload="globalThis.quantityPwned=1">`;
    const item = plantItem({
      name: attack,
      quantity: quantityAttack as unknown as PlantItem["quantity"],
      location: attack,
      supplierOwnerText: attack,
      unit: attack,
    });

    const html = buildPlantWeeklyReportHtml({
      projectName: attack,
      weekLabel: "17 to 23 Aug 2026",
      generatedLabel: "21 August 2026 at 15:30",
      buckets: { active: [item], overdue: [], returned: [] },
      missing: [item],
      formatDate: iso => iso,
    });

    expect(html).not.toContain(attack);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain(quantityAttack);
    expect(html).toContain("&lt;img src=x onerror=&quot;globalThis.pwned=1&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;svg onload=&quot;globalThis.quantityPwned=1&quot;&gt;");
  });
});