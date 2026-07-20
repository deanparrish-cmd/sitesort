import { Router, type IRouter } from "express";
import { randomBytes, createHash } from "crypto";
import { db } from "@workspace/db";
import {
  peopleTable, subcontractorsTable, projectsTable, projectMembersTable,
  projectInvitesTable, usersTable, companyMembersTable, companiesTable,
  documentDistributionsTable, notificationsTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray, isNull, isNotNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendProjectInviteEmail } from "../lib/invite-email";
import { CreateSubcontractorPersonBody, CreatePortalInviteBody, UpdatePersonBody } from "@workspace/api-zod";
import { activeProjectsForPerson, hasAnyHistoricalFootprint } from "../lib/contact-removal";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can manage people." });
    return false;
  }
  return true;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
function inviteBaseUrl(): string {
  return process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "www.sitesort.co.uk"}`;
}

// Request-body types (validated by the generated api-zod schemas).
type CreatePersonInput = { firstName: string; lastName: string; email: string; phone?: string; roleTitle?: string };
type PortalInviteInput = { personId?: string; role?: "worker" | "manager" | "subcontractor" };

// ---- shared: portal status for a person on a project ----
// One definition of a person's per-project portal state, so every list agrees.
// member (accepted, has a membership row) > invited (pending, unexpired) > not_invited.
type PortalStatus = {
  status: "not_invited" | "invited" | "member";
  role?: string;
  inviteId?: string;
  lastActiveAt?: string;
  emailStatus?: string;      // 'sent' | 'failed' (undefined = never attempted)
  emailLastSentAt?: string;
  memberId?: string;               // project_members.id — needed to PATCH .../permissions
  canLogIssues?: boolean;
  canUpdatePlantMaterials?: boolean;
  canEditDailyReport?: boolean;
};
async function portalStatusFor(personIds: string[], projectId: string): Promise<Map<string, PortalStatus>> {
  const out = new Map<string, PortalStatus>();
  if (personIds.length === 0) return out;
  const [members, invites] = await Promise.all([
    db.select({
      id: projectMembersTable.id, personId: projectMembersTable.personId, role: projectMembersTable.role,
      userId: projectMembersTable.userId, lastActiveAt: usersTable.lastActiveAt,
      canLogIssues: projectMembersTable.canLogIssues, canUpdatePlantMaterials: projectMembersTable.canUpdatePlantMaterials,
      canEditDailyReport: projectMembersTable.canEditDailyReport,
    })
      .from(projectMembersTable)
      .leftJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
      .where(and(eq(projectMembersTable.projectId, projectId), inArray(projectMembersTable.personId, personIds))),
    db.select({ id: projectInvitesTable.id, personId: projectInvitesTable.personId, role: projectInvitesTable.role, status: projectInvitesTable.status, expiresAt: projectInvitesTable.expiresAt, emailStatus: projectInvitesTable.emailStatus, emailLastSentAt: projectInvitesTable.emailLastSentAt })
      .from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.projectId, projectId), inArray(projectInvitesTable.personId, personIds)))
      .orderBy(desc(projectInvitesTable.createdAt)),
  ]);
  // Latest invite per person (invites already ordered newest-first) — used to give
  // the UI an inviteId to revoke against, for members AND pending invites alike.
  const latestInvite = new Map<string, { id: string; status: string; expiresAt: Date; role: string; emailStatus: string | null; emailLastSentAt: Date | null }>();
  for (const inv of invites) if (inv.personId && !latestInvite.has(inv.personId)) latestInvite.set(inv.personId, { id: inv.id, status: inv.status, expiresAt: inv.expiresAt, role: inv.role, emailStatus: inv.emailStatus, emailLastSentAt: inv.emailLastSentAt });

  const memberByPerson = new Map(members.filter(m => m.personId).map(m => [m.personId as string, m]));

  for (const m of members) {
    if (!m.personId) continue;
    // A project_members row alone only means "on this project's team" (Feature:
    // person-first add flow can create one with no portal access at all) — a
    // real portal member additionally has a linked userId (real or portalOnly
    // account from accepting an invite).
    if (m.userId) {
      out.set(m.personId, {
        status: "member", role: m.role,
        lastActiveAt: m.lastActiveAt ? m.lastActiveAt.toISOString() : undefined,
        inviteId: latestInvite.get(m.personId)?.id,
        memberId: m.id,
        canLogIssues: m.canLogIssues,
        canUpdatePlantMaterials: m.canUpdatePlantMaterials,
        canEditDailyReport: m.canEditDailyReport,
      });
    }
  }
  for (const [personId, inv] of latestInvite) {
    if (out.has(personId)) continue; // member wins
    if (inv.status === "pending" && inv.expiresAt.getTime() > Date.now()) {
      out.set(personId, {
        status: "invited", role: inv.role, inviteId: inv.id,
        memberId: memberByPerson.get(personId)?.id,
        emailStatus: inv.emailStatus ?? undefined,
        emailLastSentAt: inv.emailLastSentAt ? inv.emailLastSentAt.toISOString() : undefined,
      });
    }
  }
  for (const id of personIds) {
    if (out.has(id)) continue;
    out.set(id, { status: "not_invited", memberId: memberByPerson.get(id)?.id });
  }
  return out;
}

// Fetch the inviter's display name + the company name once, for the invite email.
async function inviteContext(inviterUserId: string, companyId: string): Promise<{ inviterName: string; companyName: string }> {
  const [u, c] = await Promise.all([
    db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, inviterUserId)).limit(1),
    db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1),
  ]);
  return { inviterName: u[0]?.name ?? "Your project manager", companyName: c[0]?.name ?? "their company" };
}

// Send an invite email and persist the delivery state on the invite row. Records
// the attempt time (drives the resend rate limit + display) regardless of outcome.
async function deliverInvite(params: {
  inviteId: string; email: string; name: string; role: string;
  inviterName: string; companyName: string; projectName: string; inviteUrl: string;
}): Promise<"sent" | "failed"> {
  const result = await sendProjectInviteEmail(params);
  const emailStatus = result.delivered ? "sent" : "failed";
  await db.update(projectInvitesTable)
    .set({ emailStatus, emailLastSentAt: new Date() })
    .where(eq(projectInvitesTable.id, params.inviteId));
  return emailStatus;
}

function serializePerson(p: typeof peopleTable.$inferSelect, portal?: PortalStatus, subInfo?: { companyName: string; contactType: string; trades: string[] }) {
  return {
    id: p.id, subcontractorId: p.subcontractorId ?? undefined, userId: p.userId ?? undefined,
    name: p.name, firstName: p.firstName ?? null, lastName: p.lastName ?? null,
    email: p.email, phone: p.phone ?? undefined, roleTitle: p.roleTitle ?? undefined,
    showContactInPortal: p.showContactInPortal ?? undefined,
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : undefined,
    kind: p.subcontractorId ? "subcontractor" : "in_house",
    isPrimaryContact: p.isPrimaryContact,
    companyName: subInfo?.companyName ?? undefined,
    contactType: subInfo?.contactType ?? undefined,
    trades: subInfo?.trades ?? undefined,
    portal: portal ?? undefined,
  };
}

async function loadOwnedSubcontractor(subId: string, companyId: string) {
  const rows = await db.select().from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subId), eq(subcontractorsTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}
async function loadOwnedProject(projectId: string, companyId: string) {
  const rows = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}

// ==========================================================================
// FLAT PEOPLE DIRECTORY (Feature: person-first cards) — every person for the
// tenant, subcontractor-linked or in-house, in one list. Powers the
// person-first "Add from Contacts Directory" picker and share/allocate
// pickers, so they no longer have to be assembled client-side from separate
// per-subcontractor calls.
// ==========================================================================

// GET /api/people[?projectId=] — flat list of every active person for the
// company. With projectId, each person carries onProject (already added to
// that project's team).
router.get("/people", authenticate, async (req, res) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const people = await db.select({
      id: peopleTable.id, subcontractorId: peopleTable.subcontractorId, userId: peopleTable.userId,
      name: peopleTable.name, firstName: peopleTable.firstName, lastName: peopleTable.lastName,
      email: peopleTable.email, phone: peopleTable.phone, roleTitle: peopleTable.roleTitle,
      isPrimaryContact: peopleTable.isPrimaryContact, archivedAt: peopleTable.archivedAt,
      companyName: subcontractorsTable.companyName, contactType: subcontractorsTable.contactType,
      trades: subcontractorsTable.trades,
    })
      .from(peopleTable)
      .leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
      .where(and(eq(peopleTable.companyId, req.user!.companyId), isNull(peopleTable.archivedAt)));

    let onProjectIds = new Set<string>();
    if (projectId) {
      const members = await db.select({ personId: projectMembersTable.personId }).from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, projectId), isNotNull(projectMembersTable.personId)));
      onProjectIds = new Set(members.map(m => m.personId!));
    }

    res.json(people.map(p => ({
      id: p.id, subcontractorId: p.subcontractorId ?? undefined, userId: p.userId ?? undefined,
      name: p.name, firstName: p.firstName ?? null, lastName: p.lastName ?? null,
      email: p.email, phone: p.phone ?? undefined, roleTitle: p.roleTitle ?? undefined,
      archivedAt: p.archivedAt ? p.archivedAt.toISOString() : undefined,
      kind: p.subcontractorId ? "subcontractor" : "in_house",
      isPrimaryContact: p.isPrimaryContact,
      companyName: p.companyName ?? undefined,
      contactType: p.contactType ?? undefined,
      trades: p.trades ?? undefined,
      onProject: projectId ? onProjectIds.has(p.id) : undefined,
    })));
  } catch (err) {
    req.log.error({ err }, "List all people error");
    res.status(500).json({ error: "server_error", message: "Failed to list people" });
  }
});

// ==========================================================================
// PEOPLE under a subcontractor (company directory level)
// ==========================================================================

// GET /api/subcontractors/:subcontractorId/people[?projectId=] — list people of a
// subcontractor firm; with projectId, each carries per-project portal status.
router.get("/subcontractors/:subcontractorId/people", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }
    const wantArchived = req.query.archived === "true";
    const people = await db.select().from(peopleTable)
      .where(and(
        eq(peopleTable.subcontractorId, sub.id),
        wantArchived ? isNotNull(peopleTable.archivedAt) : isNull(peopleTable.archivedAt),
      )).orderBy(desc(peopleTable.createdAt));
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const statusMap = projectId ? await portalStatusFor(people.map(p => p.id), projectId) : undefined;
    res.json(people.map(p => serializePerson(p, statusMap?.get(p.id))));
  } catch (err) {
    req.log.error({ err }, "List subcontractor people error");
    res.status(500).json({ error: "server_error", message: "Failed to load people" });
  }
});

// POST /api/subcontractors/:subcontractorId/people — add an individual person to a
// firm. Dedupes on (subcontractor, email) — a repeat add (e.g. the "add primary
// contact" one-click fired twice) returns the existing row instead of erroring.
router.post("/subcontractors/:subcontractorId/people", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }
    const parsed = CreateSubcontractorPersonBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "A first name, surname (2+ chars each) and valid email are required." }); return; }
    const input = parsed.data as CreatePersonInput;
    // The Zod minLength above checks the RAW value, so e.g. "  " (whitespace-only)
    // slips through — trim first, then re-check, so a name that's empty once
    // trimmed is caught with a clear message instead of silently stored blank.
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (firstName.length < 2 || lastName.length < 2) {
      res.status(400).json({ error: "validation_error", message: "First name and surname must be at least 2 real characters each (whitespace doesn't count)." });
      return;
    }
    const name = `${firstName} ${lastName}`.trim();
    const email = input.email.trim().toLowerCase();

    const existing = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.subcontractorId, sub.id), eq(peopleTable.email, email))).limit(1);
    if (existing[0]) { res.status(200).json(serializePerson(existing[0])); return; }

    const row = {
      id: generateId(), companyId: req.user!.companyId, subcontractorId: sub.id, userId: null,
      name, firstName, lastName, email, phone: input.phone?.trim() || null,
      roleTitle: input.roleTitle?.trim() || null,
    };
    await db.insert(peopleTable).values(row);
    res.status(201).json(serializePerson({ ...row, createdAt: new Date() } as typeof peopleTable.$inferSelect));
  } catch (err) {
    req.log.error({ err }, "Create subcontractor person error");
    res.status(500).json({ error: "server_error", message: "Failed to add person" });
  }
});

// DELETE /api/people/:personId — remove a person from the directory. Blocked
// if they're on an ACTIVE project; otherwise zero footprint anywhere → hard
// delete (cascades their invites/memberships); any footprint → archive
// instead, so past records (keyed off users.id) keep resolving their name.
router.delete("/people/:personId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const rows = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.id, req.params.personId), eq(peopleTable.companyId, req.user!.companyId))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }

    const activeProjects = await activeProjectsForPerson(req.params.personId);
    if (activeProjects.length > 0) {
      res.status(400).json({ error: "on_active_project", message: `Remove them from ${activeProjects.join(", ")} first.`, projects: activeProjects });
      return;
    }

    const footprint = await hasAnyHistoricalFootprint({
      personIds: [req.params.personId],
      userIds: rows[0].userId ? [rows[0].userId] : [],
    });

    if (footprint) {
      await db.update(peopleTable).set({ archivedAt: new Date() }).where(eq(peopleTable.id, req.params.personId));
      res.json({ success: true, archived: true });
      return;
    }

    await db.delete(peopleTable).where(eq(peopleTable.id, req.params.personId));
    res.json({ success: true, archived: false });
  } catch (err) {
    req.log.error({ err }, "Delete person error");
    res.status(500).json({ error: "server_error", message: "Failed to delete person" });
  }
});

// PATCH /api/people/:personId/restore — un-archive a previously archived person.
router.patch("/people/:personId/restore", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const rows = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.id, req.params.personId), eq(peopleTable.companyId, req.user!.companyId))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }
    await db.update(peopleTable).set({ archivedAt: null }).where(eq(peopleTable.id, req.params.personId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Restore person error");
    res.status(500).json({ error: "server_error", message: "Failed to restore person" });
  }
});

// PATCH /api/people/:personId — update a person's portal contact-visibility flag
// and/or job title (manager-gated, tenant-scoped). `showContactInPortal: null`
// resets to the role-based default.
router.patch("/people/:personId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const rows = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.id, req.params.personId), eq(peopleTable.companyId, req.user!.companyId))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }

    const parsed = UpdatePersonBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid update — a first name and surname must be at least 2 characters each." }); return; }
    const { showContactInPortal, roleTitle, firstName, lastName } = parsed.data;
    if ((firstName !== undefined) !== (lastName !== undefined)) {
      res.status(400).json({ error: "validation_error", message: "Provide both first name and surname together." });
      return;
    }
    // The Zod minLength above checks the RAW value, so e.g. "  " (whitespace-only)
    // slips through — trim first, then re-check, so a name that's empty once
    // trimmed is caught with a clear message instead of silently stored blank.
    if (firstName !== undefined && lastName !== undefined
      && (firstName.trim().length < 2 || lastName.trim().length < 2)) {
      res.status(400).json({ error: "validation_error", message: "First name and surname must be at least 2 real characters each (whitespace doesn't count)." });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (showContactInPortal !== undefined) patch.showContactInPortal = showContactInPortal === null ? null : !!showContactInPortal;
    if (roleTitle !== undefined) patch.roleTitle = (roleTitle ?? "").toString().trim() || null;
    if (firstName !== undefined && lastName !== undefined) {
      const fn = firstName.trim();
      const ln = lastName.trim();
      patch.firstName = fn;
      patch.lastName = ln;
      patch.name = `${fn} ${ln}`.trim();
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "validation_error", message: "Nothing to update." }); return; }
    await db.update(peopleTable).set(patch).where(eq(peopleTable.id, req.params.personId));
    // Mirror a name change back onto the parent subcontractor row when this is
    // its primary-contact person (Feature: person-first cards — keeps
    // subcontructors.contactName in sync for legacy readers).
    if (rows[0].isPrimaryContact && rows[0].subcontractorId && patch.firstName !== undefined) {
      await db.update(subcontractorsTable).set({
        contactFirstName: patch.firstName as string,
        contactLastName: patch.lastName as string,
        contactName: patch.name as string,
      }).where(eq(subcontractorsTable.id, rows[0].subcontractorId));
    }
    const updated = (await db.select().from(peopleTable).where(eq(peopleTable.id, req.params.personId)).limit(1))[0];
    res.json(serializePerson(updated));
  } catch (err) {
    req.log.error({ err }, "Update person error");
    res.status(500).json({ error: "server_error", message: "Failed to update person" });
  }
});

// ==========================================================================
// IN-HOUSE people (company team members) — per project
// ==========================================================================

// GET /api/projects/:projectId/in-house-people — the company's in-house people
// (portal-only individuals not tied to a subcontractor firm) with their portal
// status for this project. In-house people are just `people` rows with
// subcontractorId NULL; they are portal-only exactly like subcontractor people.
router.get("/projects/:projectId/in-house-people", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const wantArchived = req.query.archived === "true";
    const people = await db.select().from(peopleTable)
      .where(and(
        eq(peopleTable.companyId, req.user!.companyId),
        isNull(peopleTable.subcontractorId),
        wantArchived ? isNotNull(peopleTable.archivedAt) : isNull(peopleTable.archivedAt),
      ))
      .orderBy(desc(peopleTable.createdAt));
    const statusMap = await portalStatusFor(people.map(p => p.id), req.params.projectId);
    res.json(people.map(p => serializePerson(p, statusMap.get(p.id))));
  } catch (err) {
    req.log.error({ err }, "List in-house people error");
    res.status(500).json({ error: "server_error", message: "Failed to load in-house team" });
  }
});

// POST /api/projects/:projectId/in-house-people — add an in-house person (portal
// participant with no subcontractor firm). Dedupes on (company, email).
router.post("/projects/:projectId/in-house-people", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const parsed = CreateSubcontractorPersonBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "A first name, surname (2+ chars each) and valid email are required." }); return; }
    const input = parsed.data as CreatePersonInput;
    // The Zod minLength above checks the RAW value, so e.g. "  " (whitespace-only)
    // slips through — trim first, then re-check, so a name that's empty once
    // trimmed is caught with a clear message instead of silently stored blank.
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (firstName.length < 2 || lastName.length < 2) {
      res.status(400).json({ error: "validation_error", message: "First name and surname must be at least 2 real characters each (whitespace doesn't count)." });
      return;
    }
    const name = `${firstName} ${lastName}`.trim();
    const email = input.email.trim().toLowerCase();
    const companyId = req.user!.companyId;

    const existing = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.companyId, companyId), isNull(peopleTable.subcontractorId), eq(peopleTable.email, email))).limit(1);
    if (existing[0]) { res.status(200).json(serializePerson(existing[0])); return; }

    const row = {
      id: generateId(), companyId, subcontractorId: null, userId: null,
      name, firstName, lastName, email, phone: input.phone?.trim() || null, roleTitle: input.roleTitle?.trim() || null,
    };
    await db.insert(peopleTable).values(row);
    res.status(201).json(serializePerson({ ...row, createdAt: new Date() } as typeof peopleTable.$inferSelect));
  } catch (err) {
    req.log.error({ err }, "Create in-house person error");
    res.status(500).json({ error: "server_error", message: "Failed to add person" });
  }
});

// ==========================================================================
// Per-person portal invite — ONE path for everyone (subcontractor or in-house).
// Always portal-only: creates/rotates a pending invite + copyable link; the
// person becomes a portalOnly account when they accept it (see portal.ts).
// ==========================================================================

router.post("/projects/:projectId/portal-invites", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const parsed = CreatePortalInviteBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid invite." }); return; }
    const input = parsed.data as PortalInviteInput;
    if (!input.personId) { res.status(400).json({ error: "validation_error", message: "A personId is required." }); return; }

    const personRows = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.id, input.personId), eq(peopleTable.companyId, req.user!.companyId))).limit(1);
    const person = personRows[0];
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }
    if (!person.lastName?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Add a surname for this person before sending a portal invite." });
      return;
    }
    const role = input.role ?? "worker";
    const pid = req.params.projectId;

    // If a DASHBOARD (non-portalOnly) account IN THIS COMPANY already owns this
    // email, grant portal access via their EXISTING login — no signup/link. Link
    // the person to that account and set person_id on their project membership (the
    // portal grant), preserving any existing team role. They enter the portal with
    // their normal SiteSort credentials. The company check is essential: without it
    // an email that matches a user in ANOTHER tenant would grant that outside user
    // access to this project.
    const dashUser = (await db.select().from(usersTable)
      .where(and(eq(usersTable.email, person.email), eq(usersTable.portalOnly, false))).limit(1))[0];
    let dashInCompany = false;
    if (dashUser) {
      if (dashUser.companyId === req.user!.companyId) dashInCompany = true;
      else {
        const cm = await db.select({ id: companyMembersTable.id }).from(companyMembersTable)
          .where(and(eq(companyMembersTable.userId, dashUser.id), eq(companyMembersTable.companyId, req.user!.companyId))).limit(1);
        dashInCompany = cm.length > 0;
      }
    }
    if (dashUser && dashInCompany) {
      if (person.userId !== dashUser.id) {
        await db.update(peopleTable).set({ userId: dashUser.id }).where(eq(peopleTable.id, person.id));
      }
      const existingMember = await db.select().from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, pid), eq(projectMembersTable.userId, dashUser.id))).limit(1);
      if (existingMember[0]) {
        await db.update(projectMembersTable).set({ personId: person.id }).where(eq(projectMembersTable.id, existingMember[0].id));
      } else {
        await db.insert(projectMembersTable).values({ id: generateId(), projectId: pid, userId: dashUser.id, personId: person.id, role });
      }
      // Record an accepted invite row (once) so the Team Portal list/revoke/audit is
      // uniform. Dedup: don't stack duplicate accepted rows on repeat grants.
      const alreadyAccepted = await db.select({ id: projectInvitesTable.id }).from(projectInvitesTable)
        .where(and(eq(projectInvitesTable.projectId, pid), eq(projectInvitesTable.personId, person.id), eq(projectInvitesTable.status, "accepted"))).limit(1);
      if (!alreadyAccepted[0]) {
        await db.insert(projectInvitesTable).values({
          id: generateId(), projectId: pid, companyId: req.user!.companyId, personId: person.id,
          email: person.email, name: person.name, tokenHash: hashToken(randomBytes(16).toString("hex")),
          role, status: "accepted", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedByUserId: req.user!.id, acceptedUserId: dashUser.id, acceptedAt: new Date(),
        });
      }
      res.status(201).json({ status: "member", person: serializePerson({ ...person, userId: dashUser.id }), inviteUrl: null });
      return;
    }

    // Otherwise (external person, no dashboard account): create or ROTATE a pending
    // invite + link; they set a password on accept → a portalOnly account.
    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pending = await db.select().from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.projectId, pid), eq(projectInvitesTable.personId, person.id), eq(projectInvitesTable.status, "pending"))).limit(1);
    let inviteId: string;
    if (pending[0]) {
      inviteId = pending[0].id;
      await db.update(projectInvitesTable)
        .set({ tokenHash: hashToken(rawToken), role, expiresAt, email: person.email, name: person.name })
        .where(eq(projectInvitesTable.id, inviteId));
    } else {
      inviteId = generateId();
      await db.insert(projectInvitesTable).values({
        id: inviteId, projectId: pid, companyId: req.user!.companyId, personId: person.id,
        email: person.email, name: person.name, tokenHash: hashToken(rawToken), role,
        status: "pending", expiresAt, invitedByUserId: req.user!.id,
      });
    }
    const inviteUrl = `${inviteBaseUrl()}/portal/accept/${rawToken}`;
    // Send the invite email now and record delivery state. Never blocks success:
    // even a failed send leaves the invite + copyable link intact.
    const { inviterName, companyName } = await inviteContext(req.user!.id, req.user!.companyId);
    const emailStatus = await deliverInvite({
      inviteId, email: person.email, name: person.name, role,
      inviterName, companyName, projectName: project.name, inviteUrl,
    });
    res.status(201).json({ status: "invited", person: serializePerson(person), inviteUrl, emailStatus });
  } catch (err) {
    req.log.error({ err }, "Create portal invite error");
    res.status(500).json({ error: "server_error", message: "Failed to create invite" });
  }
});

const RESEND_COOLDOWN_MS = 5 * 60 * 1000; // max 1 resend / 5 min per invite

// POST /api/projects/:projectId/portal-invites/:inviteId/resend — re-send a
// pending invite's email (manager-gated, rate-limited). Rotates the token (the
// raw token is never stored) and refreshes the 7-day expiry.
router.post("/projects/:projectId/portal-invites/:inviteId/resend", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const rows = await db.select().from(projectInvitesTable).where(and(
      eq(projectInvitesTable.id, req.params.inviteId),
      eq(projectInvitesTable.projectId, req.params.projectId),
      eq(projectInvitesTable.companyId, req.user!.companyId),
    )).limit(1);
    const inv = rows[0];
    if (!inv) { res.status(404).json({ error: "not_found", message: "Invite not found" }); return; }
    if (inv.status !== "pending") { res.status(409).json({ error: "not_pending", message: "This invite is no longer pending." }); return; }
    if (inv.emailLastSentAt && Date.now() - inv.emailLastSentAt.getTime() < RESEND_COOLDOWN_MS) {
      const waitS = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - inv.emailLastSentAt.getTime())) / 1000);
      res.status(429).json({ error: "rate_limited", message: `Please wait before resending — try again in about ${Math.max(1, Math.ceil(waitS / 60))} min.`, retryAfterSeconds: waitS });
      return;
    }
    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.update(projectInvitesTable).set({ tokenHash: hashToken(rawToken), expiresAt }).where(eq(projectInvitesTable.id, inv.id));
    const inviteUrl = `${inviteBaseUrl()}/portal/accept/${rawToken}`;
    const { inviterName, companyName } = await inviteContext(req.user!.id, req.user!.companyId);
    const emailStatus = await deliverInvite({
      inviteId: inv.id, email: inv.email, name: inv.name, role: inv.role,
      inviterName, companyName, projectName: project.name, inviteUrl,
    });
    res.json({ success: true, emailStatus, inviteUrl });
  } catch (err) {
    req.log.error({ err }, "Resend portal invite error");
    res.status(500).json({ error: "server_error", message: "Failed to resend invite" });
  }
});

// Orphaned portal-only accounts: portalOnly users in this company with NO
// project_members row (revoked or leftover) — they can't log into anything.
async function orphanPortalUsers(companyId: string) {
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(and(eq(usersTable.companyId, companyId), eq(usersTable.portalOnly, true)));
  if (users.length === 0) return [];
  const ids = users.map(u => u.id);
  const members = await db.select({ userId: projectMembersTable.userId }).from(projectMembersTable)
    .where(and(inArray(projectMembersTable.userId, ids), isNotNull(projectMembersTable.userId)));
  const active = new Set(members.map(m => m.userId));
  return users.filter(u => !active.has(u.id));
}

// GET /api/portal-users/orphaned — list them (manager-gated).
router.get("/portal-users/orphaned", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    res.json(await orphanPortalUsers(req.user!.companyId));
  } catch (err) {
    req.log.error({ err }, "List orphan portal users error");
    res.status(500).json({ error: "server_error", message: "Failed to list orphaned portal users" });
  }
});

// DELETE /api/portal-users/:userId — purge ONE orphaned portal-only account +
// its non-cascade dependents (distributions, notifications). Refuses to touch a
// user that isn't portalOnly, isn't in this company, or still has a membership.
router.delete("/portal-users/:userId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const orphans = await orphanPortalUsers(req.user!.companyId);
    if (!orphans.some(u => u.id === req.params.userId)) {
      res.status(404).json({ error: "not_found", message: "No orphaned portal-only account with that id in this company." });
      return;
    }
    await db.delete(documentDistributionsTable).where(eq(documentDistributionsTable.userId, req.params.userId));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, req.params.userId));
    await db.delete(usersTable).where(eq(usersTable.id, req.params.userId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete orphan portal user error");
    res.status(500).json({ error: "server_error", message: "Failed to delete portal user" });
  }
});

export default router;
