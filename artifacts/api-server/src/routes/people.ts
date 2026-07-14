import { Router, type IRouter } from "express";
import { randomBytes, createHash } from "crypto";
import { db } from "@workspace/db";
import {
  peopleTable, subcontractorsTable, projectsTable, projectMembersTable,
  projectInvitesTable, usersTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendProjectInviteEmail } from "../lib/invite-email";
import { CreateSubcontractorPersonBody, CreatePortalInviteBody } from "@workspace/api-zod";

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
type CreatePersonInput = { name: string; email: string; phone?: string; roleTitle?: string };
type PortalInviteInput = { personId?: string; role?: "worker" | "manager" | "subcontractor" };

// ---- shared: portal status for a person on a project ----
// One definition of a person's per-project portal state, so every list agrees.
// member (accepted, has a membership row) > invited (pending, unexpired) > not_invited.
type PortalStatus = {
  status: "not_invited" | "invited" | "member";
  role?: string;
  inviteId?: string;
  lastActiveAt?: string;
};
async function portalStatusFor(personIds: string[], projectId: string): Promise<Map<string, PortalStatus>> {
  const out = new Map<string, PortalStatus>();
  if (personIds.length === 0) return out;
  const [members, invites] = await Promise.all([
    db.select({ personId: projectMembersTable.personId, role: projectMembersTable.role, lastActiveAt: usersTable.lastActiveAt })
      .from(projectMembersTable)
      .leftJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
      .where(and(eq(projectMembersTable.projectId, projectId), inArray(projectMembersTable.personId, personIds))),
    db.select({ id: projectInvitesTable.id, personId: projectInvitesTable.personId, role: projectInvitesTable.role, status: projectInvitesTable.status, expiresAt: projectInvitesTable.expiresAt })
      .from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.projectId, projectId), inArray(projectInvitesTable.personId, personIds)))
      .orderBy(desc(projectInvitesTable.createdAt)),
  ]);
  // Latest invite per person (invites already ordered newest-first) — used to give
  // the UI an inviteId to revoke against, for members AND pending invites alike.
  const latestInvite = new Map<string, { id: string; status: string; expiresAt: Date; role: string }>();
  for (const inv of invites) if (inv.personId && !latestInvite.has(inv.personId)) latestInvite.set(inv.personId, { id: inv.id, status: inv.status, expiresAt: inv.expiresAt, role: inv.role });

  for (const m of members) {
    if (m.personId) out.set(m.personId, {
      status: "member", role: m.role,
      lastActiveAt: m.lastActiveAt ? m.lastActiveAt.toISOString() : undefined,
      inviteId: latestInvite.get(m.personId)?.id,
    });
  }
  for (const [personId, inv] of latestInvite) {
    if (out.has(personId)) continue; // member wins
    if (inv.status === "pending" && inv.expiresAt.getTime() > Date.now()) {
      out.set(personId, { status: "invited", role: inv.role, inviteId: inv.id });
    }
  }
  for (const id of personIds) if (!out.has(id)) out.set(id, { status: "not_invited" });
  return out;
}

function serializePerson(p: typeof peopleTable.$inferSelect, portal?: PortalStatus) {
  return {
    id: p.id, subcontractorId: p.subcontractorId ?? undefined, userId: p.userId ?? undefined,
    name: p.name, email: p.email, phone: p.phone ?? undefined, roleTitle: p.roleTitle ?? undefined,
    kind: p.subcontractorId ? "subcontractor" : "in_house",
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
// PEOPLE under a subcontractor (company directory level)
// ==========================================================================

// GET /api/subcontractors/:subcontractorId/people[?projectId=] — list people of a
// subcontractor firm; with projectId, each carries per-project portal status.
router.get("/subcontractors/:subcontractorId/people", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }
    const people = await db.select().from(peopleTable)
      .where(eq(peopleTable.subcontractorId, sub.id)).orderBy(desc(peopleTable.createdAt));
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
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "A name and valid email are required." }); return; }
    const input = parsed.data as CreatePersonInput;
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name) { res.status(400).json({ error: "validation_error", message: "A name is required." }); return; }

    const existing = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.subcontractorId, sub.id), eq(peopleTable.email, email))).limit(1);
    if (existing[0]) { res.status(200).json(serializePerson(existing[0])); return; }

    const row = {
      id: generateId(), companyId: req.user!.companyId, subcontractorId: sub.id, userId: null,
      name, email, phone: input.phone?.trim() || null,
      roleTitle: input.roleTitle?.trim() || null,
    };
    await db.insert(peopleTable).values(row);
    res.status(201).json(serializePerson({ ...row, createdAt: new Date() } as typeof peopleTable.$inferSelect));
  } catch (err) {
    req.log.error({ err }, "Create subcontractor person error");
    res.status(500).json({ error: "server_error", message: "Failed to add person" });
  }
});

// DELETE /api/people/:personId — remove a person (cascades their invites/members).
router.delete("/people/:personId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const rows = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.id, req.params.personId), eq(peopleTable.companyId, req.user!.companyId))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }
    await db.delete(peopleTable).where(eq(peopleTable.id, req.params.personId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete person error");
    res.status(500).json({ error: "server_error", message: "Failed to delete person" });
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
    const people = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.companyId, req.user!.companyId), isNull(peopleTable.subcontractorId)))
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
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "A name and valid email are required." }); return; }
    const input = parsed.data as CreatePersonInput;
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name) { res.status(400).json({ error: "validation_error", message: "A name is required." }); return; }
    const companyId = req.user!.companyId;

    const existing = await db.select().from(peopleTable)
      .where(and(eq(peopleTable.companyId, companyId), isNull(peopleTable.subcontractorId), eq(peopleTable.email, email))).limit(1);
    if (existing[0]) { res.status(200).json(serializePerson(existing[0])); return; }

    const row = {
      id: generateId(), companyId, subcontractorId: null, userId: null,
      name, email, phone: input.phone?.trim() || null, roleTitle: input.roleTitle?.trim() || null,
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
    const role = input.role ?? "worker";
    const pid = req.params.projectId;

    // Create or ROTATE a pending invite, return a fresh copyable link.
    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pending = await db.select().from(projectInvitesTable)
      .where(and(eq(projectInvitesTable.projectId, pid), eq(projectInvitesTable.personId, person.id), eq(projectInvitesTable.status, "pending"))).limit(1);
    if (pending[0]) {
      await db.update(projectInvitesTable)
        .set({ tokenHash: hashToken(rawToken), role, expiresAt, email: person.email, name: person.name })
        .where(eq(projectInvitesTable.id, pending[0].id));
    } else {
      await db.insert(projectInvitesTable).values({
        id: generateId(), projectId: pid, companyId: req.user!.companyId, personId: person.id,
        email: person.email, name: person.name, tokenHash: hashToken(rawToken), role,
        status: "pending", expiresAt, invitedByUserId: req.user!.id,
      });
    }
    const inviteUrl = `${inviteBaseUrl()}/portal/accept/${rawToken}`;
    void sendProjectInviteEmail({ email: person.email, name: person.name, projectName: project.name, inviteUrl });
    res.status(201).json({ status: "invited", person: serializePerson(person), inviteUrl });
  } catch (err) {
    req.log.error({ err }, "Create portal invite error");
    res.status(500).json({ error: "server_error", message: "Failed to create invite" });
  }
});

export default router;
