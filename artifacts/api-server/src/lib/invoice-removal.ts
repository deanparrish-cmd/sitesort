import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getBucket, objectKey } from "./gcs";
import { logger } from "./logger";

// The invoices feature was removed (bebe715) and its attachment links have
// answered 410 since #121. This finishes the job, once, at boot: delete every
// attached file from storage, then drop the table and the orphaned
// messages.invoice_id pointer. The table is dropped ONLY after every file is
// confirmed gone (or already missing), so a storage failure leaves everything
// as it was (links still 410) and the next boot tries again. Idempotent: once
// the table is gone this is a single no-op query.
export async function removeInvoices(
  deleteObject: (filename: string) => Promise<void> = f => getBucket().file(objectKey(f)).delete({ ignoreNotFound: true }).then(() => {}),
): Promise<{ files: number; rows: number } | null> {
  const present = await db.execute(sql`SELECT to_regclass('public.invoices') IS NOT NULL AS present`);
  if (!(present.rows[0] as { present?: boolean } | undefined)?.present) return null;

  const rows = (await db.execute(sql`SELECT id, attachment_url, to_jsonb(i) AS row FROM invoices i`)).rows as { id: string; attachment_url: string | null; row: unknown }[];
  // A record of exactly what is about to go, in the deployment log.
  for (const r of rows) logger.info({ invoice: r.row }, "invoice removal: removing row");
  const filenames = rows
    .map(r => r.attachment_url?.match(/^\/(?:api\/)?uploads\/([^/?#]+)/)?.[1])
    .filter((f): f is string => !!f && !f.includes(".."));
  for (const f of filenames) await deleteObject(f);

  await db.transaction(async tx => {
    await tx.execute(sql`ALTER TABLE messages DROP COLUMN IF EXISTS invoice_id`);
    await tx.execute(sql`DROP TABLE invoices`);
  });
  logger.info({ rows: rows.length, files: filenames.length }, "invoices removed: files deleted, table dropped");
  return { files: filenames.length, rows: rows.length };
}
