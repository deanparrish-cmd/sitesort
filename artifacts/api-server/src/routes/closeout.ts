import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  projectsTable, projectCloseoutsTable, photosTable, permitsTable,
  insuranceRecordsTable, projectMembersTable, documentsTable, documentDistributionsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, inArray, isNull, count, desc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";
import { issueCategoryFilter } from "../lib/accountability";
import { isPinLockedOut, recordFailedPinAttempt, clearPinAttempts } from "../lib/pin-attempts";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

// Verify the project exists and belongs to the caller's company.
async function loadOwnedProject(projectId: string, companyId: string) {
  const rows = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId)))
    .limit(1);
  return rows[0] ?? null;
}

// Compute the four close-out readiness checks for one project. Each is advisory:
// a manager can still sign off with warnings (real sites close out with known
// exceptions), but the checklist surfaces what's outstanding.
async function computeReadiness(projectId: string) {
  // 1. Open snags / safety concerns.
  const issueRows = await db.select({ total: count() }).from(photosTable).where(and(
    eq(photosTable.projectId, projectId),
    issueCategoryFilter(),
    inArray(photosTable.status, ["open", "in_progress", "new", "pending_confirmation"]),
  ));
  const openIssues = Number(issueRows[0]?.total ?? 0);

  // 2. Insurance — any project sub with an expired cert or no cert at all.
  const members = await db.select({ subcontractorId: projectMembersTable.subcontractorId })
    .from(projectMembersTable).where(eq(projectMembersTable.projectId, projectId));
  const subIds = members.map(m => m.subcontractorId).filter((x): x is string => !!x);
  let subsWithInsuranceIssues = 0;
  for (const subId of subIds) {
    const recs = await db.select({ expiryDate: insuranceRecordsTable.expiryDate })
      .from(insuranceRecordsTable)
      .where(and(eq(insuranceRecordsTable.subcontractorId, subId), isNull(insuranceRecordsTable.archivedAt)));
    const hasExpired = recs.some(r => expiryStatus(r.expiryDate) === "expired");
    if (recs.length === 0 || hasExpired) subsWithInsuranceIssues++;
  }

  // 3. Permits — any expired (non-archived) permit.
  const permits = await db.select({ expiryDate: permitsTable.expiryDate }).from(permitsTable)
    .where(and(eq(permitsTable.projectId, projectId), isNull(permitsTable.archivedAt)));
  const expiredPermits = permits.filter(p => expiryStatus(p.expiryDate) === "expired").length;

  // 4. Document sign-offs — current docs in this project with pending distributions.
  const currentDocs = await db.select({ id: documentsTable.id }).from(documentsTable)
    .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.status, "current")));
  let pendingSignOffs = 0;
  for (const doc of currentDocs) {
    const pending = await db.select({ total: count() }).from(documentDistributionsTable)
      .where(and(eq(documentDistributionsTable.documentId, doc.id), eq(documentDistributionsTable.status, "pending")));
    pendingSignOffs += Number(pending[0]?.total ?? 0);
  }

  const checks = {
    openIssues: { count: openIssues, ok: openIssues === 0 },
    insurance: { subsWithIssues: subsWithInsuranceIssues, subsTotal: subIds.length, ok: subsWithInsuranceIssues === 0 },
    permits: { expiredCount: expiredPermits, ok: expiredPermits === 0 },
    signOffs: { pendingCount: pendingSignOffs, ok: pendingSignOffs === 0 },
  };
  const ready = checks.openIssues.ok && checks.insurance.ok && checks.permits.ok && checks.signOffs.ok;
  return { checks, ready };
}

