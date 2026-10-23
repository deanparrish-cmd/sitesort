import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, credentialEventsTable } from "@workspace/db/schema";
import { generateId } from "./id";
import { logger } from "./logger";
import { IS_DEPLOYED } from "./environment";
import { sendCredentialNoticeEmail, credentialNoticeText, type CredentialNoticeKind } from "./email";
import { sendPushToUser } from "./web-push";

// Only the owner controls a login's password and PIN (Dean, 2026-10-23,
// binding), and the owner hears of every change: an email and a push to their
// phones, so a change they didn't make can't go unnoticed. Every event is
// written to credential_events with what was sent. Never the secret itself.

export type CredentialEventKind = CredentialNoticeKind
  | "password_reset_requested" | "pin_reset_requested" | "invite_accepted";

const PUSH_TEXT: Record<CredentialEventKind, string | null> = {
  password_changed: "Your SiteSort password was just changed. If this wasn't you, reset it now with Forgot password.",
  pin_set: "A sign-off PIN was just set on your SiteSort account. If this wasn't you, reset your password now.",
  pin_changed: "Your sign-off PIN was just changed. If this wasn't you, reset your password now.",
  pin_switched_off: "Your sign-off PIN was switched off after too many wrong tries. Use Forgot PIN to choose a new one.",
  password_reset_requested: "A password reset link was just emailed to you. If you didn't ask for it, ignore it.",
  pin_reset_requested: "A PIN reset link was just emailed to you. If you didn't ask for it, ignore it.",
  invite_accepted: null,
};

export async function recordCredentialEvent(userId: string, kind: CredentialEventKind, req?: Request): Promise<void> {
  try {
    const user = (await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable)
      .where(eq(usersTable.id, userId)).limit(1))[0];
    if (!user) return;
    // Reset requests already send their own email (the link), so only a push.
    let emailNotice = "none";
    if (kind === "password_changed" || kind === "pin_set" || kind === "pin_changed" || kind === "pin_switched_off") {
      try {
        await sendCredentialNoticeEmail(user.email, user.name, kind);
        emailNotice = IS_DEPLOYED ? "sent" : "suppressed";
      } catch (err) {
        emailNotice = "failed";
        logger.error({ err, userId, kind }, "credential notice email failed");
      }
    } else if (kind !== "invite_accepted") {
      emailNotice = "reset_link";
    }
    let pushNotice = 0;
    const body = PUSH_TEXT[kind];
    if (body) {
      pushNotice = await sendPushToUser(userId, {
        title: kind.startsWith("pin") ? "SiteSort sign-off PIN" : "SiteSort account",
        body,
        url: "/portal/settings",
        tag: `credential-${kind}`,
      }).catch(() => 0);
    }
    await db.insert(credentialEventsTable).values({
      id: generateId(), userId, kind,
      ipAddress: req?.ip ?? null,
      userAgent: (req?.headers["user-agent"] as string | undefined) ?? null,
      emailNotice, pushNotice,
    });
  } catch (err) {
    logger.error({ err, userId, kind }, "failed to record credential event");
  }
}

export { credentialNoticeText };
