import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { companiesTable, usersTable, subcontractorsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { generateToken, authenticate } from "../middlewares/auth";
import { blockToken } from "../lib/token-blocklist";
import { isLockedOut, recordFailedAttempt, clearAttempts } from "../lib/login-attempts";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../lib/email";

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
    const verificationToken = randomBytes(32).toString("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
    });

    sendVerificationEmail(email, adminName, verificationToken).catch(err =>
      req.log.error({ err }, "Failed to send verification email"),
    );

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

    if (await isLockedOut(email)) {
      res.status(429).json({ error: "too_many_attempts", message: "Account locked due to too many failed attempts. Try again in 15 minutes." });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (users.length === 0) {
      await recordFailedAttempt(email);
      res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
      return;
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const { locked, remaining } = await recordFailedAttempt(email);
      if (locked) {
        res.status(429).json({ error: "too_many_attempts", message: "Account locked due to too many failed attempts. Try again in 15 minutes." });
      } else {
        res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password", attemptsRemaining: remaining });
      }
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({ error: "email_not_verified", message: "Please verify your email address before logging in." });
      return;
    }

    await clearAttempts(email);
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

router.post("/auth/logout", authenticate, async (req, res) => {
  try {
    const token = req.headers.authorization!.slice(7);
    const decoded = jwt.decode(token) as { exp: number };
    await blockToken(token, decoded.exp);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Logout error");
    res.status(500).json({ error: "server_error", message: "Logout failed" });
  }
});

router.get("/auth/me", authenticate, async (req, res) => {
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (users.length === 0) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const user = users[0];
    res.json({ id: user.id, companyId: user.companyId, email: user.email, name: user.name, role: user.role, phone: user.phone ?? null, avatarUrl: user.avatarUrl ?? null, hasPin: !!user.pinHash, emailNotifications: user.emailNotifications, createdAt: user.createdAt.toISOString(), lastActiveAt: user.lastActiveAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Get me error");
    res.status(500).json({ error: "server_error", message: "Failed to get user" });
  }
});

router.post("/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "validation_error", message: "Token required" });
      return;
    }

    const users = await db.select().from(usersTable)
      .where(eq(usersTable.emailVerificationToken, token))
      .limit(1);

    if (users.length === 0) {
      res.status(400).json({ error: "invalid_token", message: "Invalid or expired verification link" });
      return;
    }

    const user = users[0];
    if (user.emailVerificationExpiry && user.emailVerificationExpiry < new Date()) {
      res.status(400).json({ error: "token_expired", message: "Verification link has expired" });
      return;
    }

    await db.update(usersTable).set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    }).where(eq(usersTable.id, user.id));

    sendWelcomeEmail(user.email, user.name).catch(err =>
      req.log.error({ err }, "Failed to send welcome email"),
    );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Verify email error");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

