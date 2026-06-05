import { Resend } from "resend";

const FROM = "SiteSort <noreply@mail.sitesort.co.uk>";
const APP_URL = process.env.APP_URL ?? "https://sitesort.co.uk";

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

function layout(body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;"><tr><td align="center">
<table cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:600px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#9a3412 0%,#ea580c 50%,#f97316 100%);padding:32px 40px;">
  <div style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">SiteSort</div>
  <div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:4px;">Construction Site Information Management</div>
</td></tr>
<tr><td style="padding:40px;">${body}</td></tr>
<tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
  <p style="color:#9ca3af;font-size:12px;margin:0;">SiteSort &middot; <a href="https://sitesort.co.uk" style="color:#ea580c;text-decoration:none;">sitesort.co.uk</a><br>This is an automated message — please do not reply.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const btn = (href: string, label: string) =>
  `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#ea580c" style="background-color:#ea580c;border-radius:8px;">
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

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  return resend().emails.send({
    from: FROM,
    to,
    subject: "Verify your SiteSort email address",
    html: layout(`
      ${h(`Welcome to SiteSort, ${name}!`)}
      ${p("Thanks for registering. Please verify your email address to activate your account.")}
      ${btn(link, "Verify Email Address")}
      ${muted(`Link expires in 24 hours. If you didn't create a SiteSort account, please ignore this email.<br>Or copy: <a href="${link}" style="color:#ea580c;">${link}</a>`)}
    `),
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  return resend().emails.send({
    from: FROM,
    to,
    subject: "Reset your SiteSort password",
    html: layout(`
      ${h("Password reset requested")}
      ${p(`Hi ${name},`)}
      ${p("We received a request to reset the password on your SiteSort account. Click the button below to choose a new password.")}
      ${btn(link, "Reset Password")}
      ${muted(`Link expires in 1 hour. If you didn't request this, your account is safe — just ignore this email.<br>Or copy: <a href="${link}" style="color:#ea580c;">${link}</a>`)}
    `),
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
  return resend().emails.send({
    from: FROM,
    to,
    subject: `You've been added to ${companyName} on SiteSort`,
    html: layout(`
      ${h(`Hi ${name}, you've been invited to SiteSort`)}
      ${p(`${inviterName} has added you to the <strong>${companyName}</strong> workspace on SiteSort — a construction site information management platform.`)}
      ${box(`
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Your login credentials</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;">Email: <strong>${to}</strong></div>
        <div style="font-size:14px;color:#374151;">Temporary password: <strong style="font-family:monospace;background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #d1d5db;">${tempPassword}</strong></div>
      `)}
      ${btn(loginLink, "Log in to SiteSort")}
      ${muted("Please change your password after your first login for security.")}
    `),
  });
}

export async function sendDocumentNotificationEmail(
  to: string,
  name: string,
  documentName: string,
  version: number,
  projectName: string,
  requiresAck: boolean,
) {
  const link = `${APP_URL}/dashboard`;
  const ackBanner = requiresAck
    ? box(
        `<span style="color:#9a3412;font-size:14px;font-weight:600;">⚠️ This document requires your acknowledgment.</span>`,
        "#fff7ed",
        "#fed7aa",
      )
    : "";
  return resend().emails.send({
    from: FROM,
    to,
    subject: `New document: ${documentName} (v${version}) — ${projectName}`,
    html: layout(`
      ${h("New document uploaded")}
      ${p(`Hi ${name},`)}
      ${p(`A new document has been added to <strong>${projectName}</strong> and requires your attention.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${documentName}</div>
        <div style="font-size:13px;color:#6b7280;">Version ${version} &middot; ${projectName}</div>
      `)}
      ${ackBanner}
      ${btn(link, "View on SiteSort")}
    `),
  });
}

export async function sendNewMessageEmail(
  to: string,
  recipientName: string,
  senderName: string,
  preview: string,
  isChannel: boolean,
  contextName: string,
) {
  const link = `${APP_URL}/messages`;
  const subject = isChannel
    ? `New message in #${contextName} from ${senderName}`
    : `New message from ${senderName}`;
  const context = isChannel
    ? `in the <strong>#${contextName}</strong> project channel`
    : "in your direct messages";
  return resend().emails.send({
    from: FROM,
    to,
    subject,
    html: layout(`
      ${h(`New message from ${senderName}`)}
      ${p(`Hi ${recipientName},`)}
      ${p(`You have a new message ${context}.`)}
      ${preview ? box(`<div style="font-size:15px;color:#374151;font-style:italic;">"${preview}"</div>`) : ""}
      ${btn(link, "View Message")}
      ${muted("You can manage email notifications in your SiteSort account settings.")}
    `),
  });
}

export async function sendPermitExpiryEmail(
  to: string,
  name: string,
  permitType: string,
  description: string,
  projectName: string,
  daysLeft: number,
) {
  const link = `${APP_URL}/compliance`;
  const urgency = daysLeft <= 3 ? "🚨 Urgent:" : "⚠️";
  return resend().emails.send({
    from: FROM,
    to,
    subject: `${urgency} Permit expiring in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — ${projectName}`,
    html: layout(`
      ${h(`Permit expiring soon — ${projectName}`)}
      ${p(`Hi ${name},`)}
      ${p(`A permit you are responsible for on <strong>${projectName}</strong> expires in <strong>${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong>.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;text-transform:capitalize;">${permitType}</div>
        <div style="font-size:13px;color:#6b7280;">${description}</div>
      `, daysLeft <= 3 ? "#fef2f2" : "#fff7ed", daysLeft <= 3 ? "#fecaca" : "#fed7aa")}
      ${btn(link, "View Compliance")}
      ${muted("You can manage email notifications in your SiteSort account settings.")}
    `),
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
  return resend().emails.send({
    from: FROM,
    to,
    subject: `⚠️ ${label} logged — Ref: ${referenceNumber} · ${projectName}`,
    html: layout(`
      ${h(`⚠️ ${label} logged — ${projectName}`)}
      ${p(`Hi ${name},`)}
      ${p(`A ${label.toLowerCase()} has been logged on <strong>${projectName}</strong> and requires your review.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">Ref: ${referenceNumber}</div>
        <div style="font-size:13px;color:#6b7280;">${label} &middot; ${projectName}</div>
      `, "#fef2f2", "#fecaca")}
      ${btn(link, "Review on SiteSort")}
    `),
  });
}
