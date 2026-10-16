import { Router, type IRouter } from "express";
import { authenticate } from "../middlewares/auth";
import { allow, PLATFORM_ADMIN } from "../lib/authz";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendInvitationEmail,
  sendDocumentNotificationEmail,
  sendAcknowledgmentRequestEmail,
  sendNewMessageEmail,
  sendPermitExpiryEmail,
  sendInsuranceExpiryEmail,
  sendSafetyAlertEmail,
} from "../lib/email";
import { notify } from "../lib/db-watchdog";
import { IS_DEPLOYED } from "../lib/environment";

const router: IRouter = Router();

// Send a finished, branded version of each transactional template to a test
// inbox so the design can be reviewed end-to-end. Send a single template with
// { "template": "welcome" } or every template with { "template": "all" }.
const TEMPLATES: Record<string, (to: string, name: string) => Promise<unknown>> = {
  verification: (to, name) => sendVerificationEmail(to, name, "test-verification-token-123"),
  password_reset: (to, name) => sendPasswordResetEmail(to, name, "test-reset-token-123"),
  welcome: (to, name) => sendWelcomeEmail(to, name),
  invitation: (to, name) => sendInvitationEmail(to, name, "Acme Construction", "Tmp4!pass", "Jordan Mills"),
  document: (to, name) => sendDocumentNotificationEmail(to, name, "Site Layout Plan", 2, "Riverside Tower", false),
  acknowledgment: (to, name) => sendAcknowledgmentRequestEmail(to, name, "Method Statement · Crane Lift", 3, "Riverside Tower"),
  message: (to, name) => sendNewMessageEmail(to, name, "Sam Carter", "Can you confirm the delivery slot for tomorrow?", true, "riverside-tower"),
  permit: (to, name) => sendPermitExpiryEmail(to, name, "hot works", "Welding permit for level 4 steelwork", "Riverside Tower", 1),
  insurance: (to, name) => sendInsuranceExpiryEmail(to, name, "public liability", "BuildRight Subcontractors Ltd", 7),
  safety: (to, name) => sendSafetyAlertEmail(to, name, "safety_concern", "SC-0042", "Riverside Tower"),
};

// Developer tool: SiteSort staff only, and only ever to their OWN address (#118).
// Before this any logged-in user could send any template to any address.
router.post("/test-email", authenticate, allow(PLATFORM_ADMIN), async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: "RESEND_API_KEY is not set" });
    return;
  }

  const template = String(req.body?.template ?? "welcome").toLowerCase();
  const to = req.user!.email;
  const name = (req.body?.name as string) || "Alex Taylor";

  const names = template === "all" ? Object.keys(TEMPLATES) : [template];
  const invalid = names.filter(n => !TEMPLATES[n]);
  if (invalid.length > 0) {
    res.status(400).json({
      error: "invalid_template",
      message: `Unknown template(s): ${invalid.join(", ")}`,
      available: ["all", ...Object.keys(TEMPLATES)],
    });
    return;
  }

  const results: Array<{ template: string; ok: boolean; error?: string }> = [];
  for (const n of names) {
    try {
      await TEMPLATES[n](to, name);
      results.push({ template: n, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err, template: n }, "Failed to send test email");
      results.push({ template: n, ok: false, error: message });
    }
  }

  const allOk = results.every(r => r.ok);
  res.status(allOk ? 200 : 500).json({ success: allOk, to, results });
});

// Sends one clearly-labelled test of the database-down alert to every
// OPS_ALERT_EMAIL address, through the same code path a real alert uses.
// Changes nothing else. Platform admins only. Outside the deployed app email
// is suppressed, so this says so instead of pretending it sent.
router.post("/admin/ops-alert-test", authenticate, allow(PLATFORM_ADMIN), async (req, res) => {
  if (!IS_DEPLOYED) {
    res.status(409).json({ error: "not_deployed", message: "Test alerts only send from the live app. Email is switched off here." });
    return;
  }
  const results = await notify("SiteSort TEST alert: nothing is wrong", [
    "This is a test of the database-down alert. The database is fine.",
    `Sent at ${new Date().toISOString()} by ${req.user!.email} from the Admin page.`,
    "If this landed in spam, mark it as not spam so a real alert reaches your inbox.",
  ]);
  if (results.length === 0) {
    res.status(409).json({ error: "no_recipients", message: "OPS_ALERT_EMAIL is not set in the Deployment secrets." });
    return;
  }
  const ok = results.every(r => r.ok);
  res.status(ok ? 200 : 502).json({ success: ok, results });
});

export default router;
