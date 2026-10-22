import { Router, type IRouter } from "express";
import { PushReceiptBody } from "@workspace/api-zod";
import { recordReceipt } from "../lib/push-receipts";

const router: IRouter = Router();

// POST /api/push/receipt: sw.js reports that an alert reached the phone (and
// whether the notification was posted) or was tapped. No login: a service
// worker has no portal token. Always 200, so an unknown id tells a caller
// nothing; see recordReceipt for why that is safe.
router.post("/push/receipt", async (req, res) => {
  const parsed = PushReceiptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid receipt." }); return; }
  const { id, event, shown, permission } = parsed.data;
  try {
    await recordReceipt(id, event, shown ?? null, permission ?? null);
  } catch (err) {
    req.log.warn({ err }, "push receipt not recorded");
  }
  res.json({ success: true });
});

export default router;
