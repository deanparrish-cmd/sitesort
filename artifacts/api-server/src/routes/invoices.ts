import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { invoicesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get("/invoices", authenticate, async (req, res) => {
  try {
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.companyId, req.user!.companyId));
    res.json(invoices);
  } catch (err) {
    req.log.error({ err }, "List invoices error");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/projects/:projectId/invoices", authenticate, async (req, res) => {
  try {
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.companyId, req.user!.companyId),
        eq(invoicesTable.projectId, req.params.projectId),
      ));
    res.json(invoices);
  } catch (err) {
    req.log.error({ err }, "List project invoices error");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/invoices", authenticate, async (req, res) => {
  try {
    const { direction, counterpartyName, description, amount, currency, dueDate, reference, projectId } = req.body;
    if (!direction || !counterpartyName || !description || !amount || !dueDate) {
      res.status(400).json({ error: "validation_error", message: "Missing required fields" });
      return;
    }
    const [invoice] = await db.insert(invoicesTable).values({
      id: randomUUID(),
      companyId: req.user!.companyId,
      createdBy: req.user!.id,
      projectId: projectId ?? null,
      direction,
      counterpartyName,
      description,
      amount: String(amount),
      currency: currency ?? "GBP",
      dueDate,
      reference: reference ?? null,
      status: "pending",
    }).returning();
    res.status(201).json(invoice);
  } catch (err) {
    req.log.error({ err }, "Create invoice error");
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/invoices/:id", authenticate, async (req, res) => {
  try {
    const { status, attachmentUrl } = req.body;
    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (attachmentUrl !== undefined) updates.attachmentUrl = attachmentUrl;
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "validation_error", message: "Nothing to update" }); return; }
    const [updated] = await db
      .update(invoicesTable)
      .set(updates)
      .where(and(eq(invoicesTable.id, req.params.id), eq(invoicesTable.companyId, req.user!.companyId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "not_found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update invoice error");
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/invoices/:id", authenticate, async (req, res) => {
  try {
    const [deleted] = await db
      .delete(invoicesTable)
      .where(and(eq(invoicesTable.id, req.params.id), eq(invoicesTable.companyId, req.user!.companyId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "not_found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete invoice error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
