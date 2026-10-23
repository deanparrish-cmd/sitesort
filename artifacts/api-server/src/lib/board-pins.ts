// What a site-board pin shows (#167). Pinning PUBLISHES: a pinned item opens for
// whoever looks at that board (anyone who scans the QR code, or any Team Portal
// member on the project). A binding exception to "documents and permits leave
// SiteSort only through share links" (#129) and "site photos need a login"
// (#127), approvers only, and the PM is told so at pinning time (Dean,
// 2026-10-22). The board builder, the pin list and pin/unpin all resolve pins
// here, so the dashboard, the QR board and the portal agree.
import { db } from "@workspace/db";
import { qrBoardPinsTable, documentsTable, photosTable, permitsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const PIN_TYPES = new Set(["document", "photo", "permit"]);

// A drawing or document that has been replaced: the newest revision in its
// chain on this project (documents.previous_version_id points back), so a pin
// follows the current revision and a superseded drawing never stays on the
// gate board. Returns the id itself when there's nothing newer.
export async function currentRevisionId(projectId: string, docId: string): Promise<string> {
  let id = docId;
  for (let i = 0; i < 50; i++) {
    const next = (await db.select({ id: documentsTable.id }).from(documentsTable)
      .where(and(eq(documentsTable.previousVersionId, id), eq(documentsTable.projectId, projectId))).limit(1))[0];
    if (!next) return id;
    id = next.id;
  }
  return id;
}

export type ResolvedPin = {
  pinId: string;
  itemType: string;
  itemId: string;               // as stored on the pin
  shownId: string | null;       // what the board shows (a document: its current revision)
  hidden: "not_on_project" | "archived" | null;  // why the board doesn't show it
  name: string | null;
};

export async function resolvePins(projectId: string): Promise<ResolvedPin[]> {
  const pins = await db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, projectId));
  const ids = (t: string) => pins.filter(p => p.itemType === t).map(p => p.itemId);
  const [docs, photos, permits] = await Promise.all([
    ids("document").length ? db.select({ id: documentsTable.id, projectId: documentsTable.projectId, name: documentsTable.name, status: documentsTable.status }).from(documentsTable).where(inArray(documentsTable.id, ids("document"))) : Promise.resolve([] as { id: string; projectId: string; name: string; status: string }[]),
    ids("photo").length ? db.select({ id: photosTable.id, projectId: photosTable.projectId, name: photosTable.referenceNumber, archivedAt: photosTable.archivedAt }).from(photosTable).where(inArray(photosTable.id, ids("photo"))) : Promise.resolve([] as { id: string; projectId: string; name: string; archivedAt: Date | null }[]),
    ids("permit").length ? db.select({ id: permitsTable.id, projectId: permitsTable.projectId, name: permitsTable.type, archivedAt: permitsTable.archivedAt }).from(permitsTable).where(inArray(permitsTable.id, ids("permit"))) : Promise.resolve([] as { id: string; projectId: string; name: string; archivedAt: Date | null }[]),
  ]);
  const out: ResolvedPin[] = [];
  for (const p of pins) {
    const base = { pinId: p.id, itemType: p.itemType, itemId: p.itemId };
    if (p.itemType === "document") {
      const d = docs.find(x => x.id === p.itemId);
      if (!d || d.projectId !== projectId) { out.push({ ...base, shownId: null, hidden: "not_on_project", name: d?.projectId === projectId ? d.name : null }); continue; }
      out.push({ ...base, shownId: d.status === "superseded" ? await currentRevisionId(projectId, d.id) : d.id, hidden: null, name: d.name });
    } else {
      const pool: { id: string; projectId: string; name: string; archivedAt: Date | null }[] = p.itemType === "photo" ? photos : p.itemType === "permit" ? permits : [];
      const row = pool.find(x => x.id === p.itemId);
      if (!row || row.projectId !== projectId) { out.push({ ...base, shownId: null, hidden: "not_on_project", name: null }); continue; }
      out.push({ ...base, shownId: row.archivedAt ? null : row.id, hidden: row.archivedAt ? "archived" : null, name: row.name });
    }
  }
  return out;
}

export const HIDDEN_PIN_TEXT: Record<NonNullable<ResolvedPin["hidden"]>, string> = {
  not_on_project: "Not shown on the board: it isn't on this project any more.",
  archived: "Not shown on the board: it has been archived.",
};
