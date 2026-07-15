import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  portalSharesTable, projectsTable, projectMembersTable, peopleTable,
  subcontractorsTable, documentDistributionsTable, documentsTable,
} from "@workspace/db/schema";
import { and, eq, isNotNull, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { enqueuePushForMembers } from "../lib/push-triggers";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];
function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can manage portal sharing." });
    return false;
  }
  return true;
}

const SITE_STAFF = "Site Staff";
const ITEM_TYPES = new Set(["document", "photo", "permit"]);

async function ownedProject(req: import("express").Request): Promise<boolean> {
  const rows = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
    .limit(1);
  return !!rows[0];
}

// Accepted portal members of a project (a project_members row carrying BOTH a
// person link and a user account = someone who has accepted their invite), with
// the trades of the firm they belong to. In-house people (no firm) carry no
// trade and fall in the synthetic "Site Staff" bucket.
async function acceptedMembers(projectId: string) {
  const rows = await db.select({
    personId: projectMembersTable.personId,
    userId: projectMembersTable.userId,
    subId: peopleTable.subcontractorId,
    trades: subcontractorsTable.trades,
  }).from(projectMembersTable)
    .innerJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
    .leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      isNotNull(projectMembersTable.personId),
      isNotNull(projectMembersTable.userId),
    ));
  return rows.map(r => ({
    personId: r.personId as string,
    userId: r.userId as string,
    trades: (r.trades ?? []) as string[],
  }));
}

// GET /api/projects/:projectId/portal-audience — trade groups (with portal-member
// counts, so the dialog can grey empty ones) + individuals, for the share dialog.
router.get("/projects/:projectId/portal-audience", authenticate, async (req, res) => {
  try {
    if (!(await ownedProject(req))) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!requireManager(req, res)) return;

    const proj = await db.select({ trades: projectsTable.trades }).from(projectsTable)
      .where(eq(projectsTable.id, req.params.projectId)).limit(1);
    const members = await acceptedMembers(req.params.projectId);

    // Member names for the individual multi-select.
    const named = await db.select({
      personId: projectMembersTable.personId, name: peopleTable.name,
    }).from(projectMembersTable)
      .innerJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
      .where(and(eq(projectMembersTable.projectId, req.params.projectId), isNotNull(projectMembersTable.userId)));
    const nameByPerson = new Map(named.map(n => [n.personId as string, n.name]));

    const counts = new Map<string, number>();
    for (const m of members) {
      const buckets = m.trades.length ? m.trades : [SITE_STAFF];
      for (const t of buckets) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const tradeSet = new Set<string>([...(proj[0]?.trades ?? []), ...counts.keys()]);
    if (members.some(m => m.trades.length === 0)) tradeSet.add(SITE_STAFF);

    res.json({
      trades: [...tradeSet].sort().map(trade => ({ trade, memberCount: counts.get(trade) ?? 0 })),
      members: members.map(m => ({ personId: m.personId, userId: m.userId, name: nameByPerson.get(m.personId) ?? "Unknown" })),
    });
  } catch (err) {
    req.log.error({ err }, "Portal audience error");
    res.status(500).json({ error: "server_error", message: "Failed to load portal audience" });
  }
});

// GET /api/projects/:projectId/portal-shares?itemType=&itemId= — current rules for an item.
router.get("/projects/:projectId/portal-shares", authenticate, async (req, res) => {
  try {
    if (!(await ownedProject(req))) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const { itemType, itemId } = req.query as { itemType?: string; itemId?: string };
    if (!itemType || !itemId) { res.status(400).json({ error: "validation_error", message: "itemType and itemId required" }); return; }
    const rows = await db.select().from(portalSharesTable).where(and(
      eq(portalSharesTable.projectId, req.params.projectId),
      eq(portalSharesTable.itemType, itemType),
      eq(portalSharesTable.itemId, itemId),
    ));
    // Attach person names for 'person' rules (PM side only — never exposed in portal).
    const personIds = rows.filter(r => r.personId).map(r => r.personId as string);
    const names = personIds.length
      ? await db.select({ id: peopleTable.id, name: peopleTable.name }).from(peopleTable).where(inArray(peopleTable.id, personIds))
      : [];
    const nameById = new Map(names.map(n => [n.id, n.name]));
    res.json(rows.map(r => ({
      id: r.id, audienceType: r.audienceType, trade: r.trade ?? undefined,
      personId: r.personId ?? undefined, personName: r.personId ? nameById.get(r.personId) : undefined,
    })));
  } catch (err) {
    req.log.error({ err }, "List portal shares error");
    res.status(500).json({ error: "server_error", message: "Failed to load portal shares" });
  }
});

