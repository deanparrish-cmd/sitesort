import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { allow, ANY_MEMBER } from "../lib/authz";

const router: IRouter = Router();

// The bell shows only the company the user is signed into, whatever their
// role in any other company (2026-10-19). Rows with no company never match.
const mine = (req: { user?: { id: string; companyId: string } }) =>
  and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.companyId, req.user!.companyId));

router.get("/notifications", authenticate, allow(ANY_MEMBER), async (req, res) => {
  try {
    const notifications = await db.select().from(notificationsTable)
      .where(mine(req))
      .orderBy(notificationsTable.createdAt);

    res.json(notifications.map(n => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId ?? null,
      relatedEntityType: n.relatedEntityType ?? null,
      metadata: n.metadata ?? null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })).reverse());
  } catch (err) {
    req.log.error({ err }, "List notifications error");
    res.status(500).json({ error: "server_error", message: "Failed to list notifications" });
  }
});

router.patch("/notifications/:notificationId/read", authenticate, allow(ANY_MEMBER), async (req, res) => {
  try {
    await db.update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, req.params.notificationId), mine(req)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Mark notification read error");
    res.status(500).json({ error: "server_error", message: "Failed to mark notification as read" });
  }
});

router.patch("/notifications/read-all", authenticate, allow(ANY_MEMBER), async (req, res) => {
  try {
    await db.update(notificationsTable)
      .set({ read: true })
      .where(mine(req));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Mark all read error");
    res.status(500).json({ error: "server_error", message: "Failed to mark all notifications as read" });
  }
});

export default router;
