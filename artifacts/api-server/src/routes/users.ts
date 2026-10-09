import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { companiesTable, usersTable, userNotesTable, companyMembersTable, notificationsTable, projectMembersTable, projectsTable } from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { generateId } from "../lib/id";
import { authenticate, bustMembershipCache } from "../middlewares/auth";
import { sendInvitationEmail } from "../lib/email";
import { addMembership, membershipRole } from "../lib/memberships";
import { parseFullPersonName } from "../lib/name-validation";
import { allow, COMPANY_MANAGER, DASHBOARD_ROLES, INTERNAL_STAFF, bustRoleCache, self } from "../lib/authz";

const router: IRouter = Router();

router.get("/users", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    // Team = everyone with a membership in the active company (their role is the
    // membership role in THIS company, which can differ from their home role).
    const rows = await db
      .select({ u: usersTable, role: companyMembersTable.role })
      .from(companyMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
      .where(eq(companyMembersTable.companyId, req.user!.companyId));
    res.json(rows.map(({ u, role }) => ({
      id: u.id,
      companyId: req.user!.companyId,
      email: u.email,
      name: u.name,
      role,
      phone: u.phone ?? null,
      roleTitle: u.roleTitle ?? null,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ error: "server_error", message: "Failed to list users" });
  }
});

// Adding someone to the company: admin / PM only, and only an ADMIN can make
// someone an admin (before #116 any logged-in user, even a site worker, could
// create an admin account by calling this directly).
// Admins of a company who can actually log in: a portal-only or deleted
// (scrubbed) account still holding an admin row doesn't count, so it can't
// stand in for "another admin" when the last real one is removed (#123).
async function liveAdmins(companyId: string) {
  return db.select({ id: companyMembersTable.userId }).from(companyMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
    .where(and(eq(companyMembersTable.companyId, companyId), eq(companyMembersTable.role, "admin"), eq(usersTable.portalOnly, false)));
}

router.post("/users", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    const { email, role, phone, roleTitle } = req.body;
    if (!email || !role) {
      res.status(400).json({ error: "validation_error", message: "email, name, role required" });
      return;
    }
    if (!(DASHBOARD_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "validation_error", message: role === "subcontractor" || role === "site_worker" ? "Site workers and subcontractors join through the Team Portal, not the dashboard. Invite them to the project's Team Portal instead." : "role must be admin or project_manager" });
      return;
    }
    if (role === "admin" && res.locals.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Only an admin can add another admin." });
      return;
    }
    const nameParsed = parseFullPersonName(req.body.name);
    if (!nameParsed.success) {
      res.status(400).json({ error: "validation_error", message: nameParsed.message });
      return;
    }
    const name = nameParsed.data;

    const companyRow = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, req.user!.companyId)).limit(1);
    const companyName = companyRow[0]?.name ?? "your company";

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

    // Existing SiteSort user → LINK them into this company via a membership
    // (they keep their own login) instead of rejecting the email.
    if (existing.length > 0) {
      const linkedUser = existing[0];
      // A Team Portal account can't open the dashboard, so linking it as a
      // PM/admin would add a team member who can never log in (#123).
      if (linkedUser.portalOnly) {
        res.status(400).json({ error: "portal_account", message: `${email} is a Team Portal account, so it can't be added to the dashboard team. Use a different email address for their dashboard login.` });
        return;
      }
      const added = await addMembership(linkedUser.id, req.user!.companyId, role);
      if (!added) {
        res.status(400).json({ error: "already_member", message: `${linkedUser.name} is already on your team.` });
        return;
      }
      // Let them know in-app that they've been added to a new company.
      await db.insert(notificationsTable).values({
        id: generateId(),
        userId: linkedUser.id,
        type: "team",
        title: `Added to ${companyName}`,
        message: `You've been added to ${companyName} as ${role.replace("_", " ")}. Switch companies from the menu to view it.`,
        relatedEntityType: "company",
      });
      res.status(201).json({ id: linkedUser.id, companyId: req.user!.companyId, email: linkedUser.email, name: linkedUser.name, role, phone: linkedUser.phone ?? null, roleTitle: linkedUser.roleTitle ?? null, linked: true, createdAt: linkedUser.createdAt.toISOString(), lastActiveAt: linkedUser.lastActiveAt?.toISOString() ?? null });
      return;
    }

    // New person → create their account (home company = this company) + membership + invite email with credentials.
    const id = generateId();
    const defaultPassword = Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    await db.insert(usersTable).values({
      id,
      companyId: req.user!.companyId,
      email,
      passwordHash,
      name,
      role,
      phone: phone ?? null,
      roleTitle: roleTitle?.trim() || null,
    });
    await addMembership(id, req.user!.companyId, role);

    const inviterRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const inviterName = inviterRow[0]?.name ?? "Your administrator";

    sendInvitationEmail(email, name, companyName, defaultPassword, inviterName).catch(err =>
      req.log.error({ err }, "Failed to send invitation email"),
    );

    res.status(201).json({ id, companyId: req.user!.companyId, email, name, role, phone: phone ?? null, roleTitle: roleTitle?.trim() || null, linked: false, createdAt: new Date().toISOString(), lastActiveAt: null });
  } catch (err) {
    req.log.error({ err }, "Invite user error");
    res.status(500).json({ error: "server_error", message: "Failed to invite user" });
  }
});

