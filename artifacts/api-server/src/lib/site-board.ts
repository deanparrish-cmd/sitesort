import { db } from "@workspace/db";
import {
  projectsTable, projectMembersTable, usersTable, permitsTable,
  documentsTable, photosTable,
} from "@workspace/db/schema";
import { and, eq, inArray, desc, isNull } from "drizzle-orm";
import { expiryStatus } from "./expiry";
import { resolvePins } from "./board-pins";

const normaliseUrl = (url: string) =>
  url.startsWith("/uploads/") ? url.replace("/uploads/", "/api/uploads/") : url;

// Single source of truth for the Site Board contents. Used by BOTH the public
// scanned page (`GET /api/site/:token`) and the member portal's Site Board
// section, so the two can never drift apart. Returns null when the project is
// missing. Behaviour is intentionally identical to the original public resolver.
export async function buildSiteBoardPayload(projectId: string) {
  const project = (await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  if (!project) return null;

  const [members, permits, documents, pins, siteManagerRows] = await Promise.all([
    db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      phone: usersTable.phone,
    }).from(projectMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
      .where(eq(projectMembersTable.projectId, projectId)),
    // An archived (withdrawn) permit never shows on the board as if current.
    db.select().from(permitsTable).where(and(eq(permitsTable.projectId, projectId), isNull(permitsTable.archivedAt))).orderBy(desc(permitsTable.createdAt)),
    db.select({
      id: documentsTable.id, name: documentsTable.name, type: documentsTable.type,
      version: documentsTable.version, fileUrl: documentsTable.fileUrl,
      createdAt: documentsTable.createdAt, publicAccess: documentsTable.publicAccess,
    }).from(documentsTable).where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.status, "current"))).orderBy(desc(documentsTable.createdAt)),
    resolvePins(projectId),
    project.siteManagerId
      ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone })
          .from(usersTable).where(eq(usersTable.id, project.siteManagerId)).limit(1)
      : Promise.resolve([]),
  ]);

  // Pinning publishes (#167): every pin that resolves to something on this
  // project is shown, with its file, to whoever is looking at the board. A
  // pinned drawing shows its CURRENT revision; pins of archived items or items
  // not on this project (#166) are left off.
  const shown = (t: string) => [...new Set(pins.filter(p => p.itemType === t && p.shownId).map(p => p.shownId as string))];
  const [docPinIds, photoPinIds, permitPinIds] = [shown("document"), shown("photo"), shown("permit")];
  const [pinnedDocs, pinnedPhotos, pinnedPermitRows] = await Promise.all([
    docPinIds.length ? db.select().from(documentsTable).where(and(inArray(documentsTable.id, docPinIds), eq(documentsTable.projectId, projectId))) : Promise.resolve([]),
    photoPinIds.length ? db.select().from(photosTable).where(and(inArray(photosTable.id, photoPinIds), eq(photosTable.projectId, projectId))) : Promise.resolve([]),
    permitPinIds.length ? db.select().from(permitsTable).where(and(inArray(permitsTable.id, permitPinIds), eq(permitsTable.projectId, projectId))) : Promise.resolve([]),
  ]);

  // Deliberately PM-chosen (projects.siteManagerId) — never guessed. No
  // fallback to "first member"/"role=manager": unset means "Not set".
  const siteManager = siteManagerRows[0] ?? null;

  return {
    project: {
      id: project.id, name: project.name, address: project.address, status: project.status,
      startDate: project.startDate, targetEndDate: project.targetEndDate ?? null,
      trades: project.trades ?? [],
    },
    siteManager: siteManager ? { name: siteManager.name, email: siteManager.email, phone: siteManager.phone ?? null } : null,
    teamSize: members.length,
    permits: permits.map(p => ({ id: p.id, type: p.type, description: p.description, expiryDate: p.expiryDate })),
    documents: documents.filter(d => d.publicAccess).map(d => ({ id: d.id, name: d.name, type: d.type, version: d.version, uploadedAt: d.createdAt })),
    pinnedItems: [
      ...pinnedDocs.map(d => ({ itemType: "document", id: d.id, name: d.name, type: d.type, version: d.version, superseded: d.status === "superseded", fileUrl: normaliseUrl(d.fileUrl) })),
      ...pinnedPhotos.map(p => ({ itemType: "photo", id: p.id, referenceNumber: p.referenceNumber, category: p.category, description: p.description, photoUrl: p.photoUrl ? normaliseUrl(p.photoUrl) : null })),
      // fileUrl null = no permit document attached: the board says so.
      ...pinnedPermitRows.map(p => ({ itemType: "permit", id: p.id, type: p.type, description: p.description, expiryDate: p.expiryDate, status: expiryStatus(p.expiryDate), fileUrl: p.documentUrl ? normaliseUrl(p.documentUrl) : null })),
    ],
  };
}
