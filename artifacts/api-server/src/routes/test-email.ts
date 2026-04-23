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

  const { data, error } = await resend.emails.send({
    from: "SiteSort <noreply@mail.sitesort.co.uk>",
    to: "amy-parrish@hotmail.co.uk",
    subject: "🎉 Your email is working!",
    text: "If you're reading this, your Resend API is set up correctly. You can now send emails from your app!",
  });

  if (error) {
    console.error("Resend error:", JSON.stringify(error, null, 2));
    res.status(500).json({ error: error.message, details: error });
    return;
  }
  console.log("Resend success:", data);

  res.json({ success: true });
});

export default router;