router.patch("/users/:userId", authenticate, allow(COMPANY_MANAGER, self()), async (req, res) => {
  try {
    // Manager-gated (self-edits of name/phone allowed): editing another member's
    // details — and role changes in particular — is an admin/PM action. The UI
    // only shows the controls to managers, but the API must enforce it too.
    // The caller's role comes from the DB (allow() puts it in res.locals.role).
    const actorRole = res.locals.role as string;
    const isManager = ["admin", "project_manager"].includes(actorRole);
    const isSelf = req.user!.id === req.params.userId;
    if (!isManager && !isSelf) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can edit other members." });
      return;
    }
    const { name, role, phone, roleTitle } = req.body;
    if (role !== undefined && !isManager) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can change roles." });
      return;
    }
    if (name !== undefined) {
      const nameParsed = parseFullPersonName(name);
      if (!nameParsed.success) {
        res.status(400).json({ error: "validation_error", message: nameParsed.message });
        return;
      }
    }

    // Target must be a member of the active company.
    const currentRole = await membershipRole(req.params.userId, req.user!.companyId);
    if (currentRole === null) { res.status(404).json({ error: "not_found", message: "User not found" }); return; }

    // Role is per-company → update the membership for THIS company.
    if (role !== undefined && role !== currentRole) {
      if (!(DASHBOARD_ROLES as readonly string[]).includes(role)) {
        res.status(400).json({ error: "validation_error", message: role === "subcontractor" || role === "site_worker" ? "Site workers and subcontractors join through the Team Portal, not the dashboard." : "role must be admin or project_manager" });
        return;
      }
      // Granting admin, or changing an admin's role, is admin-only: a PM can't
      // promote anyone (themselves included) to admin, or demote an admin.
      if ((role === "admin" || currentRole === "admin") && actorRole !== "admin") {
        res.status(403).json({ error: "forbidden", message: "Only an admin can grant or change the admin role." });
        return;
      }
      if (currentRole === "admin") {
        const admins = await liveAdmins(req.user!.companyId);
        if (admins.length <= 1) { res.status(400).json({ error: "validation_error", message: "You can't remove the only admin." }); return; }
      }
      await db.update(companyMembersTable).set({ role })
        .where(and(eq(companyMembersTable.userId, req.params.userId), eq(companyMembersTable.companyId, req.user!.companyId)));
      bustRoleCache(req.params.userId, req.user!.companyId);
    }
    // Name/phone are identity (global) → only editable from the user's HOME company,
    // so company B can't rename a member whose home is company A.
    const idUpdates: Record<string, unknown> = {};
    if (name !== undefined) idUpdates.name = name.trim();
    if (phone !== undefined) idUpdates.phone = phone;
    if (roleTitle !== undefined) idUpdates.roleTitle = roleTitle?.trim() || null;
    if (Object.keys(idUpdates).length > 0) {
      await db.update(usersTable).set(idUpdates).where(and(eq(usersTable.id, req.params.userId), eq(usersTable.companyId, req.user!.companyId)));
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.params.userId)).limit(1);
    const u = users[0];
    res.json({ id: u.id, companyId: req.user!.companyId, email: u.email, name: u.name, role: role !== undefined ? role : currentRole, phone: u.phone ?? null, roleTitle: u.roleTitle ?? null, createdAt: u.createdAt.toISOString(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Update user error");
    res.status(500).json({ error: "server_error", message: "Failed to update user" });
  }
});