router.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "validation_error", message: "Email required" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    // Always return success to prevent email enumeration
    if (users.length === 0 || users[0].emailVerified) {
      res.json({ success: true });
      return;
    }

    const user = users[0];
    const verificationToken = randomBytes(32).toString("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.update(usersTable).set({
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
    }).where(eq(usersTable.id, user.id));

    sendVerificationEmail(user.email, user.name, verificationToken).catch(err =>
      req.log.error({ err }, "Failed to resend verification email"),
    );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Resend verification error");
    res.status(500).json({ error: "server_error", message: "Failed to resend verification email" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "validation_error", message: "Email required" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    // Always return success to prevent email enumeration
    if (users.length === 0) {
      res.json({ success: true });
      return;
    }

    const user = users[0];
    const resetToken = randomBytes(32).toString("hex");
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

    await db.update(usersTable).set({
      passwordResetToken: resetToken,
      passwordResetExpiry: resetExpiry,
    }).where(eq(usersTable.id, user.id));

    sendPasswordResetEmail(user.email, user.name, resetToken).catch(err =>
      req.log.error({ err }, "Failed to send password reset email"),
    );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Forgot password error");
    res.status(500).json({ error: "server_error", message: "Failed to process request" });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: "validation_error", message: "Token and password required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "validation_error", message: "Password must be at least 8 characters" });
      return;
    }

    const users = await db.select().from(usersTable)
      .where(eq(usersTable.passwordResetToken, token))
      .limit(1);

    if (users.length === 0) {
      res.status(400).json({ error: "invalid_token", message: "Invalid or expired reset link" });
      return;
    }

    const user = users[0];
    if (user.passwordResetExpiry && user.passwordResetExpiry < new Date()) {
      res.status(400).json({ error: "token_expired", message: "Reset link has expired" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.update(usersTable).set({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiry: null,
    }).where(eq(usersTable.id, user.id));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Reset password error");
    res.status(500).json({ error: "server_error", message: "Failed to reset password" });
  }
});

router.patch("/auth/me", authenticate, async (req, res) => {
  try {
    const { name, phone, avatarUrl, emailNotifications } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "validation_error", message: "Name cannot be empty" });
        return;
      }
      updates.name = name.trim();
    }
    if (phone !== undefined) updates.phone = phone || null;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl || null;
    if (typeof emailNotifications === "boolean") updates.emailNotifications = emailNotifications;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "validation_error", message: "No fields to update" });
      return;
    }

    await db.update(usersTable).set(updates).where(eq(usersTable.id, req.user!.id));
    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const u = users[0];
    res.json({ id: u.id, companyId: u.companyId, email: u.email, name: u.name, role: u.role, phone: u.phone ?? null, avatarUrl: u.avatarUrl ?? null, emailNotifications: u.emailNotifications, createdAt: u.createdAt.toISOString(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Update profile error");
    res.status(500).json({ error: "server_error", message: "Failed to update profile" });
  }
});

router.post("/auth/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "validation_error", message: "currentPassword and newPassword are required" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "validation_error", message: "New password must be at least 8 characters" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (users.length === 0) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const user = users[0];
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "invalid_credentials", message: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Change password error");
    res.status(500).json({ error: "server_error", message: "Failed to change password" });
  }
});

// Set, update, or reset the signed-in user's 4-digit sign-off PIN.
// Requires the current account password (this also serves as the reset path
// for a signed-in user who has forgotten their PIN).
router.post("/auth/pin", authenticate, async (req, res) => {
  try {
    const { currentPassword, pin } = req.body;
    if (!currentPassword || !pin) {
      res.status(400).json({ error: "validation_error", message: "currentPassword and pin are required" });
      return;
    }
    if (!/^\d{4}$/.test(String(pin))) {
      res.status(400).json({ error: "validation_error", message: "PIN must be exactly 4 digits" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (users.length === 0) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const user = users[0];
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "invalid_credentials", message: "Current password is incorrect" });
      return;
    }

    const pinHash = await bcrypt.hash(String(pin), 10);
    await db.update(usersTable).set({ pinHash }).where(eq(usersTable.id, user.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Set PIN error");
    res.status(500).json({ error: "server_error", message: "Failed to set PIN" });
  }
});

router.get("/companies/mine", authenticate, async (req, res) => {
  try {
    const rows = await db.select().from(companiesTable).where(eq(companiesTable.id, req.user!.companyId)).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "not_found", message: "Company not found" });
      return;
    }
    const c = rows[0];
    res.json({ id: c.id, name: c.name, size: c.size, subscriptionTier: c.subscriptionTier, subscriptionStatus: c.subscriptionStatus, betaAccess: c.betaAccess, createdAt: c.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Get company error");
    res.status(500).json({ error: "server_error", message: "Failed to get company" });
  }
});

// POST /api/subcontractors/:id/invite — generate (or regenerate) an invite link
router.post("/subcontractors/:id/invite", authenticate, async (req, res) => {
  try {
    const sub = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.id), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    // Reuse existing unused token, otherwise generate a new one
    let token = sub[0].inviteToken && !sub[0].inviteUsedAt ? sub[0].inviteToken : randomBytes(24).toString("hex");
    if (token !== sub[0].inviteToken) {
      await db.update(subcontractorsTable).set({ inviteToken: token, inviteUsedAt: null }).where(eq(subcontractorsTable.id, req.params.id));
    }

    res.json({ token, email: sub[0].contactEmail, name: sub[0].contactName });
  } catch (err) {
    req.log.error({ err }, "Generate invite error");
    res.status(500).json({ error: "server_error", message: "Failed to generate invite" });
  }
});

