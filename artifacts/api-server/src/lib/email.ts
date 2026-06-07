import { Resend } from "resend";

const FROM = "SiteSort <noreply@mail.sitesort.co.uk>";
const REPLY_TO = "SiteSort Support <support@sitesort.co.uk>";
const SUPPORT_EMAIL = "support@sitesort.co.uk";
const APP_URL = process.env.APP_URL ?? "https://www.sitesort.co.uk";

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

// Centralised sender so every transactional email shares the same
// "from" name and a SiteSort reply-to address.
function send(opts: { to: string; subject: string; html: string; text: string }) {
  return resend().emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
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
  return `SiteSort — Construction Site Information Management
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

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  const greeting = firstName(name);
  return send({
    to,
    subject: "Reset your SiteSort password",
    html: layout(`
      ${h("Password reset requested")}
      ${p(`Hi ${greeting},`)}
      ${p("We received a request to reset the password on your SiteSort account. Click the button below to choose a new password.")}
      ${btn(link, "Reset Password")}
      ${muted(`This link expires in 1 hour. If you didn't request this, your account is safe — just ignore this email.<br>Button not working? Copy and paste this link:<br><a href="${link}" style="color:#ea580c;word-break:break-all;">${link}</a>`)}
    `),
    text: textLayout(`Password reset requested

Hi ${greeting},

We received a request to reset the password on your SiteSort account. Use the link below to choose a new password.

Reset your password:
${link}

This link expires in 1 hour. If you didn't request this, your account is safe — just ignore this email.`),
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
      ${p(`${inviter} has added you to the <strong>${company}</strong> workspace on SiteSort — a construction site information management platform.`)}
      ${box(`
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Your login credentials</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;">Email: <strong>${to}</strong></div>
        <div style="font-size:14px;color:#374151;">Temporary password: <strong style="font-family:monospace;background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #d1d5db;">${tempPassword}</strong></div>
      `)}
      ${btn(loginLink, "Log in to SiteSort")}
      ${muted("For your security, please change your password after your first login.")}
    `),
    text: textLayout(`Hi ${greeting}, you've been invited to SiteSort

${inviter} has added you to the ${company} workspace on SiteSort — a construction site information management platform.

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
) {
  // Acknowledgment-required documents use a dedicated, stronger template.
  if (requiresAck) {
    return sendAcknowledgmentRequestEmail(to, name, documentName, version, projectName);
  }
  const link = `${APP_URL}/dashboard`;
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const docName = documentName?.trim() || "A document";
  return send({
    to,
    subject: `New document: ${docName} (v${version}) — ${project}`,
    html: layout(`
      ${h("New document shared with you")}
      ${p(`Hi ${greeting},`)}
      ${p(`A new document has been added to <strong>${project}</strong> and shared with you.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">${docName}</div>
        <div style="font-size:13px;color:#6b7280;">Version ${version} &middot; ${project}</div>
      `)}
      ${btn(link, "View on SiteSort")}
      ${muted("You can manage email notifications in your SiteSort account settings.")}
    `),
    text: textLayout(`New document shared with you

Hi ${greeting},

A new document has been added to ${project} and shared with you.

${docName}
Version ${version} · ${project}

View it on SiteSort:
${link}

You can manage email notifications in your SiteSort account settings.`),
  });
}

