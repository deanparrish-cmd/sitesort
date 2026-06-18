import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { companiesTable, usersTable, userNotesTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { sendInvitationEmail } from "../lib/email";

const router: IRouter = Router();

router.get("/users", authenticate, async (req, res) => {
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.companyId, req.user!.companyId));
    res.json(users.map(u => ({
      id: u.id,
      companyId: u.companyId,
      email: u.email,
      name: u.name,
      role: u.role,
      phone: u.phone ?? null,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ error: "server_error", message: "Failed to list users" });
  }
});

router.post("/users", authenticate, async (req, res) => {
  try {
    const { email, name, role, phone } = req.body;
    if (!email || !name || !role) {
      res.status(400).json({ error: "validation_error", message: "email, name, role required" });
      return;
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "validation_error", message: "Email already registered" });
      return;
    }

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
    });

    // Look up inviter name and company name for the invitation email
    const [inviterRow, companyRow] = await Promise.all([
      db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1),
      db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, req.user!.companyId)).limit(1),
    ]);

    const inviterName = inviterRow[0]?.name ?? "Your administrator";
    const companyName = companyRow[0]?.name ?? "your company";

    sendInvitationEmail(email, name, companyName, defaultPassword, inviterName).catch(err =>
      req.log.error({ err }, "Failed to send invitation email"),
    );

    res.status(201).json({ id, companyId: req.user!.companyId, email, name, role, phone: phone ?? null, createdAt: new Date().toISOString(), lastActiveAt: null });
  } catch (err) {
    req.log.error({ err }, "Invite user error");
    res.status(500).json({ error: "server_error", message: "Failed to invite user" });
  }
});

router.patch("/users/:userId", authenticate, async (req, res) => {
  try {
    const { name, role, phone } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (phone !== undefined) updates.phone = phone;

    await db.update(usersTable).set(updates).where(and(eq(usersTable.id, req.params.userId), eq(usersTable.companyId, req.user!.companyId)));

    const users = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, req.params.userId), eq(usersTable.companyId, req.user!.companyId)))
      .limit(1);
    if (users.length === 0) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const u = users[0];
    res.json({ id: u.id, companyId: u.companyId, email: u.email, name: u.name, role: u.role, phone: u.phone ?? null, createdAt: u.createdAt.toISOString(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Update user error");
    res.status(500).json({ error: "server_error", message: "Failed to update user" });
  }
});

// List notes for a team member (most recent first)
router.get("/users/:userId/notes", authenticate, async (req, res) => {
  try {
    const target = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, req.params.userId), eq(usersTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!target[0]) { res.status(404).json({ error: "not_found", message: "User not found" }); return; }

    const notes = await db
      .select({
        id: userNotesTable.id,
        body: userNotesTable.body,
        createdAt: userNotesTable.createdAt,
        authorName: usersTable.name,
      })
      .from(userNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, userNotesTable.authorId))
      .where(eq(userNotesTable.userId, req.params.userId))
      .orderBy(desc(userNotesTable.createdAt));

    res.json(notes.map(n => ({ id: n.id, body: n.body, authorName: n.authorName ?? "Unknown", createdAt: n.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "List user notes error");
    res.status(500).json({ error: "server_error", message: "Failed to list notes" });
  }
});

// Add a note to a team member
router.post("/users/:userId/notes", authenticate, async (req, res) => {
  try {
    const target = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, req.params.userId), eq(usersTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!target[0]) { res.status(404).json({ error: "not_found", message: "User not found" }); return; }

    const { body } = req.body;
    if (!body?.trim()) { res.status(400).json({ error: "validation_error", message: "body required" }); return; }

    const id = generateId();
    const [inserted] = await db.insert(userNotesTable).values({
      id, userId: req.params.userId, authorId: req.user!.id, body: body.trim(),
    }).returning({ createdAt: userNotesTable.createdAt });

    const author = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);

    res.status(201).json({ id, body: body.trim(), authorName: author[0]?.name ?? "Unknown", createdAt: inserted.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Add user note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

export default router;
