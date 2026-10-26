import { Resend } from "resend";
import { IS_DEPLOYED } from "./environment";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { emailLogTable, usersTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { generateId } from "./id";
import { WORKER_GUIDE } from "@workspace/user-guide";

const FROM = "SiteSort <noreply@mail.sitesort.co.uk>";
// Team Portal invites send from a dedicated address (env-overridable). The Resend
// domain mail.sitesort.co.uk is verified; keep the default in sync with the spec.
const INVITE_FROM = process.env.EMAIL_FROM ?? "SiteSort <invites@mail.sitesort.co.uk>";
const REPLY_TO = "SiteSort Support <support@sitesort.co.uk>";
const SUPPORT_EMAIL = "support@sitesort.co.uk";
const APP_URL = process.env.APP_URL ?? "https://www.sitesort.co.uk";

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

// Centralised sender so every transactional email shares the same
// "from" name and a SiteSort reply-to address. `from` overrides the default.
// Never send to reserved, undeliverable test domains (RFC 2606: .test,
// .invalid, .example, example.com/.net/.org). Automated tests create users on
// those addresses; this keeps them from reaching the live mail provider.
// Matches the bare name too (x@test, x@localhost), not only x@a.test.
const RESERVED_TEST_DOMAIN = /@(?:[^@\s]*\.)?(?:test|invalid|example|localhost|local|example\.(?:com|net|org))$/i;
// Real-looking domains that tests and old fixtures once used. Someone could
// register any of them, so they are never sent to, wherever the code runs
// (Dean, 2026-10-26: "safe because of where it happens to run" stops being true quietly).
const NEVER_SEND_DOMAINS = ["testsitesort.co.uk", "sitesort-footer-check.co.uk", "sitesort-reminder-check.co.uk", "example-real.co.uk"];
export function isReservedTestAddress(to: string): boolean {
  const addr = to.trim().toLowerCase();
  return RESERVED_TEST_DOMAIN.test(addr) || NEVER_SEND_DOMAINS.some(d => addr.endsWith(`@${d}`) || addr.endsWith(`.${d}`));
}

// What an email was for, so a bounce reported later by the Resend webhook can
// be traced back to it (e.g. { type: "project_invite", id: inviteId }).
export type EmailRef = { type: string; id: string };

// Resend refused the email (bad address, unverified domain, rate limit, paused
// account). Resend's SDK reports these in its return value and does NOT throw,
// so before 2026-10-16 every `.catch()` around a send missed them: a refused
// expiry reminder was recorded as sent. send() now throws this instead.
export class EmailRefusedError extends Error {
  constructor(message: string) { super(`Resend refused the email: ${message}`); this.name = "EmailRefusedError"; }
}

type SendOpts = { to: string; subject: string; html: string; text: string; from?: string; ref?: EmailRef; noLog?: boolean };
type Transport = (payload: { from: string; replyTo: string; to: string; subject: string; html: string; text: string }) =>
  Promise<{ data: { id: string } | null; error: { message?: string; name?: string } | null }>;

// Test seam ONLY: lets tests stand in for Resend (to make it refuse) without
// a live key. Never set outside tests.
let testTransport: Transport | null = null;
export function __setEmailTransportForTests(t: Transport | null): void { testTransport = t; }

// Best-effort: the log must never stop an email or crash a caller. Ops alerts
// pass noLog (they're sent when the database may be the thing that's down).
async function logEmail(opts: SendOpts, status: "sent" | "refused", providerId: string | null, error: string | null) {
  if (opts.noLog) return;
  try {
    await db.insert(emailLogTable).values({
      id: generateId(), providerId, toAddress: opts.to, subject: opts.subject,
      refType: opts.ref?.type ?? null, refId: opts.ref?.id ?? null, status, error,
    });
  } catch (err) {
    logger.warn({ err, subject: opts.subject }, "email log write failed");
  }
}

// Returns Resend's { data, error } shape for the callers that read it, but a
// refusal THROWS (EmailRefusedError) so no caller can miss it.
// The "manage email notifications" footer names a control only dashboard
// accounts have (Settings, Notifications tab). Portal-only members and people
// with no SiteSort account have no such setting, so they never see the line
// (Dean, 2026-10-20: don't tell people about a control that doesn't exist).
// Templates put these markers where the line goes; send() resolves them.
const SETTINGS_LINE = "You can manage email notifications in your SiteSort account settings.";
const SETTINGS_LINE_HTML = "<!--sitesort-settings-line-->";
const SETTINGS_LINE_TEXT = "[[sitesort-settings-line]]";

async function resolveSettingsLine(opts: SendOpts): Promise<SendOpts> {
  if (!opts.html.includes(SETTINGS_LINE_HTML) && !(opts.text ?? "").includes(SETTINGS_LINE_TEXT)) return opts;
  let show = false;
  try {
    const u = (await db.select({ portalOnly: usersTable.portalOnly }).from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${opts.to.trim().toLowerCase()}`).limit(1))[0];
    show = !!u && !u.portalOnly;
  } catch { show = false; }
  return {
    ...opts,
    html: opts.html.replace(SETTINGS_LINE_HTML, show ? muted(SETTINGS_LINE) : ""),
    text: opts.text?.replace(SETTINGS_LINE_TEXT, show ? `\n\n${SETTINGS_LINE}` : ""),
  };
}

async function send(opts: SendOpts): Promise<{ data: { id: string } | null; error: null }> {
  opts = await resolveSettingsLine(opts);
  // A test's stand-in transport may still receive these (it is never Resend),
  // so tests can capture email on .test addresses instead of real-looking ones.
  if (isReservedTestAddress(opts.to) && !testTransport) {
    return { data: { id: "skipped-reserved-test-domain" }, error: null };
  }
  // Outside the deployed app no email ever leaves: the workspace database holds
  // real people's addresses (copied rows), and it once sent them certificate
  // reminders. Logged so a dev can see what would have gone.
  if (!IS_DEPLOYED && !testTransport) {
    logger.info({ subject: opts.subject }, "email suppressed outside the deployed app");
    return { data: { id: "suppressed-not-deployed" }, error: null };
  }
  const payload = { from: opts.from ?? FROM, replyTo: REPLY_TO, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text };
  let result: Awaited<ReturnType<Transport>>;
  try {
    result = testTransport ? await testTransport(payload) : await resend().emails.send(payload) as Awaited<ReturnType<Transport>>;
  } catch (err) {
    // Network failure or missing key: never reached Resend.
    await logEmail(opts, "refused", null, err instanceof Error ? err.message : String(err));
    throw err;
  }
  if (result.error) {
    const message = result.error.message ?? result.error.name ?? "unknown error";
    logger.error({ subject: opts.subject, ref: opts.ref, error: message }, "email refused by Resend");
    await logEmail(opts, "refused", null, message);
    throw new EmailRefusedError(message);
  }
  await logEmail(opts, "sent", result.data?.id ?? null, null);
  return { data: result.data, error: null };
}

// Strip a name down to a usable greeting, with a sensible fallback.
function firstName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed;
}

function layout(body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:0;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:600px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#9a3412 0%,#ea580c 50%,#f97316 100%);background-color:#ea580c;padding:32px 40px;">
  <div style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">SiteSort</div>
  <div style="color:#ffe6d5;font-size:12px;margin-top:4px;">Construction Site Information Management</div>
</td></tr>
<tr><td style="padding:40px;">${body}</td></tr>
<tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
  <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0;">SiteSort &middot; <a href="https://www.sitesort.co.uk" style="color:#ea580c;text-decoration:none;">sitesort.co.uk</a><br>Questions? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#ea580c;text-decoration:none;">${SUPPORT_EMAIL}</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Wrap plain-text bodies with a matching header and footer.
function textLayout(body: string): string {
  return `SiteSort · Construction Site Information Management
========================================================

${body.trim()}

--------------------------------------------------------
SiteSort · https://www.sitesort.co.uk
Questions? Email us at ${SUPPORT_EMAIL}`;
}

const btn = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#ea580c" style="background-color:#ea580c;border-radius:8px;">
    <a href="${href}" target="_blank" style="display:inline-block;background-color:#ea580c;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;border:1px solid #ea580c;mso-padding-alt:0;">${label}</a>
  </td></tr></table>`;

const h = (t: string) =>
  `<h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 12px;">${t}</h2>`;

const p = (t: string) =>
  `<p style="color:#374151;font-size:15px;line-height:1.65;margin:0 0 14px;">${t}</p>`;

const muted = (t: string) =>
  `<p style="color:#9ca3af;font-size:13px;line-height:1.5;margin:20px 0 0;">${t}</p>`;

const box = (inner: string, bg = "#f9fafb", border = "#e5e7eb") =>
  `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:18px 20px;margin:16px 0;">${inner}</div>`;

// Condensed "getting started" tips for the invite email, pulled live from the
// same worker guide the portal's Help page and the dashboard's User Guide
// page render — edit lib/user-guide/src/index.ts to change the copy
// everywhere at once. Only a couple of the most useful sections are excerpted
// here (the full guide is linked below); keep this list short for a mobile inbox.
const INVITE_EMAIL_EXCERPT_SECTIONS = ["home-screen", "shared-with-me"];
function guideExcerptItemsHtml(): string {
  const items = WORKER_GUIDE
    .filter(s => INVITE_EMAIL_EXCERPT_SECTIONS.includes(s.id))
    .flatMap(s => s.steps.map(st => `<li style="margin-bottom:8px;"><strong>${st.heading}:</strong> ${st.body[0]}</li>`));
  return `<ul style="margin:0 0 4px;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">${items.join("")}</ul>`;
}
function guideExcerptItemsText(): string {
  return WORKER_GUIDE
    .filter(s => INVITE_EMAIL_EXCERPT_SECTIONS.includes(s.id))
    .flatMap(s => s.steps.map(st => `- ${st.heading}: ${st.body[0]}`))
    .join("\n");
}

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  const greeting = firstName(name);
  return send({
    to,
    subject: "Verify your SiteSort email address",
    html: layout(`
      ${h(`Welcome to SiteSort, ${greeting}!`)}
      ${p("Thanks for registering. Please verify your email address to activate your account and start managing your site information.")}
      ${btn(link, "Verify Email Address")}
      ${muted(`This link expires in 24 hours. If you didn't create a SiteSort account, you can safely ignore this email.<br>Button not working? Copy and paste this link:<br><a href="${link}" style="color:#ea580c;word-break:break-all;">${link}</a>`)}
    `),
    text: textLayout(`Welcome to SiteSort, ${greeting}!

Thanks for registering. Please verify your email address to activate your account and start managing your site information.

Verify your email address:
${link}

This link expires in 24 hours. If you didn't create a SiteSort account, you can safely ignore this email.`),
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string, context: "app" | "portal" = "app") {
  const link = context === "portal"
    ? `${APP_URL}/portal/reset-password?token=${token}`
    : `${APP_URL}/reset-password?token=${token}`;
  const greeting = firstName(name);
  return send({
    to,
    subject: "Reset your SiteSort password",
    html: layout(`
      ${h("Password reset requested")}
      ${p(`Hi ${greeting},`)}
      ${p("We received a request to reset the password on your SiteSort account. Click the button below to choose a new password.")}
      ${btn(link, "Reset Password")}
      ${muted(`This link expires in 1 hour. If you didn't request this, your account is safe. Just ignore this email.<br>Button not working? Copy and paste this link:<br><a href="${link}" style="color:#ea580c;word-break:break-all;">${link}</a>`)}
    `),
    text: textLayout(`Password reset requested

Hi ${greeting},

We received a request to reset the password on your SiteSort account. Use the link below to choose a new password.

Reset your password:
${link}

This link expires in 1 hour. If you didn't request this, your account is safe. Just ignore this email.`),
  });
}

// Forgot sign-off PIN (locked-out path — a signed-in user resets it in-app
// with their password instead). Same token backbone as password resets.
export async function sendPinResetEmail(to: string, name: string, token: string, context: "app" | "portal" = "app") {
  const link = `${APP_URL}/reset-pin?token=${token}${context === "portal" ? "&context=portal" : ""}`;
  const greeting = firstName(name);
  return send({
    to,
    subject: "Reset your SiteSort sign-off PIN",
    html: layout(`
      ${h("Sign-off PIN reset requested")}
      ${p(`Hi ${greeting},`)}
      ${p("We received a request to reset the 4-digit sign-off PIN on your SiteSort account. Click the button below to choose a new PIN.")}
      ${btn(link, "Reset PIN")}
      ${muted(`This link expires in 1 hour. If you didn't request this, your account is safe. Just ignore this email.<br>Button not working? Copy and paste this link:<br><a href="${link}" style="color:#ea580c;word-break:break-all;">${link}</a>`)}
    `),
    text: textLayout(`Sign-off PIN reset requested

Hi ${greeting},

We received a request to reset the 4-digit sign-off PIN on your SiteSort account. Use the link below to choose a new PIN.

Reset your PIN:
${link}

This link expires in 1 hour. If you didn't request this, your account is safe. Just ignore this email.`),
  });
}

// Security notice to the owner of a login when its password or PIN changes,
// or its PIN is switched off (Dean, 2026-10-23: only the owner controls these,
// and the owner hears of every change). Sent whatever the email setting says,
// like the reset emails themselves: it's about the account, not a feature.
export type CredentialNoticeKind = "password_changed" | "pin_set" | "pin_changed" | "pin_switched_off";
export function credentialNoticeText(kind: CredentialNoticeKind): { subject: string; heading: string; lines: string[] } {
  const notYou = "If this wasn't you, reset your password straight away with Forgot password on the SiteSort sign-in page. Only you can do this: nobody at your company can change your password or PIN for you.";
  switch (kind) {
    case "password_changed": return { subject: "Your SiteSort password was changed", heading: "Your password was changed", lines: ["The password on your SiteSort account was just changed. If you did this, there's nothing else to do.", notYou] };
    case "pin_set": return { subject: "A sign-off PIN was set on your SiteSort account", heading: "Your sign-off PIN was set", lines: ["A 4-digit sign-off PIN was just set on your SiteSort account. It's what you enter to sign off method statements, permits and other documents.", notYou] };
    case "pin_changed": return { subject: "Your SiteSort sign-off PIN was changed", heading: "Your sign-off PIN was changed", lines: ["The 4-digit sign-off PIN on your SiteSort account was just changed. If you did this, there's nothing else to do.", notYou] };
    case "pin_switched_off": return { subject: "Your SiteSort sign-off PIN has been switched off", heading: "Your sign-off PIN is switched off", lines: ["Your sign-off PIN was entered wrongly too many times, so it has been switched off and nothing can be signed with it.", "To use it again, choose Forgot PIN (on the SiteSort sign-in page, or from the sign-off box) and use the link we email you to choose a new PIN.", "If you didn't try to sign anything, someone else may have had your phone."] };
  }
}
export async function sendCredentialNoticeEmail(to: string, name: string, kind: CredentialNoticeKind) {
  const t = credentialNoticeText(kind);
  const greeting = firstName(name);
  return send({
    to,
    subject: t.subject,
    html: layout(`
      ${h(t.heading)}
      ${p(`Hi ${greeting},`)}
      ${t.lines.map(l => p(l)).join("")}
    `),
    text: textLayout(`${t.heading}

Hi ${greeting},

${t.lines.join("\n\n")}`),
  });
}

// Sent once a user has verified their email and their account is active.
export async function sendWelcomeEmail(to: string, name: string) {
  const link = `${APP_URL}/dashboard`;
  const greeting = firstName(name);
  return send({
    to,
    subject: "Welcome to SiteSort 🎉",
    html: layout(`
      ${h(`You're all set, ${greeting}!`)}
      ${p("Your SiteSort account is verified and ready to go. SiteSort helps construction teams keep drawings, method statements, permits and compliance records in one organised place.")}
      ${box(`
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:10px;">A few things you can do first</div>
        <div style="font-size:14px;color:#374151;line-height:1.7;">• Create your first project<br>• Upload and distribute key documents<br>• Invite your team and subcontractors<br>• Track insurance and permit expiry dates</div>
      `)}
      ${btn(link, "Go to your dashboard")}
      ${muted(`Need a hand getting started? Just reply to this email or contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#ea580c;">${SUPPORT_EMAIL}</a>.`)}
    `),
    text: textLayout(`You're all set, ${greeting}!

Your SiteSort account is verified and ready to go. SiteSort helps construction teams keep drawings, method statements, permits and compliance records in one organised place.

A few things you can do first:
- Create your first project
- Upload and distribute key documents
- Invite your team and subcontractors
- Track insurance and permit expiry dates

Go to your dashboard:
${link}

Need a hand getting started? Just reply to this email or contact us at ${SUPPORT_EMAIL}.`),
  });
}

export async function sendInvitationEmail(
  to: string,
  name: string,
  companyName: string,
  tempPassword: string,
  inviterName: string,
) {
  const loginLink = `${APP_URL}/login`;
  const greeting = firstName(name);
  const company = companyName?.trim() || "your company";
  const inviter = inviterName?.trim() || "Your administrator";
  return send({
    to,
    subject: `You've been added to ${company} on SiteSort`,
    html: layout(`
      ${h(`Hi ${greeting}, you've been invited to SiteSort`)}
      ${p(`${inviter} has added you to the <strong>${company}</strong> workspace on SiteSort, a construction site information management platform.`)}
      ${box(`
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Your login credentials</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;">Email: <strong>${to}</strong></div>
        <div style="font-size:14px;color:#374151;">Temporary password: <strong style="font-family:monospace;background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #d1d5db;">${tempPassword}</strong></div>
      `)}
      ${btn(loginLink, "Log in to SiteSort")}
      ${muted("For your security, please change your password after your first login.")}
    `),
    text: textLayout(`Hi ${greeting}, you've been invited to SiteSort

${inviter} has added you to the ${company} workspace on SiteSort, a construction site information management platform.

Your login credentials:
Email: ${to}
Temporary password: ${tempPassword}

Log in to SiteSort:
${loginLink}

For your security, please change your password after your first login.`),
  });
}

// New document distributed to a recipient (acknowledgment NOT required).
export async function sendDocumentNotificationEmail(
  to: string,
  name: string,
  documentName: string,
  version: number,
  projectName: string,
  requiresAck: boolean,
  // Where the button goes. For a Team Portal share this is the portal's
  // Shared with me page, which needs a portal sign-in: an emailed portal share
  // stays a portal share, so forwarding the email gives nobody the file
  // (Dean, 2026-10-20). Falls back to the dashboard when not provided.
  openUrl?: string,
) {
  // Acknowledgment-required documents use a dedicated, stronger template.
  if (requiresAck) {
    return sendAcknowledgmentRequestEmail(to, name, documentName, version, projectName, openUrl);
  }
  const link = openUrl ?? `${APP_URL}/dashboard`;
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const docName = documentName?.trim() || "A document";
  return send({
    to,
    subject: `New document: ${docName} (v${version}) · ${project}`,
    html: layout(`
      ${h("New document shared with you")}
      ${p(`Hi ${greeting},`)}
      ${p(`A new document has been added to <strong>${project}</strong> and shared with you.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${docName}</div>
        <div style="font-size:13px;color:#6b7280;">Version ${version} &middot; ${project}</div>
      `)}
      ${btn(link, "Open in the Team Portal")}
      ${muted("You'll need to sign in to the Team Portal to open it. You're getting this email because the person who shared it chose to email it as well.")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`New document shared with you

Hi ${greeting},

A new document has been added to ${project} and shared with you.

${docName}
Version ${version} · ${project}

Open it in the Team Portal (you'll need to sign in):
${link}

You're getting this email because the person who shared it chose to email it as well.${SETTINGS_LINE_TEXT}`),
  });
}

// New document that REQUIRES the recipient to acknowledge / sign off.
export async function sendAcknowledgmentRequestEmail(
  to: string,
  name: string,
  documentName: string,
  version: number,
  projectName: string,
  openUrl?: string,
) {
  const link = openUrl ?? `${APP_URL}/dashboard`;
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const docName = documentName?.trim() || "A document";
  return send({
    to,
    subject: `Action required: acknowledge ${docName} (v${version}) · ${project}`,
    html: layout(`
      ${h("Your acknowledgment is required")}
      ${p(`Hi ${greeting},`)}
      ${p(`A document on <strong>${project}</strong> has been shared with you and requires your acknowledgment before you continue work.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${docName}</div>
        <div style="font-size:13px;color:#6b7280;">Version ${version} &middot; ${project}</div>
      `)}
      ${box(
        `<span style="color:#9a3412;font-size:14px;font-weight:600;">⚠️ Please review and acknowledge this document as soon as possible.</span>`,
        "#fff7ed",
        "#fed7aa",
      )}
      ${btn(link, "Review &amp; acknowledge")}
      ${muted("You'll need to sign in to the Team Portal to open it. Acknowledging confirms you have read and understood the document. You're getting this email because the person who shared it chose to email it as well.")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`Your acknowledgment is required

Hi ${greeting},

A document on ${project} has been shared with you and requires your acknowledgment before you continue work.

${docName}
Version ${version} · ${project}

⚠️ Please review and acknowledge this document as soon as possible.

Review and acknowledge in the Team Portal (you'll need to sign in):
${link}

Acknowledging confirms you have read and understood the document. You're getting this email because the person who shared it chose to email it as well.${SETTINGS_LINE_TEXT}`),
  });
}

export async function sendNewMessageEmail(
  to: string,
  recipientName: string,
  senderName: string,
  preview: string,
  isChannel: boolean,
  contextName: string,
  // App path the button opens, e.g. "/portal/messages?c=channel". The caller
  // picks the place THIS recipient can sign in to: a portal-only member has
  // no dashboard account, so the dashboard /messages page is a dead end for
  // them (Dean, 2026-10-20). Defaults to the dashboard Messages page.
  path = "/messages",
) {
  const link = `${APP_URL}${path}`;
  const greeting = firstName(recipientName);
  const sender = senderName?.trim() || "A teammate";
  const subject = isChannel
    ? `New message in #${contextName} from ${sender}`
    : `New message from ${sender}`;
  const context = isChannel
    ? `in the <strong>#${contextName}</strong> project channel`
    : "in your direct messages";
  const contextText = isChannel
    ? `in the #${contextName} project channel`
    : "in your direct messages";
  return send({
    to,
    subject,
    html: layout(`
      ${h(`New message from ${sender}`)}
      ${p(`Hi ${greeting},`)}
      ${p(`You have a new message ${context}.`)}
      ${preview ? box(`<div style="font-size:15px;color:#374151;font-style:italic;">"${preview}"</div>`) : ""}
      ${btn(link, "View Message")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`New message from ${sender}

Hi ${greeting},

You have a new message ${contextText}.
${preview ? `\n"${preview}"\n` : ""}
View the message:
${link}${SETTINGS_LINE_TEXT}`),
  });
}

export async function sendPermitExpiryEmail(
  to: string,
  name: string,
  permitType: string,
  description: string,
  projectName: string,
  daysLeft: number,
  ref?: EmailRef,
) {
  const link = `${APP_URL}/compliance`;
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const type = permitType?.trim() || "Permit";
  const desc = description?.trim() || "No description provided.";
  const expired = daysLeft <= 0;
  const dayLabel = `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? "s" : ""}`;
  const urgent = expired || daysLeft <= 7;
  const subject = expired
    ? `🚨 Permit expired · ${project}`
    : `${daysLeft <= 7 ? "🚨 Urgent:" : "⚠️"} Permit expiring in ${dayLabel} · ${project}`;
  const lead = expired
    ? (daysLeft === 0
        ? `A permit you are responsible for on <strong>${project}</strong> expires <strong>today</strong>.`
        : `A permit you are responsible for on <strong>${project}</strong> expired <strong>${dayLabel} ago</strong>.`)
    : `A permit you are responsible for on <strong>${project}</strong> expires in <strong>${dayLabel}</strong>.`;
  const leadText = expired
    ? (daysLeft === 0
        ? `A permit you are responsible for on ${project} expires today.`
        : `A permit you are responsible for on ${project} expired ${dayLabel} ago.`)
    : `A permit you are responsible for on ${project} expires in ${dayLabel}.`;
  return send({
    ref,
    to,
    subject,
    html: layout(`
      ${h(`Permit ${expired ? "expired" : "expiring soon"} · ${project}`)}
      ${p(`Hi ${greeting},`)}
      ${p(lead + " Please renew it to keep this project compliant.")}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;text-transform:capitalize;">${type}</div>
        <div style="font-size:13px;color:#6b7280;">${desc}</div>
      `, urgent ? "#fef2f2" : "#fff7ed", urgent ? "#fecaca" : "#fed7aa")}
      ${btn(link, "View Compliance")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`Permit ${expired ? "expired" : "expiring soon"} · ${project}

Hi ${greeting},

${leadText} Please renew it to keep this project compliant.

${type}
${desc}

View compliance:
${link}${SETTINGS_LINE_TEXT}`),
  });
}

// Subcontractor insurance certificate approaching its expiry date.
export async function sendInsuranceExpiryEmail(
  to: string,
  name: string,
  insuranceType: string,
  subcontractorName: string,
  daysLeft: number,
  ref?: EmailRef,
) {
  const link = `${APP_URL}/compliance`;
  const greeting = firstName(name);
  const type = insuranceType?.trim() || "Insurance";
  const sub = subcontractorName?.trim() || "a subcontractor";
  const expired = daysLeft <= 0;
  const dayLabel = `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? "s" : ""}`;
  const subject = expired
    ? `🚨 Insurance expired for ${sub}`
    : `${daysLeft <= 7 ? "🚨 Urgent:" : "⚠️"} Insurance expiring in ${dayLabel} · ${sub}`;
  const lead = expired
    ? `An insurance certificate for <strong>${sub}</strong> expired ${dayLabel} ago.`
    : `An insurance certificate for <strong>${sub}</strong> expires in <strong>${dayLabel}</strong>.`;
  const leadText = expired
    ? `An insurance certificate for ${sub} expired ${dayLabel} ago.`
    : `An insurance certificate for ${sub} expires in ${dayLabel}.`;
  const urgent = expired || daysLeft <= 7;
  return send({
    ref,
    to,
    subject,
    html: layout(`
      ${h(`Insurance ${expired ? "expired" : "expiring soon"}`)}
      ${p(`Hi ${greeting},`)}
      ${p(lead + " Please request an updated certificate to keep this subcontractor compliant.")}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;text-transform:capitalize;">${type}</div>
        <div style="font-size:13px;color:#6b7280;">${sub}</div>
      `, urgent ? "#fef2f2" : "#fff7ed", urgent ? "#fecaca" : "#fed7aa")}
      ${btn(link, "View Compliance")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`Insurance ${expired ? "expired" : "expiring soon"}

Hi ${greeting},

${leadText} Please request an updated certificate to keep this subcontractor compliant.

${type}
${sub}

View compliance:
${link}${SETTINGS_LINE_TEXT}`),
  });
}

export async function sendPersonCertExpiryEmail(
  to: string,
  name: string,
  certName: string,
  personName: string,
  daysLeft: number,
  ref?: EmailRef,
) {
  const link = `${APP_URL}/compliance`;
  const greeting = firstName(name);
  const cert = certName?.trim() || "Certification";
  const person = personName?.trim() || "a team member";
  const expired = daysLeft <= 0;
  const dayLabel = `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? "s" : ""}`;
  const subject = expired
    ? `🚨 Certification expired for ${person}`
    : `${daysLeft <= 7 ? "🚨 Urgent:" : "⚠️"} Certification expiring in ${dayLabel} · ${person}`;
  const lead = expired
    ? `A certification for <strong>${person}</strong> expired ${dayLabel} ago.`
    : `A certification for <strong>${person}</strong> expires in <strong>${dayLabel}</strong>.`;
  const leadText = expired
    ? `A certification for ${person} expired ${dayLabel} ago.`
    : `A certification for ${person} expires in ${dayLabel}.`;
  const urgent = expired || daysLeft <= 7;
  return send({
    ref,
    to,
    subject,
    html: layout(`
      ${h(`Certification ${expired ? "expired" : "expiring soon"}`)}
      ${p(`Hi ${greeting},`)}
      ${p(lead + " Please arrange a renewal to keep this person's certification current.")}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${cert}</div>
        <div style="font-size:13px;color:#6b7280;">${person}</div>
      `, urgent ? "#fef2f2" : "#fff7ed", urgent ? "#fecaca" : "#fed7aa")}
      ${btn(link, "View Compliance")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`Certification ${expired ? "expired" : "expiring soon"}

Hi ${greeting},

${leadText} Please arrange a renewal to keep this person's certification current.

${cert}
${person}

View compliance:
${link}${SETTINGS_LINE_TEXT}`),
  });
}

export async function sendSafetyAlertEmail(
  to: string,
  name: string,
  category: string,
  referenceNumber: string,
  projectName: string,
) {
  const label = category === "safety_concern" ? "Safety Concern" : "Snag";
  const link = `${APP_URL}/dashboard`;
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const ref = referenceNumber?.trim() || "N/A";
  return send({
    to,
    subject: `⚠️ ${label} logged · Ref: ${ref} · ${project}`,
    html: layout(`
      ${h(`⚠️ ${label} logged · ${project}`)}
      ${p(`Hi ${greeting},`)}
      ${p(`A ${label.toLowerCase()} has been logged on <strong>${project}</strong> and requires your review.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">Ref: ${ref}</div>
        <div style="font-size:13px;color:#6b7280;">${label} &middot; ${project}</div>
      `, "#fef2f2", "#fecaca")}
      ${btn(link, "Review on SiteSort")}
      ${muted("Safety alerts are always sent, even if you've turned email notifications off, so a site issue always reaches the project's managers.")}
    `),
    text: textLayout(`${label} logged · ${project}

Hi ${greeting},

A ${label.toLowerCase()} has been logged on ${project} and requires your review.

Ref: ${ref}
${label} · ${project}

Review on SiteSort:
${link}

Safety alerts are always sent, even if you've turned email notifications off, so a site issue always reaches the project's managers.`),
  });
}

const ROLE_LABEL: Record<string, string> = { worker: "Site worker", manager: "Manager", subcontractor: "Subcontractor" };

// Team Portal invite — sent from the invites@ address. Returns the Resend result
// so the caller can record delivery state on the invite. Never called directly by
// business logic (goes through lib/invite-email.ts).
export async function sendPortalInviteEmail(params: {
  to: string;
  name: string;
  inviterName: string;
  companyName: string;
  projectName: string;
  role: string;
  inviteUrl: string;
  ref?: EmailRef;
}) {
  const greeting = firstName(params.name);
  const inviter = params.inviterName?.trim() || "Your project manager";
  const company = params.companyName?.trim() || "their company";
  const project = params.projectName?.trim() || "a project";
  const roleLabel = ROLE_LABEL[params.role] ?? "Site worker";
  const portalUrl = `${APP_URL}/portal/login`;
  const guideUrl = `${APP_URL}/guide`;
  return send({
    ref: params.ref,
    from: INVITE_FROM,
    to: params.to,
    subject: `${inviter} invited you to ${project} on SiteSort`,
    html: layout(`
      ${h("You've been invited to a project portal")}
      ${p(`Hi ${greeting},`)}
      ${p(`<strong>${inviter}</strong> (${company}) has invited you to the <strong>${project}</strong> site portal on SiteSort, where you can view the drawings, documents and site information shared with you.`)}
      ${box(`
        <div style="font-size:14px;color:#374151;margin-bottom:4px;">Project: <strong>${project}</strong></div>
        <div style="font-size:14px;color:#374151;">Your role: <strong>${roleLabel}</strong></div>
      `)}
      ${btn(params.inviteUrl, "Set up your portal access")}
      ${muted(`This invite link expires in 7 days. Button not working? Copy and paste this link:<br><a href="${params.inviteUrl}" style="color:#ea580c;word-break:break-all;">${params.inviteUrl}</a>`)}
      ${muted(`Once you're set up, bookmark your portal to sign back in any time:<br><a href="${portalUrl}" style="color:#ea580c;word-break:break-all;">${portalUrl}</a>`)}
      ${h("Getting started")}
      ${guideExcerptItemsHtml()}
      ${p(`<a href="${guideUrl}" style="color:#ea580c;">Read the full guide</a>. No login needed.`)}
    `),
    text: textLayout(`You've been invited to a project portal

Hi ${greeting},

${inviter} (${company}) has invited you to the ${project} site portal on SiteSort, where you can view the drawings, documents and site information shared with you.

Project: ${project}
Your role: ${roleLabel}

Set up your portal access:
${params.inviteUrl}

This invite link expires in 7 days.

Once you're set up, bookmark your portal to sign back in any time:
${portalUrl}

Getting started:
${guideExcerptItemsText()}

Read the full guide (no login needed):
${guideUrl}`),
  });
}

// #127 Part B: per-share links. Text here can include names typed by someone
// outside SiteSort (an access request), so it's escaped before going into HTML.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// An approved access request: the requester gets a fresh link to the item's
// current revision.
export async function sendShareLinkGrantedEmail(params: {
  to: string; name: string; itemName: string; revisionLabel: string | null;
  projectName: string; companyName: string; url: string; expiresAt: Date; newerThanRequested: boolean;
}) {
  const greeting = esc(firstName(params.name));
  const item = esc(params.itemName);
  const rev = params.revisionLabel ? esc(params.revisionLabel) : "";
  const company = esc(params.companyName);
  const project = esc(params.projectName);
  const until = params.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const newer = params.newerThanRequested ? "The one you asked for has been replaced, so this is the current revision." : "";
  return send({
    to: params.to,
    subject: `Access granted: ${params.itemName}${params.revisionLabel ? ` (${params.revisionLabel})` : ""}`,
    html: layout(`
      ${h("Your access request was approved")}
      ${p(`Hi ${greeting},`)}
      ${p(`${company} has shared this with you from <strong>${project}</strong>.${newer ? ` ${newer}` : ""}`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${item}</div>
        ${rev ? `<div style="font-size:13px;color:#6b7280;">${rev}</div>` : ""}
      `)}
      ${btn(params.url, "Open it")}
      ${muted(`This link works until ${until}, or until a newer revision replaces it.`)}
    `),
    text: textLayout(`Your access request was approved

Hi ${firstName(params.name)},

${params.companyName} has shared this with you from ${params.projectName}.${newer ? ` ${newer}` : ""}

${params.itemName}${params.revisionLabel ? `\n${params.revisionLabel}` : ""}

Open it:
${params.url}

This link works until ${until}, or until a newer revision replaces it.`),
  });
}

// Three days before a link someone sent stops working.
export async function sendShareLinkExpiringEmail(params: {
  to: string; name: string; itemName: string; revisionLabel: string | null; projectName: string;
  recipientInfo: string | null; expiresAt: Date; projectId: string; itemType: string; itemId: string;
}) {
  const until = params.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const tab = params.itemType === "permit" ? "permits" : "documents";
  const link = `${APP_URL}/projects/${params.projectId}?tab=${tab}&${params.itemType}=${params.itemId}`;
  const who = params.recipientInfo ? ` to ${params.recipientInfo}` : "";
  return send({
    to: params.to,
    subject: `Shared link expires ${until}: ${params.itemName}`,
    html: layout(`
      ${h("A link you shared expires soon")}
      ${p(`Hi ${esc(firstName(params.name))},`)}
      ${p(`The link you sent${esc(who)} stops working on <strong>${until}</strong>.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${esc(params.itemName)}</div>
        <div style="font-size:13px;color:#6b7280;">${[params.revisionLabel, params.projectName].filter(Boolean).map(s => esc(s!)).join(" &middot; ")}</div>
      `)}
      ${p("If they still need it, share it again from SiteSort.")}
      ${btn(link, "Open in SiteSort")}
      ${SETTINGS_LINE_HTML}
    `),
    text: textLayout(`A link you shared expires soon

Hi ${firstName(params.name)},

The link you sent${who} stops working on ${until}.

${params.itemName}
${[params.revisionLabel, params.projectName].filter(Boolean).join(" · ")}

If they still need it, share it again from SiteSort:
${link}${SETTINGS_LINE_TEXT}`),
  });
}

// Operational alert to the owner (database down/back). Plain and short; it
// must not touch the database, which may be the thing that is down.
export async function sendOpsAlertEmail(to: string, subject: string, lines: string[]): Promise<string | undefined> {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const result = await send({
    noLog: true,
    to,
    subject,
    text: lines.join("\n\n"),
    html: layout(lines.map(l => `<p style="margin:0 0 12px;font-size:14px;color:#111827;">${esc(l)}</p>`).join("")),
  });
  return result.data?.id;
}

export { APP_URL as EMAIL_APP_URL };
