import { db } from "@workspace/db";
import {
  projectsTable, projectMembersTable, usersTable, permitsTable,
  documentsTable, qrBoardPinsTable, photosTable, calendarEventsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, or, gte, asc } from "drizzle-orm";
import { expiryStatus } from "./expiry";

const normaliseUrl = (url: string) =>
  url.startsWith("/uploads/") ? url.replace("/uploads/", "/api/uploads/") : url;

// Single source of truth for the Site Board contents. Used by BOTH the public
// scanned page (`GET /api/site/:token`) and the member portal's Site Board
// section, so the two can never drift apart. Returns null when the project is
// missing. Behaviour is intentionally identical to the original public resolver.
export async function buildSiteBoardPayload(projectId: string) {
  const project = (await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  if (!project) return null;

  const [members, permits, documents, pins] = await Promise.all([
    db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      phone: usersTable.phone, role: projectMembersTable.role,
    }).from(projectMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
      .where(eq(projectMembersTable.projectId, projectId)),
    db.select().from(permitsTable).where(eq(permitsTable.projectId, projectId)),
    db.select({
      id: documentsTable.id, name: documentsTable.name, type: documentsTable.type,
      version: documentsTable.version, fileUrl: documentsTable.fileUrl,
      createdAt: documentsTable.createdAt, publicAccess: documentsTable.publicAccess,
    }).from(documentsTable).where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.status, "current"))),
    db.select().from(qrBoardPinsTable).where(eq(qrBoardPinsTable.projectId, projectId)),
  ]);

  const docPinIds = pins.filter(p => p.itemType === "document").map(p => p.itemId);
  const photoPinIds = pins.filter(p => p.itemType === "photo").map(p => p.itemId);
  const permitPinIds = pins.filter(p => p.itemType === "permit").map(p => p.itemId);
  const [pinnedDocs, pinnedPhotos, pinnedPermitRows] = await Promise.all([
    docPinIds.length ? db.select().from(documentsTable).where(inArray(documentsTable.id, docPinIds)) : Promise.resolve([]),
    photoPinIds.length ? db.select().from(photosTable).where(inArray(photosTable.id, photoPinIds)) : Promise.resolve([]),
    permitPinIds.length ? db.select().from(permitsTable).where(inArray(permitsTable.id, permitPinIds)) : Promise.resolve([]),
  ]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingEvents = await db.select({
    id: calendarEventsTable.id, title: calendarEventsTable.title,
    eventDate: calendarEventsTable.eventDate, note: calendarEventsTable.note,
  }).from(calendarEventsTable)
    .where(and(
      eq(calendarEventsTable.companyId, project.companyId),
      or(isNull(calendarEventsTable.projectId), eq(calendarEventsTable.projectId, projectId)),
      gte(calendarEventsTable.eventDate, todayStr),
    ))
    .orderBy(asc(calendarEventsTable.eventDate));

  const siteManager = members.find(m => m.role === "manager") ?? members[0] ?? null;

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
      ...pinnedPermitRows.map(p => ({ itemType: "permit", id: p.id, type: p.type, description: p.description, expiryDate: p.expiryDate, status: expiryStatus(p.expiryDate) })),
    ],
    upcomingEvents,
  };
}