// Remove a team member from THIS company (deletes their membership + project
// memberships here — their login/account survives, and other companies are
// untouched). Manager-only; you can't remove yourself or the last admin.
router.delete("/users/:userId", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (req.params.userId === req.user!.id) {
      res.status(400).json({ error: "validation_error", message: "You can't remove yourself from the team." });
      return;
    }
    const targetRole = await membershipRole(req.params.userId, req.user!.companyId);
    if (targetRole === null) { res.status(404).json({ error: "not_found", message: "User not found" }); return; }
    if (targetRole === "admin" && res.locals.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Only an admin can remove an admin." });
      return;
    }
    if (targetRole === "admin") {
      const admins = await liveAdmins(req.user!.companyId);
      if (admins.length <= 1) {
        res.status(400).json({ error: "validation_error", message: "You can't remove the only admin." });
        return;
      }
    }

    // Drop them from this company's projects too (their user-linked rows only).
    const companyProjects = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.companyId, req.user!.companyId));
    if (companyProjects.length > 0) {
      await db.delete(projectMembersTable).where(and(
        eq(projectMembersTable.userId, req.params.userId),
        inArray(projectMembersTable.projectId, companyProjects.map(p => p.id)),
      ));
    }
    await db.delete(companyMembersTable).where(and(
      eq(companyMembersTable.userId, req.params.userId),
      eq(companyMembersTable.companyId, req.user!.companyId),
    ));
    // Their existing dashboard tokens for THIS company die on the next request
    // (authenticate re-checks the membership; bust the cache so it's instant).
    bustMembershipCache(req.params.userId, req.user!.companyId);
    bustRoleCache(req.params.userId, req.user!.companyId);

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Remove team member error");
    res.status(500).json({ error: "server_error", message: "Failed to remove team member" });
  }
});

// Notes & reminders about a member of staff are a manager's private record
// (#121): company admin / PM only, never the person they're about, and only
// notes written in the active company. Before #121 every member of staff,
// including the subject, could read them.
const notSubject = (req: import("express").Request, res: import("express").Response): boolean => {
  if (req.params.userId !== req.user!.id) return true;
  res.status(403).json({ error: "forbidden", message: "Notes about you are private to your managers." });
  return false;
};

// List notes for a team member (most recent first)
router.get("/users/:userId/notes", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!notSubject(req, res)) return;
    // Target must be a member of the active company.
    if (await membershipRole(req.params.userId, req.user!.companyId) === null) { res.status(404).json({ error: "not_found", message: "User not found" }); return; }

    const notes = await db
      .select({
        id: userNotesTable.id,
        body: userNotesTable.body,
        createdAt: userNotesTable.createdAt,
        authorName: usersTable.name,
      })
      .from(userNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, userNotesTable.authorId))
      .where(and(eq(userNotesTable.userId, req.params.userId), eq(userNotesTable.companyId, req.user!.companyId)))
      .orderBy(desc(userNotesTable.createdAt));

    res.json(notes.map(n => ({ id: n.id, body: n.body, authorName: n.authorName ?? "Unknown", createdAt: n.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "List user notes error");
    res.status(500).json({ error: "server_error", message: "Failed to list notes" });
  }
});

// Add a note to a team member
router.post("/users/:userId/notes", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!notSubject(req, res)) return;
    // Target must be a member of the active company.
    if (await membershipRole(req.params.userId, req.user!.companyId) === null) { res.status(404).json({ error: "not_found", message: "User not found" }); return; }

    const { body } = req.body;
    if (!body?.trim()) { res.status(400).json({ error: "validation_error", message: "body required" }); return; }

    const id = generateId();
    const [inserted] = await db.insert(userNotesTable).values({
      id, userId: req.params.userId, authorId: req.user!.id, companyId: req.user!.companyId, body: body.trim(),
    }).returning({ createdAt: userNotesTable.createdAt });

    const author = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);

    res.status(201).json({ id, body: body.trim(), authorName: author[0]?.name ?? "Unknown", createdAt: inserted.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Add user note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

export default router;
