import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, subcontractorsTable, insuranceRecordsTable, projectsTable, peopleTable, projectInvitesTable, companyMembersTable } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";
import { revokePortalSessionsForMember } from "../lib/portal-sessions";
import { canonicalPersonName } from "../lib/person-name";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can remove team members." });
    return false;
  }
  return true;
}

async function loadOwnedProject(projectId: string, companyId: string) {
  const rows = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}

// Revokes portal access + cancels any pending invite for a person being
// removed from a project. Safe to call for a legacy row with no personId
// (no-op). Reused by both single-member and whole-company removal below.
async function revokePersonFromProject(personId: string, projectId: string) {
  const person = await db.select({ userId: peopleTable.userId }).from(peopleTable)
    .where(eq(peopleTable.id, personId)).limit(1);
  if (person[0]?.userId) await revokePortalSessionsForMember(person[0].userId, projectId);
  await db.update(projectInvitesTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(
      eq(projectInvitesTable.personId, personId),
      eq(projectInvitesTable.projectId, projectId),
      eq(projectInvitesTable.status, "pending"),
    ));
}

// Reuse the canonical expiry helper (F1) — insurance says "valid" where the
// shared helper says "active"; the expiring_soon/expired bands are identical.
function computeRecordStatus(expiryDate: string): "valid" | "expiring_soon" | "expired" {
  const s = expiryStatus(expiryDate);
  return s === "active" ? "valid" : s;
}

function getInsuranceStatus(records: Array<{ expiryDate: string }>): string {
  if (records.length === 0) return "none";
  const statuses = records.map(r => computeRecordStatus(r.expiryDate));
  if (statuses.some(s => s === "expired")) return "hold";
  if (statuses.some(s => s === "expiring_soon")) return "warning";
  return "ok";
}

