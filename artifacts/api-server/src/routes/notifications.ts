import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/notifications", authenticate, async (req, res) => {
  try {
    const notifications = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.userId, req.user!.id))
      .orderBy(notificationsTable.createdAt);

    res.json(notifications.map(n => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId ?? null,
      relatedEntityType: n.relatedEntityType ?? null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })).reverse());
  } catch (err) {
    req.log.error({ err }, "List notifications error");
    res.status(500).json({ error: "server_error", message: "Failed to list notifications" });
  }
});

router.patch("/notifications/:notificationId/read", authenticate, async (req, res) => {
  try {
    await db.update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, req.params.notificationId), eq(notificationsTable.userId, req.user!.id)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Mark notification read error");
    res.status(500).json({ error: "server_error", message: "Failed to mark notification as read" });
  }
});

router.patch("/notifications/read-all", authenticate, async (req, res) => {
  try {
    await db.update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.userId, req.user!.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Mark all read error");
    res.status(500).json({ error: "server_error", message: "Failed to mark all notifications as read" });
  }
});

export default router;
