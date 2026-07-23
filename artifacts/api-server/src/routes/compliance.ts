import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { insuranceRecordsTable, subcontractorsTable, permitsTable, projectsTable, documentDistributionsTable, documentsTable, personCertificationsTable, peopleTable, usersTable } from "@workspace/db/schema";
import { eq, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";
import { pinRequiredForDoc } from "../lib/signoff";

const router: IRouter = Router();

router.get("/compliance", authenticate, async (req, res) => {
  try {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const mySubs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, req.user!.companyId));
    const subIds = mySubs.map(s => s.id);

    let expiringInsurance: Array<{
      subcontractorId: string;
      subcontractorName: string;
      insuranceType: string;
      expiryDate: string;
      status: string;
      certificateUrl: string | null;
    }> = [];

    let archivedInsurance: Array<{
      id: string;
      subcontractorId: string;
      subcontractorName: string;
      insuranceType: string;
      expiryDate: string;
      certificateUrl: string | null;
      archivedAt: string;
    }> = [];

    if (subIds.length > 0) {
      const activeInsurance = await db.select().from(insuranceRecordsTable)
        .where(and(inArray(insuranceRecordsTable.subcontractorId, subIds), isNull(insuranceRecordsTable.archivedAt)));
      for (const ins of activeInsurance) {
        const expiry = new Date(ins.expiryDate);
        if (expiry <= in30Days) {
          const sub = mySubs.find(s => s.id === ins.subcontractorId);
          expiringInsurance.push({
            subcontractorId: ins.subcontractorId,
            subcontractorName: sub?.companyName ?? "Unknown",
            insuranceType: ins.type,
            expiryDate: ins.expiryDate,
            status: ins.status,
            certificateUrl: ins.certificateUrl ?? null,
          });
        }
      }

      const archived = await db.select().from(insuranceRecordsTable)
        .where(and(inArray(insuranceRecordsTable.subcontractorId, subIds), isNotNull(insuranceRecordsTable.archivedAt)));
      for (const ins of archived) {
        const sub = mySubs.find(s => s.id === ins.subcontractorId);
        archivedInsurance.push({
          id: ins.id,
          subcontractorId: ins.subcontractorId,
          subcontractorName: sub?.companyName ?? "Unknown",
          insuranceType: ins.type,
          expiryDate: ins.expiryDate,
          certificateUrl: ins.certificateUrl ?? null,
          archivedAt: ins.archivedAt!.toISOString(),
        });
      }
    }

    let expiringCertifications: Array<{
      id: string;
      personId: string;
      personName: string;
      certName: string;
      expiryDate: string;
      status: string;
      documentUrl: string | null;
    }> = [];

    let archivedCertifications: Array<{
      id: string;
      personId: string;
      personName: string;
      certName: string;
      expiryDate: string;
      documentUrl: string | null;
      archivedAt: string;
    }> = [];

    const myPeople = await db.select({ id: peopleTable.id, name: peopleTable.name })
      .from(peopleTable).where(eq(peopleTable.companyId, req.user!.companyId));
    const peopleIds = myPeople.map(p => p.id);

    if (peopleIds.length > 0) {
      const activeCerts = await db.select().from(personCertificationsTable)
        .where(and(inArray(personCertificationsTable.personId, peopleIds), isNull(personCertificationsTable.archivedAt)));
      for (const cert of activeCerts) {
        const expiry = new Date(cert.expiryDate);
        if (expiry <= in30Days) {
          const person = myPeople.find(p => p.id === cert.personId);
          expiringCertifications.push({
            id: cert.id,
            personId: cert.personId,
            personName: person?.name ?? "Unknown",
            certName: cert.name,
            expiryDate: cert.expiryDate,
            status: expiryStatus(cert.expiryDate, now) === "active" ? "valid" : expiryStatus(cert.expiryDate, now),
            documentUrl: cert.documentUrl ?? null,
          });
        }
      }

      const archivedCerts = await db.select().from(personCertificationsTable)
        .where(and(inArray(personCertificationsTable.personId, peopleIds), isNotNull(personCertificationsTable.archivedAt)));
      for (const cert of archivedCerts) {
        const person = myPeople.find(p => p.id === cert.personId);
        archivedCertifications.push({
          id: cert.id,
          personId: cert.personId,
          personName: person?.name ?? "Unknown",
          certName: cert.name,
          expiryDate: cert.expiryDate,
          documentUrl: cert.documentUrl ?? null,
          archivedAt: cert.archivedAt!.toISOString(),
        });
      }
    }

    const myProjects = await db.select().from(projectsTable).where(eq(projectsTable.companyId, req.user!.companyId));
    const projectIds = myProjects.map(p => p.id);

    let expiringPermits: Array<{
      permitId: string;
      projectId: string;
      projectName: string;
      permitType: string;
      expiryDate: string;
      status: string;
      documentUrl: string | null;
    }> = [];

    let archivedPermits: Array<{
      id: string;
      projectId: string;
      projectName: string;
      permitType: string;
      expiryDate: string;
      documentUrl: string | null;
      archivedAt: string;
    }> = [];

    let pendingAcknowledgments: Array<{
      documentId: string;
      documentName: string;
      projectId: string;
      projectName: string;
      pendingCount: number;
      fileUrl: string | null;
      version: number;
      revision: string | null;
      myStatus: string | null;
      pinRequired: boolean;
      recipients: Array<{ userId: string; name: string; status: string; viewedAt: string | null; acknowledgedAt: string | null }>;
    }> = [];

    let archivedDocuments: Array<{
      id: string;
      name: string;
      type: string;
      version: number;
      fileUrl: string;
      projectId: string;
      projectName: string;
      createdAt: string;
    }> = [];

    if (projectIds.length > 0) {
      const allPermits = await db.select().from(permitsTable)
        .where(and(inArray(permitsTable.projectId, projectIds), isNull(permitsTable.archivedAt)));
      for (const permit of allPermits) {
        const expiry = new Date(permit.expiryDate);
        const proj = myProjects.find(p => p.id === permit.projectId);
        const status = expiryStatus(permit.expiryDate, now);

        if (expiry <= in30Days) {
          expiringPermits.push({
            permitId: permit.id,
            projectId: permit.projectId,
            projectName: proj?.name ?? "Unknown",
            permitType: permit.type,
            expiryDate: permit.expiryDate,
            status,
            documentUrl: permit.documentUrl ?? null,
          });
        }
      }

      const archivedPermitRows = await db.select().from(permitsTable)
        .where(and(inArray(permitsTable.projectId, projectIds), isNotNull(permitsTable.archivedAt)));
      for (const permit of archivedPermitRows) {
        const proj = myProjects.find(p => p.id === permit.projectId);
        archivedPermits.push({
          id: permit.id,
          projectId: permit.projectId,
          projectName: proj?.name ?? "Unknown",
          permitType: permit.type,
          expiryDate: permit.expiryDate,
          documentUrl: permit.documentUrl ?? null,
          archivedAt: permit.archivedAt!.toISOString(),
        });
      }

      // Batch-load every distribution for every current doc in one go, then group
      // in memory — a named "who's pending" breakdown per document, not just a
      // count, so a PM can actually chase the right person.
      const allDocs = await db.select().from(documentsTable).where(and(inArray(documentsTable.projectId, projectIds), eq(documentsTable.status, "current")));
      const allDocIds = allDocs.map(d => d.id);
      const allDists = allDocIds.length
        ? await db.select().from(documentDistributionsTable).where(inArray(documentDistributionsTable.documentId, allDocIds))
        : [];
      const distsByDoc = new Map<string, typeof allDists>();
      for (const dist of allDists) {
        const arr = distsByDoc.get(dist.documentId) ?? [];
        arr.push(dist);
        distsByDoc.set(dist.documentId, arr);
      }
      const distUserIds = [...new Set(allDists.map(d => d.userId))];
      const distUsers = distUserIds.length
        ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, distUserIds))
        : [];
      const nameByUserId = new Map(distUsers.map(u => [u.id, u.name]));

      for (const doc of allDocs) {
        const dists = distsByDoc.get(doc.id) ?? [];
        const pending = dists.filter(d => d.status === "pending");
        if (pending.length === 0) continue;
        const proj = myProjects.find(p => p.id === doc.projectId);
        const mine = dists.find(d => d.userId === req.user!.id);
        pendingAcknowledgments.push({
          documentId: doc.id,
          documentName: doc.name,
          projectId: doc.projectId,
          projectName: proj?.name ?? "Unknown",
          pendingCount: pending.length,
          fileUrl: doc.fileUrl ?? null,
          version: doc.version,
          revision: doc.revision ?? null,
          myStatus: mine?.status ?? null,
          pinRequired: pinRequiredForDoc(doc),
          recipients: dists.map(d => ({
            userId: d.userId,
            name: nameByUserId.get(d.userId) ?? "Unknown",
            status: d.status,
            viewedAt: d.viewedAt?.toISOString() ?? null,
            acknowledgedAt: d.acknowledgedAt?.toISOString() ?? null,
          })),
        });
      }

      const supersededDocs = await db.select().from(documentsTable)
        .where(and(inArray(documentsTable.projectId, projectIds), eq(documentsTable.status, "superseded")));
      for (const doc of supersededDocs) {
        const proj = myProjects.find(p => p.id === doc.projectId);
        archivedDocuments.push({
          id: doc.id,
          name: doc.name,
          type: doc.type,
          version: doc.version,
          fileUrl: doc.fileUrl,
          projectId: doc.projectId,
          projectName: proj?.name ?? "Unknown",
          createdAt: doc.createdAt.toISOString(),
        });
      }
    }

    res.json({ expiringInsurance, archivedInsurance, expiringPermits, archivedPermits, expiringCertifications, archivedCertifications, pendingAcknowledgments, archivedDocuments });
  } catch (err) {
    req.log.error({ err }, "Compliance overview error");
    res.status(500).json({ error: "server_error", message: "Failed to get compliance overview" });
  }
});

export default router;