router.get("/projects/:projectId/members", authenticate, async (req, res) => {
  try {
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const members = await db.select().from(projectMembersTable).where(eq(projectMembersTable.projectId, req.params.projectId));

    // Shared company-level compliance lookup (PLI + insurance status), used by
    // both the personId branch (person belongs to a firm) and the legacy
    // company-only branch below.
    async function companyCompliance(subcontractorId: string) {
      const sub = await db.select({ paymentHold: subcontractorsTable.paymentHold }).from(subcontractorsTable).where(eq(subcontractorsTable.id, subcontractorId)).limit(1);
      let complianceStatus: string;
      if (sub[0]?.paymentHold) {
        complianceStatus = "hold";
      } else {
        const insuranceRows = await db.select({ expiryDate: insuranceRecordsTable.expiryDate }).from(insuranceRecordsTable).where(and(eq(insuranceRecordsTable.subcontractorId, subcontractorId), isNull(insuranceRecordsTable.archivedAt)));
        complianceStatus = getInsuranceStatus(insuranceRows);
      }
      const pliRows = await db.select({ certificateUrl: insuranceRecordsTable.certificateUrl, expiryDate: insuranceRecordsTable.expiryDate })
        .from(insuranceRecordsTable)
        .where(and(eq(insuranceRecordsTable.subcontractorId, subcontractorId), eq(insuranceRecordsTable.type, "public_liability"), isNull(insuranceRecordsTable.archivedAt)))
        .limit(1);
      return { complianceStatus, pliCertUrl: pliRows[0]?.certificateUrl ?? null, pliExpiryDate: pliRows[0]?.expiryDate ?? null };
    }

    const result = await Promise.all(members.map(async (m) => {
      let name = "Unknown";
      let complianceStatus: string = "ok";
      let email: string | null = null;
      let phone: string | null = null;
      let contactName: string | null = null;
      let companyName: string | null = null;
      let contactType: string | null = null;
      let roleTitle: string | null = null;
      let isPrimaryContact = false;
      let trades: string[] = [];
      let avatarUrl: string | null = null;
      let pliCertUrl: string | null = null;
      let pliExpiryDate: string | null = null;

      if (m.personId) {
        // Person-first: every card sourced from a real `people` row, whether or
        // not they've accepted a portal invite yet (Feature: person-first cards).
        const personRows = await db.select({
          name: peopleTable.name, firstName: peopleTable.firstName, lastName: peopleTable.lastName,
          email: peopleTable.email, phone: peopleTable.phone,
          roleTitle: peopleTable.roleTitle, isPrimaryContact: peopleTable.isPrimaryContact,
          subcontractorId: peopleTable.subcontractorId,
          companyName: subcontractorsTable.companyName, contactType: subcontractorsTable.contactType,
          contactFirstName: subcontractorsTable.contactFirstName, contactLastName: subcontractorsTable.contactLastName,
          contactName: subcontractorsTable.contactName,
          trades: subcontractorsTable.trades, avatarUrl: subcontractorsTable.avatarUrl,
        })
          .from(peopleTable)
          .leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
          .where(eq(peopleTable.id, m.personId)).limit(1);
        const p = personRows[0];
        // Never trust people.name blindly for a subcontractor-linked contact —
        // it's a copy-on-write mirror of subcontractors.contactName that can
        // drift (see lib/person-name.ts). Resolve the canonical name instead.
        name = p ? canonicalPersonName(p, p.subcontractorId ? p : null).name : "Unknown";
        email = p?.email ?? null;
        phone = p?.phone ?? null;
        roleTitle = p?.roleTitle ?? null;
        isPrimaryContact = p?.isPrimaryContact ?? false;
        companyName = p?.companyName ?? null;
        contactType = p?.contactType ?? null;
        trades = p?.trades ?? [];
        avatarUrl = p?.avatarUrl ?? null;
        if (p?.subcontractorId) {
          const c = await companyCompliance(p.subcontractorId);
          complianceStatus = c.complianceStatus;
          pliCertUrl = c.pliCertUrl;
          pliExpiryDate = c.pliExpiryDate;
        }
        // A dashboard account (real or portalOnly) may carry its own uploaded
        // avatar and a more current phone number — prefer those when present.
        if (m.userId) {
          const userRows = await db.select({ phone: usersTable.phone, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, m.userId)).limit(1);
          phone = userRows[0]?.phone ?? phone;
          avatarUrl = userRows[0]?.avatarUrl ?? avatarUrl;
        }
      } else if (m.userId) {
        // Legacy: a plain dashboard user added directly to a project, no
        // `people` abstraction (in-house staff added before this feature, or
        // added via the direct-userId path).
        const userRows = await db.select({ name: usersTable.name, email: usersTable.email, phone: usersTable.phone, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, m.userId)).limit(1);
        name = userRows[0]?.name ?? "Unknown";
        email = userRows[0]?.email ?? null;
        phone = userRows[0]?.phone ?? null;
        avatarUrl = userRows[0]?.avatarUrl ?? null;
      } else if (m.subcontractorId) {
        // Legacy: a "whole firm" row with no specific person — should be rare/
        // none after the primary-contact backfill (ensure-schema.ts); kept for
        // defensive backward-compat only.
        const subRows = await db.select({
          companyName: subcontractorsTable.companyName,
          contactName: subcontractorsTable.contactName,
          contactEmail: subcontractorsTable.contactEmail,
          contactPhone: subcontractorsTable.contactPhone,
          contactType: subcontractorsTable.contactType,
          trades: subcontractorsTable.trades,
          avatarUrl: subcontractorsTable.avatarUrl,
        }).from(subcontractorsTable).where(eq(subcontractorsTable.id, m.subcontractorId)).limit(1);
        // Person, never company, is the display name — a "whole firm" row here
        // means no specific contact was linked, not that the firm's name IS the
        // contact's name (that was the exact bug: this used to read companyName).
        name = subRows[0]?.contactName?.trim() || subRows[0]?.companyName || "Unknown";
        contactName = subRows[0]?.contactName ?? null;
        companyName = subRows[0]?.companyName ?? null;
        contactType = subRows[0]?.contactType ?? null;
        email = subRows[0]?.contactEmail ?? null;
        phone = subRows[0]?.contactPhone ?? null;
        trades = subRows[0]?.trades ?? [];
        avatarUrl = subRows[0]?.avatarUrl ?? null;
        const c = await companyCompliance(m.subcontractorId);
        complianceStatus = c.complianceStatus;
        pliCertUrl = c.pliCertUrl;
        pliExpiryDate = c.pliExpiryDate;
      }

      return {
        id: m.id,
        projectId: m.projectId,
        userId: m.userId ?? null,
        subcontractorId: m.subcontractorId ?? null,
        personId: m.personId ?? null,
        name,
        contactName,
        companyName,
        contactType,
        roleTitle,
        isPrimaryContact,
        email,
        phone,
        trades,
        avatarUrl,
        pliCertUrl,
        pliExpiryDate,
        role: m.role,
        complianceStatus,
        scheduledDays: m.scheduledDays ?? [],
        siteStartTime: m.siteStartTime ?? null,
        siteEndTime: m.siteEndTime ?? null,
        canLogIssues: m.canLogIssues,
        canUpdatePlantMaterials: m.canUpdatePlantMaterials,
        canEditDailyReport: m.canEditDailyReport,
        addedAt: m.addedAt.toISOString(),
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List members error");
    res.status(500).json({ error: "server_error", message: "Failed to list members" });
  }
});

router.post("/projects/:projectId/members", authenticate, async (req, res) => {
  try {
    const { userId, subcontractorId, role } = req.body;
    if (!role) {
      res.status(400).json({ error: "validation_error", message: "role is required" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    if (userId) {
      const existing = await db.select().from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, userId)))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "conflict", message: "User is already a member of this project" });
        return;
      }
    } else if (subcontractorId) {
      const existing = await db.select().from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.subcontractorId, subcontractorId)))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "conflict", message: "Subcontractor is already a member of this project" });
        return;
      }
    }

    const id = generateId();
    await db.insert(projectMembersTable).values({
      id,
      projectId: req.params.projectId,
      userId: userId ?? null,
      subcontractorId: subcontractorId ?? null,
      role,
    });

    let name = "Unknown";
    if (userId) {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      name = userRows[0]?.name ?? "Unknown";
    } else if (subcontractorId) {
      const subRows = await db.select({ companyName: subcontractorsTable.companyName }).from(subcontractorsTable).where(eq(subcontractorsTable.id, subcontractorId)).limit(1);
      name = subRows[0]?.companyName ?? "Unknown";
    }

    res.status(201).json({ id, projectId: req.params.projectId, userId: userId ?? null, subcontractorId: subcontractorId ?? null, name, role, complianceStatus: "ok", addedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Add member error");
    res.status(500).json({ error: "server_error", message: "Failed to add member" });
  }
});

