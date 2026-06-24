import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { insuranceRecordsTable, subcontractorsTable, permitsTable, projectsTable, documentDistributionsTable, documentsTable } from "@workspace/db/schema";
import { eq, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";

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

      const allDocs = await db.select().from(documentsTable).where(and(inArray(documentsTable.projectId, projectIds), eq(documentsTable.status, "current")));
      for (const doc of allDocs) {
        const pending = await db.select().from(documentDistributionsTable)
          .where(and(eq(documentDistributionsTable.documentId, doc.id), eq(documentDistributionsTable.status, "pending")));
        if (pending.length > 0) {
          const proj = myProjects.find(p => p.id === doc.projectId);
          pendingAcknowledgments.push({
            documentId: doc.id,
            documentName: doc.name,
            projectId: doc.projectId,
            projectName: proj?.name ?? "Unknown",
            pendingCount: pending.length,
            fileUrl: doc.fileUrl ?? null,
          });
        }
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

    res.json({ expiringInsurance, archivedInsurance, expiringPermits, archivedPermits, pendingAcknowledgments, archivedDocuments });
  } catch (err) {
    req.log.error({ err }, "Compliance overview error");
    res.status(500).json({ error: "server_error", message: "Failed to get compliance overview" });
  }
});

export default router;
