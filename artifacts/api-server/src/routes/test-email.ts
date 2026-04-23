import { Router } from "express";
import { Resend } from "resend";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.post("/test-email", authenticate, async (req, res) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "RESEND_API_KEY is not set" });
    return;
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "SiteSort <noreply@sitesort.co.uk>",
    to: req.user!.email,
    subject: "SiteSort email is working",
    text: "Your Resend integration with sitesort.co.uk is configured correctly. Emails will be sent from noreply@sitesort.co.uk.",
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true, sentTo: req.user!.email });
});

export default router;