// POST /projects/:projectId/members/person — add a SPECIFIC person (subcontractor
// employee, self-employed contact, or in-house) to a project's team immediately
// (Feature: person-first cards + add flow). Creates the project_members row with
// personId set right away — no portal acceptance required; inviting them to the
// portal afterwards is a separate, optional action via the existing pill.
router.post("/projects/:projectId/members/person", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const { personId, role } = req.body as { personId?: string; role?: string };
    if (!personId) { res.status(400).json({ error: "validation_error", message: "personId is required" }); return; }

    const personRows = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.id, personId), eq(peopleTable.companyId, req.user!.companyId))).limit(1);
    const person = personRows[0];
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }

    const existing = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.personId, personId)))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "conflict", message: "This person is already on the project" });
      return;
    }

    // Reuse a linked dashboard account (real or already-portalOnly) if this
    // person has one — same lookup as the portal-invite-accept shortcut in
    // people.ts, so userId is consistent everywhere a person has a project row.
    let userId: string | null = person.userId ?? null;
    if (!userId) {
      const dashUser = (await db.select().from(usersTable)
        .where(and(eq(usersTable.email, person.email), eq(usersTable.portalOnly, false))).limit(1))[0];
      if (dashUser) {
        let dashInCompany = dashUser.companyId === req.user!.companyId;
        if (!dashInCompany) {
          const cm = await db.select({ id: companyMembersTable.id }).from(companyMembersTable)
            .where(and(eq(companyMembersTable.userId, dashUser.id), eq(companyMembersTable.companyId, req.user!.companyId))).limit(1);
          dashInCompany = cm.length > 0;
        }
        if (dashInCompany) {
          userId = dashUser.id;
          await db.update(peopleTable).set({ userId: dashUser.id }).where(eq(peopleTable.id, person.id));
        }
      }
    }

    const id = generateId();
    await db.insert(projectMembersTable).values({
      id,
      projectId: req.params.projectId,
      personId: person.id,
      subcontractorId: person.subcontractorId ?? null,
      userId,
      role: role ?? "worker",
    });

    const inserted = await db.select().from(projectMembersTable).where(eq(projectMembersTable.id, id)).limit(1);
    res.status(201).json({
      id, projectId: req.params.projectId, userId, subcontractorId: person.subcontractorId ?? null, personId: person.id,
      name: person.name, role: role ?? "worker", complianceStatus: "ok", addedAt: inserted[0].addedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Add person to project error");
    res.status(500).json({ error: "server_error", message: "Failed to add person to project" });
  }
});

