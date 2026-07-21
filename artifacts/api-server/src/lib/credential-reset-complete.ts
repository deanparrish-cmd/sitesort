import bcrypt from "bcryptjs";
import { eq, and, isNull } from "drizzle-orm";
import type { Request } from "express";
import { db } from "@workspace/db";
import { usersTable, portalSessionsTable, pinAuditLogTable } from "@workspace/db/schema";
import { generateId } from "./id";
import { clearAttempts } from "./login-attempts";
import { logger } from "./logger";
import { logResetCompleted } from "./credential-reset";
import { bustSessionsInvalidBeforeCache } from "../middlewares/auth";

// Completion side of the unified reset backbone (separate module so the
// request/consume half stays dependency-light).

// New password + full session invalidation: every live portal session for the
// account is revoked, and sessions_invalid_before boots any dashboard JWT
// issued before this instant (checked in `authenticate`). A compromised
// account cannot stay logged in elsewhere after a reset.
export async function completePasswordReset(userId: string, password: string, req: Request): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  await db.update(usersTable).set({
    passwordHash,
    sessionsInvalidBefore: now,
    // Legacy plaintext-token columns — cleared so old links die with the new flow.
    passwordResetToken: null,
    passwordResetExpiry: null,
    // Proving control of the inbox verifies the email.
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiry: null,
  }).where(eq(usersTable.id, userId));

  await db.update(portalSessionsTable).set({ revokedAt: now })
    .where(and(eq(portalSessionsTable.userId, userId), isNull(portalSessionsTable.revokedAt)));
  bustSessionsInvalidBeforeCache(userId);

  const rows = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (rows[0]) {
    await clearAttempts(rows[0].email).catch((err) =>
      logger.error({ err }, "Failed to clear login attempts after reset"));
  }

  await logResetCompleted(userId, "password", req);
}

// New PIN via email token (locked-out path). PIN is bcrypt-hashed like the
// in-app path; audited in pin_audit_log (never the PIN itself). Password
// sessions are untouched — a PIN reset only re-sets the PIN.
export async function completePinReset(userId: string, pin: string, req: Request): Promise<void> {
  const pinHash = await bcrypt.hash(pin, 10);
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new Error("User not found for PIN reset");

  await db.update(usersTable).set({ pinHash }).where(eq(usersTable.id, userId));
  await db.insert(pinAuditLogTable).values({
    id: generateId(),
    userId,
    userName: user.name,
    action: "reset",
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  await logResetCompleted(userId, "pin", req);
}
