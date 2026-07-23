import { db } from "@workspace/db";
import { portalSubmissionNotesTable, usersTable } from "@workspace/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { generateId } from "./id";

export type ItemType = "site_issue" | "plant_item" | "daily_report";

// Shared append-only "add a note" thread for all 3 portal save-vs-submit
// features. Once an item is submitted, its original fields lock — this is the
// only way to add anything further, so nothing already submitted is ever lost
// or silently rewritten.
export async function notesFor(itemType: ItemType, itemId: string) {
  const rows = await db.select({
    id: portalSubmissionNotesTable.id, body: portalSubmissionNotesTable.body,
    createdAt: portalSubmissionNotesTable.createdAt, authorName: usersTable.name,
  })
    .from(portalSubmissionNotesTable)
    .innerJoin(usersTable, eq(portalSubmissionNotesTable.authorId, usersTable.id))
    .where(and(eq(portalSubmissionNotesTable.itemType, itemType), eq(portalSubmissionNotesTable.itemId, itemId)))
    .orderBy(asc(portalSubmissionNotesTable.createdAt));
  return rows.map(r => ({ id: r.id, authorName: r.authorName, body: r.body, createdAt: r.createdAt.toISOString() }));
}

export async function addNote(params: { itemType: ItemType; itemId: string; projectId: string; authorId: string; body: string }) {
  await db.insert(portalSubmissionNotesTable).values({
    id: generateId(), projectId: params.projectId, itemType: params.itemType, itemId: params.itemId,
    authorId: params.authorId, body: params.body,
  });
}
