import { Router, type IRouter } from "express";
import { insertNotifications } from "../lib/notify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { emailLogTable, projectInvitesTable, notificationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";
import { notify } from "../lib/db-watchdog";
import { maskEmail } from "../lib/environment";

// POST /api/email/webhook — Resend's delivery reports (2026-10-16). Before this,
// SiteSort never heard about a bounce: a builder's portal invite could bounce
// while his card said "sent", and nobody knew. Now:
//   • every report updates email_log (sent -> delivered / delayed / bounced / complained)
//   • a bounced or complained PORTAL INVITE marks that invite failed (the card
//     shows it) and notifies whoever sent it, deep-linked to the person's card
//   • every bounce or complaint emails OPS_ALERT_EMAIL
// Public (Resend calls it), so it is signed: Resend signs with Svix. Set the
// endpoint's signing secret as RESEND_WEBHOOK_SECRET (starts "whsec_"). With no
// secret the route refuses everything, so nothing unsigned is ever trusted.
// Mounted with express.raw in app.ts: the signature covers the exact bytes.

const router: IRouter = Router();

const TOLERANCE_S = 5 * 60;
const STATUS: Record<string, string> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};
// A later report never makes an email look better than it was.
const RANK: Record<string, number> = { sent: 0, refused: 0, delayed: 1, delivered: 2, bounced: 3, complained: 3 };

export function verifySvixSignature(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some(part => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type ResendEvent = { type?: string; data?: { email_id?: string; to?: string[] | string; subject?: string; bounce?: { message?: string; type?: string; subType?: string } } };

router.post("/email/webhook", async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!secret) {
    req.log.error("email webhook: RESEND_WEBHOOK_SECRET not set, report refused");
    res.status(503).json({ error: "not_configured" });
    return;
  }
  const ok = verifySvixSignature(secret, {
    id: req.header("svix-id") ?? undefined,
    timestamp: req.header("svix-timestamp") ?? undefined,
    signature: req.header("svix-signature") ?? undefined,
  }, raw);
  if (!ok) { res.status(401).json({ error: "bad_signature" }); return; }

  let event: ResendEvent;
  try { event = JSON.parse(raw) as ResendEvent; } catch { res.status(400).json({ error: "bad_json" }); return; }
  const status = event.type ? STATUS[event.type] : undefined;
  const providerId = event.data?.email_id;
  // Other event types (email.sent, email.opened...) are acknowledged and ignored.
  if (!status || !providerId) { res.json({ ok: true, ignored: true }); return; }

  try {
    const row = (await db.select().from(emailLogTable).where(eq(emailLogTable.providerId, providerId)).limit(1))[0];
    const to = row?.toAddress ?? (Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to) ?? "unknown";
    const subject = row?.subject ?? event.data?.subject ?? "";
    const isNewBad = (status === "bounced" || status === "complained") && (RANK[row?.status ?? "sent"] ?? 0) < 3;

    if (row && (RANK[status] ?? 0) >= (RANK[row.status] ?? 0) && row.status !== status) {
      await db.update(emailLogTable).set({ status, updatedAt: new Date(), error: event.data?.bounce?.message ?? row.error })
        .where(eq(emailLogTable.id, row.id));
    }

    // Redeliveries of the same report do nothing more: only the first bad one acts.
    if (isNewBad) {
      const reason = status === "complained"
        ? "marked it as spam"
        : `bounced${event.data?.bounce?.message ? `: ${event.data.bounce.message}` : ""}`;
      if (row?.refType === "project_invite" && row.refId) {
        const invite = (await db.select().from(projectInvitesTable).where(eq(projectInvitesTable.id, row.refId)).limit(1))[0];
        if (invite) {
          await db.update(projectInvitesTable).set({ emailStatus: "failed" }).where(eq(projectInvitesTable.id, invite.id));
          await insertNotifications({ projectId: invite.projectId,
            id: generateId(), userId: invite.invitedByUserId, type: "invite_email_bounced",
            title: `Invite email to ${invite.email} didn't arrive`,
            message: status === "complained"
              ? `${invite.email} marked the Team Portal invite as spam. Check with them, then send the invite link another way.`
              : `The Team Portal invite to ${invite.email} bounced. Check the address on their card, then resend the invite.`,
            relatedEntityId: invite.personId ?? invite.id, relatedEntityType: "person",
            metadata: { projectId: invite.projectId, inviteId: invite.id }, read: false,
          });
        }
      }
      await notify(`SiteSort: an email ${status === "complained" ? "was marked as spam" : "bounced"}`, [
        `An email to ${maskEmail(to)} ${reason}.`,
        `Subject: ${subject || "(unknown)"}.`,
        row?.refType ? `It was a ${row.refType.replace(/_/g, " ")}${row.refId ? ` (${row.refId})` : ""}.` : "It isn't in SiteSort's email log (sent before the log existed, or not by SiteSort).",
        "Several bounces in a short time can get SiteSort's email throttled. Check Resend, Metrics.",
      ]).catch(err => req.log.error({ err }, "email webhook: alert not sent"));
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "email webhook error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
