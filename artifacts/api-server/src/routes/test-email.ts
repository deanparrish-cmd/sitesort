import { Router, type IRouter } from "express";
import { authenticate } from "../middlewares/auth";
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
  acknowledgment: (to, name) => sendAcknowledgmentRequestEmail(to, name, "Method Statement — Crane Lift", 3, "Riverside Tower"),
  message: (to, name) => sendNewMessageEmail(to, name, "Sam Carter", "Can you confirm the delivery slot for tomorrow?", true, "riverside-tower"),
  permit: (to, name) => sendPermitExpiryEmail(to, name, "hot works", "Welding permit for level 4 steelwork", "Riverside Tower", 1),
  insurance: (to, name) => sendInsuranceExpiryEmail(to, name, "public liability", "BuildRight Subcontractors Ltd", 7),
  safety: (to, name) => sendSafetyAlertEmail(to, name, "safety_concern", "SC-0042", "Riverside Tower"),
};

router.post("/test-email", authenticate, async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: "RESEND_API_KEY is not set" });
    return;
  }

  const template = String(req.body?.template ?? "welcome").toLowerCase();
  const to = (req.body?.to as string) || req.user!.email;
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

export default router;