router.post("/projects/:projectId/members/:memberId/insurance-cert", authenticate, async (req, res) => {
  try {
    const { certificateUrl, expiryDate } = req.body;
    if (!certificateUrl || !expiryDate) {
      res.status(400).json({ error: "validation_error", message: "certificateUrl and expiryDate are required" }); return;
    }
    const memberRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)))
      .limit(1);
    if (!memberRows.length || !memberRows[0].subcontractorId) {
      res.status(404).json({ error: "not_found", message: "Subcontractor member not found" }); return;
    }
    const subId = memberRows[0].subcontractorId;
    // Upsert: update existing PLI record or insert new one
    const existing = await db.select().from(insuranceRecordsTable)
      .where(and(eq(insuranceRecordsTable.subcontractorId, subId), eq(insuranceRecordsTable.type, "public_liability")))
      .limit(1);
    if (existing.length) {
      await db.update(insuranceRecordsTable)
        .set({ certificateUrl, expiryDate, status: "valid" })
        .where(eq(insuranceRecordsTable.id, existing[0].id));
    } else {
      await db.insert(insuranceRecordsTable).values({
        id: generateId(), subcontractorId: subId, type: "public_liability",
        certificateUrl, expiryDate, status: "valid",
      });
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Insurance cert error");
    res.status(500).json({ error: "server_error", message: "Failed to save certificate" });
  }
});

router.patch("/projects/:projectId/members/:memberId/contact", authenticate, async (req, res) => {
  try {
    const { phone } = req.body;
    const memberRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)))
      .limit(1);
    if (!memberRows.length) { res.status(404).json({ error: "not_found", message: "Member not found" }); return; }
    const m = memberRows[0];
    if (m.userId) {
      await db.update(usersTable).set({ phone: phone || null }).where(eq(usersTable.id, m.userId));
    } else if (m.subcontractorId) {
      await db.update(subcontractorsTable).set({ contactPhone: phone || null }).where(eq(subcontractorsTable.id, m.subcontractorId));
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update contact error");
    res.status(500).json({ error: "server_error", message: "Failed to update contact" });
  }
});

router.patch("/projects/:projectId/members/:memberId/avatar", authenticate, async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (!avatarUrl) { res.status(400).json({ error: "validation_error", message: "avatarUrl required" }); return; }

    const memberRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)))
      .limit(1);
    if (!memberRows.length) { res.status(404).json({ error: "not_found", message: "Member not found" }); return; }

    const m = memberRows[0];
    if (m.userId) {
      await db.update(usersTable).set({ avatarUrl }).where(eq(usersTable.id, m.userId));
    } else if (m.subcontractorId) {
      await db.update(subcontractorsTable).set({ avatarUrl }).where(eq(subcontractorsTable.id, m.subcontractorId));
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update avatar error");
    res.status(500).json({ error: "server_error", message: "Failed to update avatar" });
  }
});

router.patch("/projects/:projectId/members/:memberId/schedule", authenticate, async (req, res) => {
  try {
    const { scheduledDays, siteStartTime, siteEndTime } = req.body;
    await db.update(projectMembersTable)
      .set({
        scheduledDays: scheduledDays ?? [],
        siteStartTime: siteStartTime || null,
        siteEndTime: siteEndTime || null,
      })
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update member schedule error");
    res.status(500).json({ error: "server_error", message: "Failed to update schedule" });
  }
});

