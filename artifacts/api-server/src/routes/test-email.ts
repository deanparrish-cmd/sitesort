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
    from: "onboarding@resend.dev",
    to: "amy-parrish@hotmail.co.uk",
    subject: "🎉 Your email is working!",
    text: "If you're reading this, your Resend API is set up correctly. You can now send emails from your app!",
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});

export default router;
