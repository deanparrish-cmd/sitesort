import type { Request } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, pinAuditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "./id";

type SetPinResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

// Set/update/reset a user's 4-digit sign-off PIN. Requires the account password
// as re-verification — this is also the "forgot PIN" path for a signed-in user
// who no longer remembers it. Shared by /auth/pin (dashboard) and /portal/pin
// (portal members) since both are the same usersTable row underneath. Every
// call is logged to pin_audit_log (set vs reset, never the PIN itself).
export async function setUserPin(userId: string, currentPassword: string, pin: string, req: Request): Promise<SetPinResult> {
  if (!currentPassword || !pin) {
    return { ok: false, status: 400, error: "validation_error", message: "currentPassword and pin are required" };
  }
  if (!/^\d{4}$/.test(String(pin))) {
    return { ok: false, status: 400, error: "validation_error", message: "PIN must be exactly 4 digits" };
  }

  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return { ok: false, status: 404, error: "not_found", message: "User not found" };

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return { ok: false, status: 401, error: "invalid_credentials", message: "Current password is incorrect" };

  const pinHash = await bcrypt.hash(String(pin), 10);
  await db.update(usersTable).set({ pinHash }).where(eq(usersTable.id, user.id));
  await db.insert(pinAuditLogTable).values({
    id: generateId(),
    userId: user.id,
    userName: user.name,
    action: user.pinHash ? "reset" : "set",
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  return { ok: true };
}