function serializeCloseout(c: typeof projectCloseoutsTable.$inferSelect | undefined) {
  if (!c) return null;
  return {
    id: c.id,
    projectId: c.projectId,
    signedOffByUserId: c.signedOffByUserId,
    signedOffByName: c.signedOffByName,
    signedOffByRole: c.signedOffByRole,
    note: c.note ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

// GET readiness + current close-out record (if any).
router.get("/projects/:projectId/closeout", authenticate, async (req, res) => {
  try {
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }
    const readiness = await computeReadiness(req.params.projectId);
    const latest = await db.select().from(projectCloseoutsTable)
      .where(eq(projectCloseoutsTable.projectId, req.params.projectId))
      .orderBy(desc(projectCloseoutsTable.createdAt)).limit(1);
    res.json({
      status: project.status,
      isComplete: project.status === "complete",
      ...readiness,
      closeout: project.status === "complete" ? serializeCloseout(latest[0]) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Get closeout error");
    res.status(500).json({ error: "server_error", message: "Failed to load close-out" });
  }
});

// POST — PIN-confirmed close-out. Marks the project complete and appends an
// immutable handover record. Manager-only (admin / project_manager).
router.post("/projects/:projectId/closeout", authenticate, async (req, res) => {
  try {
    if (!MANAGER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can close out a project." });
      return;
    }
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }
    if (project.status === "complete") {
      res.status(400).json({ error: "already_complete", message: "This project is already closed out." });
      return;
    }

    const { pin, note } = req.body ?? {};

    // PIN gate — close-out is a critical action, always PIN-confirmed (reuses the
    // same per-user lockout + bcrypt verification as document sign-off).
    if (await isPinLockedOut(req.user!.id)) {
      res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
      return;
    }
    const actorRows = await db.select({ name: usersTable.name, role: usersTable.role, pinHash: usersTable.pinHash })
      .from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const pinHash = actorRows[0]?.pinHash ?? null;
    if (!pinHash) {
      res.status(400).json({ error: "pin_not_set", message: "You need to set a sign-off PIN before closing out a project." });
      return;
    }
    if (!pin || !/^\d{4}$/.test(String(pin))) {
      res.status(400).json({ error: "validation_error", message: "A 4-digit PIN is required to close out this project." });
      return;
    }
    const valid = await bcrypt.compare(String(pin), pinHash);
    if (!valid) {
      const { locked, remaining } = await recordFailedPinAttempt(req.user!.id);
      if (locked) {
        res.status(429).json({ error: "too_many_attempts", message: "Too many incorrect PIN attempts. Try again in 15 minutes." });
      } else {
        res.status(401).json({ error: "invalid_pin", message: "Incorrect PIN", attemptsRemaining: remaining });
      }
      return;
    }
    await clearPinAttempts(req.user!.id);

    const id = generateId();
    await db.transaction(async (tx) => {
      await tx.insert(projectCloseoutsTable).values({
        id,
        projectId: req.params.projectId,
        signedOffByUserId: req.user!.id,
        signedOffByName: actorRows[0]?.name ?? "Unknown",
        signedOffByRole: actorRows[0]?.role ?? req.user!.role,
        note: note ? String(note) : null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      await tx.update(projectsTable).set({ status: "complete" }).where(eq(projectsTable.id, req.params.projectId));
    });

    const inserted = await db.select().from(projectCloseoutsTable).where(eq(projectCloseoutsTable.id, id)).limit(1);
    res.status(201).json({ success: true, status: "complete", closeout: serializeCloseout(inserted[0]) });
  } catch (err) {
    req.log.error({ err }, "Close out project error");
    res.status(500).json({ error: "server_error", message: "Failed to close out project" });
  }
});

// POST reopen — return a completed project to active. The close-out audit rows
// are kept (immutable history); a later re-close appends a new one.
router.post("/projects/:projectId/closeout/reopen", authenticate, async (req, res) => {
  try {
    if (!MANAGER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can re-open a project." });
      return;
    }
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }
    await db.update(projectsTable).set({ status: "active" }).where(eq(projectsTable.id, req.params.projectId));
    res.json({ success: true, status: "active" });
  } catch (err) {
    req.log.error({ err }, "Reopen project error");
    res.status(500).json({ error: "server_error", message: "Failed to re-open project" });
  }
});

export default router;