type Audience = { type: "all" | "trade" | "person"; trade?: string; personId?: string };

// POST /api/projects/:projectId/portal-shares — share an item to portal audiences.
router.post("/projects/:projectId/portal-shares", authenticate, async (req, res) => {
  try {
    if (!(await ownedProject(req))) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!requireManager(req, res)) return;
    const { itemType, itemId, audiences } = req.body as { itemType?: string; itemId?: string; audiences?: Audience[] };
    if (!itemType || !ITEM_TYPES.has(itemType) || !itemId || !Array.isArray(audiences) || audiences.length === 0) {
      res.status(400).json({ error: "validation_error", message: "itemType (document|photo|permit), itemId and a non-empty audiences array are required." });
      return;
    }

    for (const a of audiences) {
      if (a.type === "trade" && !a.trade) continue;
      if (a.type === "person" && !a.personId) continue;
      await db.insert(portalSharesTable).values({
        id: generateId(),
        projectId: req.params.projectId,
        itemType, itemId,
        audienceType: a.type,
        trade: a.type === "trade" ? a.trade! : null,
        personId: a.type === "person" ? a.personId! : null,
        sharedByUserId: req.user!.id,
      }).onConflictDoNothing();
    }

    // Registering in distribution tracking (documents only). Resolve currently
    // accepted members matched by the audiences and create pending rows so the PM
    // sees them immediately; members invited LATER are reached at portal read time
    // via the stored rule (and get a distribution row lazily on first view).
    let recipientCount = 0;
    if (itemType === "document") {
      const members = await acceptedMembers(req.params.projectId);
      const targetUserIds = new Set<string>();
      for (const a of audiences) {
        if (a.type === "all") members.forEach(m => targetUserIds.add(m.userId));
        else if (a.type === "person" && a.personId) members.filter(m => m.personId === a.personId).forEach(m => targetUserIds.add(m.userId));
        else if (a.type === "trade" && a.trade) {
          members.filter(m => m.trades.includes(a.trade!) || (m.trades.length === 0 && a.trade === SITE_STAFF))
            .forEach(m => targetUserIds.add(m.userId));
        }
      }
      recipientCount = targetUserIds.size;
      for (const userId of targetUserIds) {
        const existing = await db.select({ id: documentDistributionsTable.id }).from(documentDistributionsTable)
          .where(and(eq(documentDistributionsTable.documentId, itemId), eq(documentDistributionsTable.userId, userId))).limit(1);
        if (existing.length === 0) {
          await db.insert(documentDistributionsTable).values({ id: generateId(), documentId: itemId, userId, status: "pending" });
        }
      }

      // Notify the resolved members (batched/debounced). A drawing shared to a
      // trade/everyone/individual all funnel here — the audience is already
      // flattened to the exact members it reaches.
      if (targetUserIds.size > 0) {
        const doc = (await db.select({ name: documentsTable.name, type: documentsTable.type }).from(documentsTable).where(eq(documentsTable.id, itemId)).limit(1))[0];
        const proj = (await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1))[0];
        if (doc && proj) {
          const label = doc.type === "drawing" ? "drawing" : doc.type === "method_statement" ? "method statement" : doc.type === "safety" ? "safety document" : "document";
          const section = doc.type === "drawing" ? "drawings" : doc.type === "method_statement" ? "method-statements" : doc.type === "safety" ? "safety" : doc.type === "general" ? "general" : "shared";
          await enqueuePushForMembers([...targetUserIds], req.params.projectId, {
            kind: "document", itemType: doc.type, itemId,
            title: `New ${label}: ${doc.name}`,
            projectName: proj.name,
            deepLink: section === "shared" ? "/portal/shared" : `/portal/${section}?doc=${itemId}`,
          });
        }
      }
    }

    res.status(201).json({ success: true, recipientCount });
  } catch (err) {
    req.log.error({ err }, "Create portal share error");
    res.status(500).json({ error: "server_error", message: "Failed to share to portal" });
  }
});

// DELETE /api/projects/:projectId/portal-shares/:id — remove one share rule.
router.delete("/projects/:projectId/portal-shares/:id", authenticate, async (req, res) => {
  try {
    if (!(await ownedProject(req))) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    if (!requireManager(req, res)) return;
    await db.delete(portalSharesTable).where(and(
      eq(portalSharesTable.id, req.params.id),
      eq(portalSharesTable.projectId, req.params.projectId),
    ));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete portal share error");
    res.status(500).json({ error: "server_error", message: "Failed to remove share" });
  }
});

export default router;