// New document that REQUIRES the recipient to acknowledge / sign off.
export async function sendAcknowledgmentRequestEmail(
  to: string,
  name: string,
  documentName: string,
  version: number,
  projectName: string,
) {
  const link = `${APP_URL}/dashboard`;
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const docName = documentName?.trim() || "A document";
  return send({
    to,
    subject: `Action required: acknowledge ${docName} (v${version}) — ${project}`,
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
      ${muted("Acknowledging confirms you have read and understood the document. You can manage email notifications in your SiteSort account settings.")}
    `),
    text: textLayout(`Your acknowledgment is required

Hi ${greeting},

A document on ${project} has been shared with you and requires your acknowledgment before you continue work.

${docName}
Version ${version} · ${project}

⚠️ Please review and acknowledge this document as soon as possible.

Review and acknowledge:
${link}

Acknowledging confirms you have read and understood the document.`),
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
      ${muted("You can manage email notifications in your SiteSort account settings.")}
    `),
    text: textLayout(`New message from ${sender}

Hi ${greeting},

You have a new message ${contextText}.
${preview ? `\n"${preview}"\n` : ""}
View the message:
${link}

You can manage email notifications in your SiteSort account settings.`),
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
  const greeting = firstName(name);
  const project = projectName?.trim() || "your project";
  const type = permitType?.trim() || "Permit";
  const desc = description?.trim() || "No description provided.";
  const dayLabel = `${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
  const urgency = daysLeft <= 3 ? "🚨 Urgent:" : "⚠️";
  return send({
    to,
    subject: `${urgency} Permit expiring in ${dayLabel} — ${project}`,
    html: layout(`
      ${h(`Permit expiring soon — ${project}`)}
      ${p(`Hi ${greeting},`)}
      ${p(`A permit you are responsible for on <strong>${project}</strong> expires in <strong>${dayLabel}</strong>.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;text-transform:capitalize;">${type}</div>
        <div style="font-size:13px;color:#6b7280;">${desc}</div>
      `, daysLeft <= 3 ? "#fef2f2" : "#fff7ed", daysLeft <= 3 ? "#fecaca" : "#fed7aa")}
      ${btn(link, "View Compliance")}
      ${muted("You can manage email notifications in your SiteSort account settings.")}
    `),
    text: textLayout(`Permit expiring soon — ${project}

Hi ${greeting},

A permit you are responsible for on ${project} expires in ${dayLabel}.

${type}
${desc}

View compliance:
${link}

You can manage email notifications in your SiteSort account settings.`),
  });
}

// Subcontractor insurance certificate approaching its expiry date.
export async function sendInsuranceExpiryEmail(
  to: string,
  name: string,
  insuranceType: string,
  subcontractorName: string,
  daysLeft: number,
) {
  const link = `${APP_URL}/compliance`;
  const greeting = firstName(name);
  const type = insuranceType?.trim() || "Insurance";
  const sub = subcontractorName?.trim() || "a subcontractor";
  const expired = daysLeft <= 0;
  const dayLabel = `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? "s" : ""}`;
  const subject = expired
    ? `🚨 Insurance expired for ${sub}`
    : `${daysLeft <= 7 ? "🚨 Urgent:" : "⚠️"} Insurance expiring in ${dayLabel} — ${sub}`;
  const lead = expired
    ? `An insurance certificate for <strong>${sub}</strong> expired ${dayLabel} ago.`
    : `An insurance certificate for <strong>${sub}</strong> expires in <strong>${dayLabel}</strong>.`;
  const leadText = expired
    ? `An insurance certificate for ${sub} expired ${dayLabel} ago.`
    : `An insurance certificate for ${sub} expires in ${dayLabel}.`;
  const urgent = expired || daysLeft <= 7;
  return send({
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
      ${muted("You can manage email notifications in your SiteSort account settings.")}
    `),
    text: textLayout(`Insurance ${expired ? "expired" : "expiring soon"}

Hi ${greeting},

${leadText} Please request an updated certificate to keep this subcontractor compliant.

${type}
${sub}

View compliance:
${link}

You can manage email notifications in your SiteSort account settings.`),
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
    subject: `⚠️ ${label} logged — Ref: ${ref} · ${project}`,
    html: layout(`
      ${h(`⚠️ ${label} logged — ${project}`)}
      ${p(`Hi ${greeting},`)}
      ${p(`A ${label.toLowerCase()} has been logged on <strong>${project}</strong> and requires your review.`)}
      ${box(`
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">Ref: ${ref}</div>
        <div style="font-size:13px;color:#6b7280;">${label} &middot; ${project}</div>
      `, "#fef2f2", "#fecaca")}
      ${btn(link, "Review on SiteSort")}
    `),
    text: textLayout(`${label} logged — ${project}

Hi ${greeting},

A ${label.toLowerCase()} has been logged on ${project} and requires your review.

Ref: ${ref}
${label} · ${project}

Review on SiteSort:
${link}`),
  });
}
