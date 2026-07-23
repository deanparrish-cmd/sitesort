import { createHash, randomBytes } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  credentialResetTokensTable,
  usersTable,
  projectMembersTable,
} from "@workspace/db/schema";
import { generateId } from "./id";
import { redis } from "./redis";
import { logger } from "./logger";
import { logActivity } from "./activity";
import { sendPasswordResetEmail, sendPinResetEmail } from "./email";
import type { Request } from "express";

// Unified "forgot password / forgot PIN" backbone. One token model for all
// three credential types (PM password, portal member password, sign-off PIN —
// all on the same users row):
//   - 32 random bytes, hex — the raw token exists ONLY in the email link.
//   - sha256 hash stored at rest; never logged.
//   - 60-minute expiry; single-use (usedAt); requesting a new token
//     invalidates any outstanding unused tokens of the same kind.
//   - Identical generic response whether or not the email exists.
//   - Rate-limited per email AND per IP (3/hour each), applied BEFORE the
//     account lookup so the limiter can't be used for enumeration either.

export type ResetKind = "password" | "pin";
export type ResetContext = "app" | "portal";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_S = 60 * 60; // per hour

const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

async function overRateLimit(key: string): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_S);
  return count > RATE_LIMIT_MAX;
}

// Best-effort audit trail. activity_log rows are project-scoped, so we write
// one row per project membership (covers portal members and PMs on projects);
// the pino line is the unconditional record.
async function logResetEvent(userId: string, companyId: string, action: string, kind: ResetKind, req?: Request): Promise<void> {
  logger.info({ userId, kind, action }, "credential reset event");
  try {
    const memberships = await db.select({ projectId: projectMembersTable.projectId })
      .from(projectMembersTable).where(eq(projectMembersTable.userId, userId));
    await Promise.all(memberships.map((m) => logActivity({
      userId,
      projectId: m.projectId,
      companyId,
      section: "security",
      action,
      metadata: { kind },
      req,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to write reset activity log");
  }
}

// Called by the completion helpers once a credential has actually been re-set.
export async function logResetCompleted(userId: string, kind: ResetKind, req?: Request): Promise<void> {
  const rows = await db.select({ companyId: usersTable.companyId }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  await logResetEvent(userId, rows[0]?.companyId ?? "", "reset_completed", kind, req);
}

// Always resolves to the same generic outcome unless rate-limited. Sends the
// email only when the account actually exists.
export async function requestCredentialReset(opts: {
  email: string;
  kind: ResetKind;
  context: ResetContext;
  req: Request;
}): Promise<{ limited: boolean }> {
  const email = opts.email.trim().toLowerCase();
  const ip = opts.req.ip ?? "unknown";

  const [emailLimited, ipLimited] = await Promise.all([
    overRateLimit(`credreset:${opts.kind}:email:${email}`),
    overRateLimit(`credreset:ip:${ip}`),
  ]);
  if (emailLimited || ipLimited) return { limited: true };

  const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (users.length === 0) return { limited: false }; // generic response upstream — no enumeration
  const user = users[0];

  // A new request supersedes any outstanding unused tokens of the same kind.
  await db.update(credentialResetTokensTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(credentialResetTokensTable.userId, user.id),
      eq(credentialResetTokensTable.kind, opts.kind),
      isNull(credentialResetTokensTable.usedAt),
    ));

  const rawToken = randomBytes(32).toString("hex");
  await db.insert(credentialResetTokensTable).values({
    id: generateId(),
    userId: user.id,
    kind: opts.kind,
    context: opts.context,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    requestIp: opts.req.ip ?? null,
  });

  const send = opts.kind === "pin"
    ? sendPinResetEmail(user.email, user.name, rawToken, opts.context)
    : sendPasswordResetEmail(user.email, user.name, rawToken, opts.context);
  send.catch((err) => logger.error({ err }, "Failed to send credential reset email"));

  void logResetEvent(user.id, user.companyId ?? "", "reset_requested", opts.kind, opts.req);
  return { limited: false };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

// Atomically consume a token: marks it used in the same conditional UPDATE
// that validates it, so a spent link can never be replayed (no read-then-write
// race). Expired-but-unused tokens are reported as "expired" for the friendly
// "request a new one" page.
export async function consumeCredentialResetToken(rawToken: string, kind: ResetKind): Promise<ConsumeResult> {
  const hash = sha256(rawToken);
  const consumed = await db.update(credentialResetTokensTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(credentialResetTokensTable.tokenHash, hash),
      eq(credentialResetTokensTable.kind, kind),
      isNull(credentialResetTokensTable.usedAt),
    ))
    .returning();

  if (consumed.length === 0) return { ok: false, reason: "invalid" };
  const row = consumed[0];
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}
