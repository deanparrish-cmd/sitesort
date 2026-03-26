import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

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

    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.params.userId)).limit(1);
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

export default router;
