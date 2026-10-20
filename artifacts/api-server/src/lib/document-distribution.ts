import { db } from "@workspace/db";
import { insertNotifications } from "./notify";
import { documentDistributionsTable, documentsTable, usersTable } from "@workspace/db/schema";
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

// Creates a document_distributions row + in-app notification for one recipient
// (a no-op if they already have one for this document), and a tracked,
// acknowledgment-aware email ONLY when the sender asked for it (sendEmail,
// "Also email them" in the share dialog; Dean, 2026-10-20: sharing to the
// portal used to email every recipient) and the recipient's email setting is
// on. The email's open link works without a login for 30 days, so it must
// never go out by default. Shared by every path that gives
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
  opts: { sendEmail: boolean } = { sendEmail: false },
): Promise<{ emailed: boolean }> {
  const existing = await db.select({ id: documentDistributionsTable.id }).from(documentDistributionsTable)
    .where(and(eq(documentDistributionsTable.documentId, doc.id), eq(documentDistributionsTable.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    // Already distributed: no second notification, but an explicit "Also
    // email them" on a re-share still sends the email.
    return { emailed: opts.sendEmail ? await emailRecipient(doc, projectName, userId, existing[0].id, onEmailError) : false };
  }

  const docProject = (await db.select({ projectId: documentsTable.projectId }).from(documentsTable).where(eq(documentsTable.id, doc.id)).limit(1))[0]?.projectId;
  if (!docProject) return { emailed: false };
  const distId = generateId();
  await db.insert(documentDistributionsTable).values({ id: distId, documentId: doc.id, userId, status: "pending" });
  await insertNotifications({ projectId: docProject,
    id: generateId(), userId, type: "document_uploaded",
    title, message: `${doc.name} (v${doc.version}) has been shared with you.`,
    relatedEntityId: doc.id, relatedEntityType: "document", read: false,
  });

  return { emailed: opts.sendEmail ? await emailRecipient(doc, projectName, userId, distId, onEmailError) : false };
}

async function emailRecipient(
  doc: { id: string; name: string; version: number; requiresAcknowledgment: boolean },
  projectName: string, userId: string, distId: string, onEmailError: (err: unknown) => void,
): Promise<boolean> {
  const r = (await db.select({ email: usersTable.email, name: usersTable.name, emailNotifications: usersTable.emailNotifications })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1))[0];
  if (!r || !r.emailNotifications) return false;
  sendDocumentNotificationEmail(
    r.email, r.name, doc.name, doc.version,
    projectName, doc.requiresAcknowledgment, trackedOpenUrl(doc.id, distId),
  ).catch(onEmailError);
  return true;
}