// PATCH /api/projects/:projectId/members/:memberId/permissions — grants a
// portal member specific WRITE capabilities (log site issues / update plant &
// materials). Manager-gated: only a PM/admin can change another member's
// permissions. Enforced server-side on the actual write endpoints via
// requirePortalPermission — this endpoint only flips the stored flag.
router.patch("/projects/:projectId/members/:memberId/permissions", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const { canLogIssues, canUpdatePlantMaterials, canEditDailyReport } = req.body as { canLogIssues?: boolean; canUpdatePlantMaterials?: boolean; canEditDailyReport?: boolean };
    const updates: Partial<typeof projectMembersTable.$inferInsert> = {};
    if (canLogIssues !== undefined) updates.canLogIssues = canLogIssues;
    if (canUpdatePlantMaterials !== undefined) updates.canUpdatePlantMaterials = canUpdatePlantMaterials;
    if (canEditDailyReport !== undefined) updates.canEditDailyReport = canEditDailyReport;
    await db.update(projectMembersTable)
      .set(updates)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update member permissions error");
    res.status(500).json({ error: "server_error", message: "Failed to update permissions" });
  }
});

// DELETE /api/projects/:projectId/members/:memberId — remove one person/user
// from a project's team. Manager-gated, tenant-scoped. Revokes any live
// portal session + cancels a pending invite before deleting the membership
// row, so access dies immediately (requirePortalMember also re-checks the
// row on the member's very next request as a backstop). Past activity_log /
// document_distributions / acknowledgment_audit_log rows are untouched —
// they key off users.id, which is never deleted here.
router.delete("/projects/:projectId/members/:memberId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const rows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId))).limit(1);
    const member = rows[0];
    if (!member) { res.status(404).json({ error: "not_found", message: "Member not found" }); return; }

    let removedName = "Team member";
    if (member.personId) {
      const person = await db.select({ name: peopleTable.name }).from(peopleTable).where(eq(peopleTable.id, member.personId)).limit(1);
      if (person[0]) removedName = person[0].name;
      await revokePersonFromProject(member.personId, req.params.projectId);
    } else if (member.userId) {
      const user = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, member.userId)).limit(1);
      if (user[0]) removedName = user[0].name;
    }

    await db.delete(projectMembersTable).where(eq(projectMembersTable.id, member.id));
    res.json({ success: true, removedName });
  } catch (err) {
    req.log.error({ err }, "Remove member error");
    res.status(500).json({ error: "server_error", message: "Failed to remove member" });
  }
});

// DELETE /api/projects/:projectId/members/company/:subcontractorId — remove a
// subcontractor firm AND every one of its people from this project in one
// action. Manager-gated, tenant-scoped. Mirrors the single-member removal
// above per row (revoke session, cancel pending invite, delete).
router.delete("/projects/:projectId/members/company/:subcontractorId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const sub = await db.select({ id: subcontractorsTable.id, companyName: subcontractorsTable.companyName }).from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId))).limit(1);
    if (!sub[0]) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    const removedNames: string[] = [];

    // The company's own row (subcontractorId set, personId null).
    const companyRow = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
      .where(and(
        eq(projectMembersTable.projectId, req.params.projectId),
        eq(projectMembersTable.subcontractorId, sub[0].id),
        isNull(projectMembersTable.personId),
      )).limit(1);
    if (companyRow[0]) {
      await db.delete(projectMembersTable).where(eq(projectMembersTable.id, companyRow[0].id));
      removedNames.push(sub[0].companyName);
    }

    // Every person under this firm who's on this project.
    const people = await db.select({ id: peopleTable.id, name: peopleTable.name }).from(peopleTable)
      .where(eq(peopleTable.subcontractorId, sub[0].id));
    for (const person of people) {
      const memberRow = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.personId, person.id))).limit(1);
      if (!memberRow[0]) continue;
      await revokePersonFromProject(person.id, req.params.projectId);
      await db.delete(projectMembersTable).where(eq(projectMembersTable.id, memberRow[0].id));
      removedNames.push(person.name);
    }

    res.json({ success: true, removedNames });
  } catch (err) {
    req.log.error({ err }, "Remove company error");
    res.status(500).json({ error: "server_error", message: "Failed to remove subcontractor from project" });
  }
});

export default router;
