import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { companiesTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";
import { generateToken, authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  try {
    const { companyName, adminName, email, password, companySize } = req.body;
    if (!companyName || !adminName || !email || !password) {
      res.status(400).json({ error: "validation_error", message: "All fields are required" });
      return;
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "validation_error", message: "Email already registered" });
      return;
    }

    const companyId = generateId();
    const userId = generateId();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.insert(companiesTable).values({
      id: companyId,
      name: companyName,
      size: companySize || "1-10",
    });

    await db.insert(usersTable).values({
      id: userId,
      companyId,
      email,
      passwordHash,
      name: adminName,
      role: "admin",
    });

    const token = generateToken({ id: userId, companyId, role: "admin", email });
    res.status(201).json({
      user: { id: userId, companyId, email, name: adminName, role: "admin", phone: null, createdAt: new Date().toISOString(), lastActiveAt: null },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Register error");
    res.status(500).json({ error: "server_error", message: "Registration failed" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "validation_error", message: "Email and password required" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (users.length === 0) {
      res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
      return;
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
      return;
    }

    await db.update(usersTable).set({ lastActiveAt: new Date() }).where(eq(usersTable.id, user.id));

    const token = generateToken({ id: user.id, companyId: user.companyId, role: user.role, email: user.email });
    res.json({
      user: { id: user.id, companyId: user.companyId, email: user.email, name: user.name, role: user.role, phone: user.phone ?? null, createdAt: user.createdAt.toISOString(), lastActiveAt: user.lastActiveAt?.toISOString() ?? null },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "server_error", message: "Login failed" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

router.get("/auth/me", authenticate, async (req, res) => {
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (users.length === 0) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const user = users[0];
    res.json({ id: user.id, companyId: user.companyId, email: user.email, name: user.name, role: user.role, phone: user.phone ?? null, createdAt: user.createdAt.toISOString(), lastActiveAt: user.lastActiveAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Get me error");
    res.status(500).json({ error: "server_error", message: "Failed to get user" });
  }
});

export default router;
