import { db } from "@workspace/db";
import { documentDistributionsTable, notificationsTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "./id";
import { sendDocumentNotificationEmail } from "./email";

const APP_URL = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "www.sitesort.co.uk"}`;

// A per-distribution tracked open link. When the recipient clicks it from
// their email it hits GET /documents/:id/open, which records the open
// (pending→viewed) and 302-redirects to the file.
function trackedOpenUrl(documentId: string, distributionId: string): string {
  return `${APP_URL}/api/documents/${documentId}/open?d=${distributionId}`;
}

// Creates a document_distributions row + in-app notification + a tracked,
// acknowledgment-aware email for one recipient — a no-op if they already have
// a distribution record for this document. Shared by every path that gives
// someone a tracked copy of a document (Share → Team Portal's People/Trade/
// Everyone resolution, and any future direct-distribute path), so a
// recipient's pending/viewed/acknowledged tracking and notifications are
// identical no matter which UI action reached them.
export async function distributeDocumentToUser(
  doc: { id: string; name: string; version: number; requiresAcknowledgment: boolean },
  projectName: string,
  userId: string,
  title: string,
  onEmailError: (err: unknown) => void,
): Promise<void> {
  const existing = await db.select({ id: documentDistributionsTable.id }).from(documentDistributionsTable)
    .where(and(eq(documentDistributionsTable.documentId, doc.id), eq(documentDistributionsTable.userId, userId)))
    .limit(1);
  if (existing.length > 0) return;

  const distId = generateId();
  await db.insert(documentDistributionsTable).values({ id: distId, documentId: doc.id, userId, status: "pending" });
  await db.insert(notificationsTable).values({
    id: generateId(), userId, type: "document_uploaded",
    title, message: `${doc.name} (v${doc.version}) has been shared with you.`,
    relatedEntityId: doc.id, relatedEntityType: "document", read: false,
  });

  const recipientRows = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (recipientRows[0]) {
    sendDocumentNotificationEmail(
      recipientRows[0].email, recipientRows[0].name, doc.name, doc.version,
      projectName, doc.requiresAcknowledgment, trackedOpenUrl(doc.id, distId),
    ).catch(onEmailError);
  }
}
