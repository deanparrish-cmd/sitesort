import { db } from "@workspace/db";
import { documentsTable, documentDistributionsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Outstanding sign-offs always read the LATEST revision (Dean, 2026-10-21).
// A superseded revision's rows never count: it can't be signed off any more.
// But a new revision that requires sign-off and reached nobody while the one
// it replaced had recipients is outstanding too, counted as the people the
// old revision went to. Without this, close-out reported "all complete" for a
// revision nobody had received. Sharing the new revision with anyone clears it.

type RevisionDoc = { id: string; previousVersionId: string | null; requiresAcknowledgment: boolean };

// For current documents with NO distribution rows: which ones replaced a
// revision that had recipients, and who those recipients were.
export async function revisionsNotSent(
  currentDocs: RevisionDoc[],
  docIdsWithRows: Set<string>,
): Promise<Map<string, { predecessorId: string; userIds: string[] }>> {
  const candidates = currentDocs.filter(d => d.requiresAcknowledgment && d.previousVersionId && !docIdsWithRows.has(d.id));
  if (candidates.length === 0) return new Map();
  const prevRows = await db.select({ documentId: documentDistributionsTable.documentId, userId: documentDistributionsTable.userId })
    .from(documentDistributionsTable)
    .where(inArray(documentDistributionsTable.documentId, candidates.map(d => d.previousVersionId!)));
  const usersByPrev = new Map<string, Set<string>>();
  for (const r of prevRows) {
    const s = usersByPrev.get(r.documentId) ?? new Set<string>();
    s.add(r.userId);
    usersByPrev.set(r.documentId, s);
  }
  const out = new Map<string, { predecessorId: string; userIds: string[] }>();
  for (const d of candidates) {
    const users = usersByPrev.get(d.previousVersionId!);
    if (users && users.size > 0) out.set(d.id, { predecessorId: d.previousVersionId!, userIds: [...users] });
  }
  return out;
}

export type OutstandingDoc = { documentId: string; projectId: string; pendingCount: number; notSentCount: number };

// Per current document on these projects: pending rows plus "not sent" people.
// Only documents with something outstanding are returned.
export async function outstandingSignOffs(projectIds: string[]): Promise<OutstandingDoc[]> {
  if (projectIds.length === 0) return [];
  const docs = await db.select({
    id: documentsTable.id, projectId: documentsTable.projectId,
    previousVersionId: documentsTable.previousVersionId, requiresAcknowledgment: documentsTable.requiresAcknowledgment,
  }).from(documentsTable)
    .where(and(inArray(documentsTable.projectId, projectIds), eq(documentsTable.status, "current")));
  if (docs.length === 0) return [];
  // Only documents that need a sign-off; everyone who hasn't signed counts,
  // opened or not (Dean, 2026-10-22). Same rule as compliance.ts.
  const rows = (await db.select({ documentId: documentDistributionsTable.documentId, status: documentDistributionsTable.status })
    .from(documentDistributionsTable)
    .where(inArray(documentDistributionsTable.documentId, docs.map(d => d.id))))
    .filter(r => docs.find(d => d.id === r.documentId)?.requiresAcknowledgment);
  const withRows = new Set(rows.map(r => r.documentId));
  const pendingByDoc = new Map<string, number>();
  for (const r of rows) if (r.status !== "acknowledged") pendingByDoc.set(r.documentId, (pendingByDoc.get(r.documentId) ?? 0) + 1);
  const notSent = await revisionsNotSent(docs, withRows);
  return docs
    .map(d => ({ documentId: d.id, projectId: d.projectId, pendingCount: pendingByDoc.get(d.id) ?? 0, notSentCount: notSent.get(d.id)?.userIds.length ?? 0 }))
    .filter(d => d.pendingCount + d.notSentCount > 0);
}