// GET /api/auth/invite/:token — public: get invite prefill data
router.get("/auth/invite/:token", async (req, res) => {
  try {
    const rows = await db.select({
      id: subcontractorsTable.id,
      contactName: subcontractorsTable.contactName,
      contactEmail: subcontractorsTable.contactEmail,
      inviteUsedAt: subcontractorsTable.inviteUsedAt,
      companyId: subcontractorsTable.companyId,
    }).from(subcontractorsTable)
      .where(eq(subcontractorsTable.inviteToken, req.params.token))
      .limit(1);

    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Invalid invite link" }); return; }
    if (rows[0].inviteUsedAt) { res.status(410).json({ error: "invite_used", message: "This invite has already been used" }); return; }

    const company = await db.select({ name: companiesTable.name })
      .from(companiesTable).where(eq(companiesTable.id, rows[0].companyId)).limit(1);

    res.json({ name: rows[0].contactName, email: rows[0].contactEmail, companyName: company[0]?.name ?? "your company" });
  } catch (err) {
    req.log.error({ err }, "Get invite error");
    res.status(500).json({ error: "server_error", message: "Failed to load invite" });
  }
});

// POST /api/auth/invite/:token/accept — public: register via invite link
router.post("/auth/invite/:token/accept", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name?.trim() || !password) {
      res.status(400).json({ error: "validation_error", message: "Name and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "validation_error", message: "Password must be at least 8 characters" });
      return;
    }

    const rows = await db.select().from(subcontractorsTable)
      .where(eq(subcontractorsTable.inviteToken, req.params.token)).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "not_found", message: "Invalid invite link" }); return; }
    if (rows[0].inviteUsedAt) { res.status(410).json({ error: "invite_used", message: "This invite has already been used" }); return; }

    const email = rows[0].contactEmail;
    const companyId = rows[0].companyId;

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing[0]) {
      res.status(400).json({ error: "already_registered", message: "An account with this email already exists. Please log in." });
      return;
    }

    const userId = generateId();
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(usersTable).values({
      id: userId,
      companyId,
      email,
      passwordHash,
      name: name.trim(),
      role: "subcontractor",
      emailVerified: true,
    });

    await db.update(subcontractorsTable).set({ inviteUsedAt: new Date() }).where(eq(subcontractorsTable.id, rows[0].id));

    const token = generateToken({ id: userId, companyId, role: "subcontractor", email });
    res.status(201).json({
      user: { id: userId, companyId, email, name: name.trim(), role: "subcontractor" },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Accept invite error");
    res.status(500).json({ error: "server_error", message: "Failed to accept invite" });
  }
});

router.patch("/companies/mine", authenticate, async (req, res) => {
  try {
    if (req.user!.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Only admins can update company settings" });
      return;
    }
    const { name, size } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "validation_error", message: "Company name cannot be empty" });
        return;
      }
      updates.name = name.trim();
    }
    if (size !== undefined) updates.size = size;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "validation_error", message: "No fields to update" });
      return;
    }

    await db.update(companiesTable).set(updates).where(eq(companiesTable.id, req.user!.companyId));
    const rows = await db.select().from(companiesTable).where(eq(companiesTable.id, req.user!.companyId)).limit(1);
    const c = rows[0];
    res.json({ id: c.id, name: c.name, size: c.size, subscriptionTier: c.subscriptionTier, subscriptionStatus: c.subscriptionStatus, betaAccess: c.betaAccess, createdAt: c.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Update company error");
    res.status(500).json({ error: "server_error", message: "Failed to update company" });
  }
});

export default router;
