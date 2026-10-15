import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  shareLinksTable, shareAccessRequestsTable, projectsTable, usersTable,
  companyMembersTable, projectMembersTable, notificationsTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { allow, INTERNAL_STAFF } from "../lib/authz";
import { generateId } from "../lib/id";
import {
  isShareItemType, loadShareItem, currentShareItem, mintShareLink, findShareLink,
  shareState, canManageShare, projectAndCompanyNames, recordShareOpen, sharePath,
  type ShareItemType,
} from "../lib/share-links";
import { sendShareLinkGrantedEmail, EMAIL_APP_URL } from "../lib/email";
import { serveUpload } from "./upload";

const router: IRouter = Router();

// ── Logged in: minting, listing and revoking links ──────────────────────────

async function companyProject(projectId: string, companyId: string): Promise<boolean> {
  const p = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId))).limit(1);
  return !!p[0];
}

// POST /share-links { itemType, itemId } → a fresh link for the share dialog.
// It counts as sent (and gets a reminder) once the dialog logs how it went out.
router.post("/share-links", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const { itemType, itemId } = req.body ?? {};
    if (!isShareItemType(itemType) || typeof itemId !== "string") {
      res.status(400).json({ error: "validation_error", message: "itemType (document or permit) and itemId required" });
      return;
    }
    const item = await loadShareItem(itemType, itemId);
    if (!item || !(await companyProject(item.projectId, req.user!.companyId))) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!item.filename) {
      res.status(400).json({ error: "no_file", message: "There's no file attached to share." });
      return;
    }
    if (!item.live) {
      res.status(409).json({ error: "superseded", message: "This has been superseded. Share the current revision instead." });
      return;
    }
    const { link, token } = await mintShareLink({
      companyId: req.user!.companyId, projectId: item.projectId, itemType, itemId,
      createdByUserId: req.user!.id,
    });
    res.status(201).json({ id: link.id, url: sharePath(token), expiresAt: link.expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Create share link error");
    res.status(500).json({ error: "server_error" });
  }
});

// GET /share-links?itemType=&itemId= → links sent for this item, newest first.
router.get("/share-links", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const { itemType, itemId } = req.query as Record<string, string>;
    if (!isShareItemType(itemType) || !itemId) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const rows = await db.select({ link: shareLinksTable, sentByName: usersTable.name })
      .from(shareLinksTable)
      .leftJoin(usersTable, eq(usersTable.id, shareLinksTable.createdByUserId))
      .where(and(
        eq(shareLinksTable.companyId, req.user!.companyId),
        eq(shareLinksTable.itemType, itemType),
        eq(shareLinksTable.itemId, itemId),
        isNotNull(shareLinksTable.sentAt),
      ))
      .orderBy(desc(shareLinksTable.createdAt)).limit(100);
    const item = await loadShareItem(itemType, itemId);
    const now = new Date();
    const out = [];
    for (const { link, sentByName } of rows) {
      out.push({
        id: link.id,
        method: link.method,
        recipientInfo: link.recipientInfo,
        sentByName: sentByName ?? "Unknown",
        sentAt: link.sentAt?.toISOString() ?? null,
        expiresAt: link.expiresAt.toISOString(),
        state: shareState(link, item, now),
        openCount: link.openCount,
        lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null,
        canRevoke: !link.revokedAt && await canManageShare(req.user!, link),
      });
    }
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "List share links error");
    res.status(500).json({ error: "server_error" });
  }
});

// POST /share-links/:id/revoke → the link stops working at once. Its sender
// or any approver on the project.
router.post("/share-links/:id/revoke", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const link = (await db.select().from(shareLinksTable)
      .where(and(eq(shareLinksTable.id, req.params.id), eq(shareLinksTable.companyId, req.user!.companyId))).limit(1))[0];
    if (!link) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!(await canManageShare(req.user!, link))) {
      res.status(403).json({ error: "forbidden", message: "Only the person who sent this link or a project approver can stop it." });
      return;
    }
    if (!link.revokedAt) {
      await db.update(shareLinksTable).set({ revokedAt: new Date(), revokedByUserId: req.user!.id })
        .where(eq(shareLinksTable.id, link.id));
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Revoke share link error");
    res.status(500).json({ error: "server_error" });
  }
});

// ── Logged in: access requests ──────────────────────────────────────────────

async function requestView(r: typeof shareAccessRequestsTable.$inferSelect, user: { id: string; role: string }) {
  const link = (await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, r.shareLinkId)).limit(1))[0];
  const item = link ? await loadShareItem(link.itemType as ShareItemType, link.itemId) : null;
  const current = item ? await currentShareItem(item) : null;
  const sender = link?.createdByUserId
    ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, link.createdByUserId)).limit(1))[0]
    : undefined;
  const decider = r.decidedByUserId
    ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.decidedByUserId)).limit(1))[0]
    : undefined;
  const names = await projectAndCompanyNames(r.projectId);
  return {
    id: r.id,
    status: r.status,
    name: r.name,
    email: r.email,
    organisation: r.organisation,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedByName: decider?.name ?? null,
    projectId: r.projectId,
    projectName: names?.projectName ?? "",
    sentByName: sender?.name ?? null,
    requested: item ? { itemType: item.itemType, id: item.id, name: item.name, revisionLabel: item.revisionLabel } : null,
    // What approving sends: the item's current revision (may differ from the
    // one requested), or nothing if no current revision exists.
    willSend: current ? { itemType: current.itemType, id: current.id, name: current.name, revisionLabel: current.revisionLabel } : null,
    canDecide: r.status === "pending" && !!link && await canManageShare(user, link),
  };
}

// GET /share-requests/count → waiting requests in the active company, for the
// sidebar badge and the dashboard's Needs Attention (a missed notification
// must never leave someone waiting). onlyId lets one request open directly.
router.get("/share-requests/count", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const rows = await db.select({ id: shareAccessRequestsTable.id }).from(shareAccessRequestsTable)
      .where(and(eq(shareAccessRequestsTable.companyId, req.user!.companyId), eq(shareAccessRequestsTable.status, "pending")))
      .limit(100);
    res.json({ pending: rows.length, onlyId: rows.length === 1 ? rows[0].id : null });
  } catch (err) {
    req.log.error({ err }, "Count share requests error");
    res.status(500).json({ error: "server_error" });
  }
});

// GET /share-requests?status=pending|all
router.get("/share-requests", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const status = req.query.status === "all" ? null : "pending";
    const rows = await db.select().from(shareAccessRequestsTable)
      .where(and(
        eq(shareAccessRequestsTable.companyId, req.user!.companyId),
        status ? eq(shareAccessRequestsTable.status, status) : undefined,
      ))
      .orderBy(desc(shareAccessRequestsTable.createdAt)).limit(200);
    const out = [];
    for (const r of rows) out.push(await requestView(r, req.user!));
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "List share requests error");
    res.status(500).json({ error: "server_error" });
  }
});

// POST /share-requests/:id/decision { approve: boolean }
router.post("/share-requests/:id/decision", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const approve = req.body?.approve;
    if (typeof approve !== "boolean") {
      res.status(400).json({ error: "validation_error", message: "approve (true or false) required" });
      return;
    }
    const r = (await db.select().from(shareAccessRequestsTable)
      .where(and(eq(shareAccessRequestsTable.id, req.params.id), eq(shareAccessRequestsTable.companyId, req.user!.companyId))).limit(1))[0];
    if (!r) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const link = (await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, r.shareLinkId)).limit(1))[0];
    if (!link || !(await canManageShare(req.user!, link))) {
      res.status(403).json({ error: "forbidden", message: "Only the person who sent the link or a project approver can decide this." });
      return;
    }
    if (r.status !== "pending") {
      res.status(409).json({ error: "already_decided", message: "This request has already been dealt with.", request: await requestView(r, req.user!) });
      return;
    }

    let grantedShareLinkId: string | null = null;
    let token: string | null = null;
    let current = null;
    if (approve) {
      const item = await loadShareItem(link.itemType as ShareItemType, link.itemId);
      current = item ? await currentShareItem(item) : null;
      if (!item || !current || !current.filename) {
        res.status(409).json({ error: "nothing_current", message: "There's no current revision of this to send." });
        return;
      }
      const minted = await mintShareLink({
        companyId: r.companyId, projectId: current.projectId, itemType: current.itemType, itemId: current.id,
        createdByUserId: req.user!.id, method: "request", recipientInfo: `${r.name} <${r.email}>`,
      });
      grantedShareLinkId = minted.link.id;
      token = minted.token;
    }

    // Claim the decision so two approvers acting at once can't both send.
    const claimed = await db.update(shareAccessRequestsTable)
      .set({ status: approve ? "approved" : "declined", decidedByUserId: req.user!.id, decidedAt: new Date(), grantedShareLinkId })
      .where(and(eq(shareAccessRequestsTable.id, r.id), eq(shareAccessRequestsTable.status, "pending")))
      .returning();
    if (!claimed.length) {
      if (grantedShareLinkId) await db.delete(shareLinksTable).where(eq(shareLinksTable.id, grantedShareLinkId));
      const fresh = (await db.select().from(shareAccessRequestsTable).where(eq(shareAccessRequestsTable.id, r.id)).limit(1))[0];
      res.status(409).json({ error: "already_decided", message: "This request has already been dealt with.", request: await requestView(fresh, req.user!) });
      return;
    }

    if (approve && token && current) {
      const names = await projectAndCompanyNames(r.projectId);
      const expiresAt = (await db.select({ e: shareLinksTable.expiresAt }).from(shareLinksTable).where(eq(shareLinksTable.id, grantedShareLinkId!)).limit(1))[0].e;
      await sendShareLinkGrantedEmail({
        to: r.email, name: r.name, itemName: current.name, revisionLabel: current.revisionLabel,
        projectName: names?.projectName ?? "", companyName: names?.companyName ?? "",
        url: `${EMAIL_APP_URL}${sharePath(token)}`, expiresAt, newerThanRequested: current.id !== link.itemId,
      }).catch(err => req.log.warn({ err, requestId: r.id }, "share granted email failed"));
    }
    // The request is dealt with: clear it from everyone else's notifications.
    await db.update(notificationsTable).set({ read: true })
      .where(and(eq(notificationsTable.type, "share_access_requested"), eq(notificationsTable.relatedEntityId, r.id)));
    res.json(await requestView(claimed[0], req.user!));
  } catch (err) {
    req.log.error({ err }, "Share request decision error");
    res.status(500).json({ error: "server_error" });
  }
});

// ── Public: the landing page, the file, and requesting access ───────────────

const NOT_FOUND = { state: "not_found", message: "This link isn't valid. Check you have the whole link, or ask the person who sent it." };

// GET /share/:token → what the landing page shows.
router.get("/share/:token", async (req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const link = await findShareLink(req.params.token);
    if (!link) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const item = await loadShareItem(link.itemType as ShareItemType, link.itemId);
    const state = shareState(link, item);
    const names = await projectAndCompanyNames(link.projectId);
    const sender = link.createdByUserId
      ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, link.createdByUserId)).limit(1))[0]
      : undefined;
    res.json({
      state,
      item: item ? { itemType: item.itemType, name: item.name, revisionLabel: item.revisionLabel, detail: item.detail } : null,
      projectName: names?.projectName ?? null,
      companyName: names?.companyName ?? null,
      sharedBy: sender?.name ?? null,
      sharedAt: (link.sentAt ?? link.createdAt).toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      canRequestAccess: state === "expired" || state === "superseded" || state === "revoked",
    });
  } catch (err) {
    req.log.error({ err }, "Share landing error");
    res.status(500).json({ error: "server_error" });
  }
});

// GET /share/:token/file → the file itself, only while the link is live.
router.get("/share/:token/file", async (req: Request, res: Response) => {
  try {
    const link = await findShareLink(req.params.token);
    if (!link) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const item = await loadShareItem(link.itemType as ShareItemType, link.itemId);
    if (shareState(link, item) !== "ok" || !item?.filename) {
      res.status(410).json({ error: "link_not_live", message: "This link no longer works. Open it again to request access." });
      return;
    }
    await recordShareOpen(link.id);
    await serveUpload(item.filename, req, res);
  } catch (err) {
    req.log.error({ err }, "Share file error");
    if (!res.headersSent) res.status(500).json({ error: "server_error" });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PENDING_PER_LINK = 3;
const MAX_PER_LINK_PER_DAY = 10;

function field(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// POST /share/:token/request-access { name, email, organisation?, note? }
router.post("/share/:token/request-access", async (req: Request, res: Response) => {
  try {
    const link = await findShareLink(req.params.token);
    if (!link) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const item = await loadShareItem(link.itemType as ShareItemType, link.itemId);
    const state = shareState(link, item);
    if (state === "ok") {
      res.status(400).json({ error: "link_works", message: "This link still works, so there's nothing to request." });
      return;
    }
    if (state === "removed") {
      res.status(410).json({ error: "removed", message: "This has been removed, so access can't be requested." });
      return;
    }
    const name = field(req.body?.name, 120);
    const email = field(req.body?.email, 200)?.toLowerCase() ?? null;
    const organisation = field(req.body?.organisation, 160);
    const note = field(req.body?.note, 1000);
    if (!name || !email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "validation_error", message: "Enter your name and a valid email address." });
      return;
    }

    // Asking twice is fine: the same person's pending request just stands.
    const existing = (await db.select({ id: shareAccessRequestsTable.id }).from(shareAccessRequestsTable)
      .where(and(eq(shareAccessRequestsTable.shareLinkId, link.id), eq(shareAccessRequestsTable.email, email), eq(shareAccessRequestsTable.status, "pending"))).limit(1))[0];
    if (existing) {
      res.status(200).json({ ok: true });
      return;
    }
    // A link passed around (or someone hammering it) can't bury the sender in requests.
    const [counts] = await db.select({
      pending: sql<number>`count(*) filter (where ${shareAccessRequestsTable.status} = 'pending')`,
      today: sql<number>`count(*) filter (where ${shareAccessRequestsTable.createdAt} > now() - interval '1 day')`,
    }).from(shareAccessRequestsTable).where(eq(shareAccessRequestsTable.shareLinkId, link.id));
    if (Number(counts.pending) >= MAX_PENDING_PER_LINK || Number(counts.today) >= MAX_PER_LINK_PER_DAY) {
      res.status(429).json({ error: "too_many", message: "Too many requests have been made from this link. Contact the person who sent it." });
      return;
    }

    const id = generateId();
    await db.insert(shareAccessRequestsTable).values({
      id, shareLinkId: link.id, companyId: link.companyId, projectId: link.projectId,
      name, email, organisation, note,
    });

    // The sender, plus every approver on the project (company admins/PMs and
    // per-project PM cover), excluding portal-only accounts.
    const project = (await db.select({ companyId: projectsTable.companyId, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, link.projectId)).limit(1))[0];
    const approvers = project ? await db.selectDistinct({ userId: usersTable.id }).from(usersTable)
      .leftJoin(companyMembersTable, and(eq(companyMembersTable.userId, usersTable.id), eq(companyMembersTable.companyId, project.companyId)))
      .leftJoin(projectMembersTable, and(eq(projectMembersTable.userId, usersTable.id), eq(projectMembersTable.projectId, link.projectId)))
      .where(and(
        eq(usersTable.portalOnly, false),
        or(
          inArray(companyMembersTable.role, ["admin", "project_manager"]),
          eq(projectMembersTable.isProjectManager, true),
        ),
      )) : [];
    const recipients = new Set(approvers.map(a => a.userId));
    if (link.createdByUserId) recipients.add(link.createdByUserId);
    const who = organisation ? `${name} (${organisation})` : name;
    for (const userId of recipients) {
      await db.insert(notificationsTable).values({
        id: generateId(), userId, type: "share_access_requested",
        title: `Access requested: ${item?.name ?? "a shared file"}`,
        message: `${who} opened a link that no longer works and is asking for access.`,
        relatedEntityId: id, relatedEntityType: "share_access_request",
        metadata: { projectId: link.projectId }, read: false,
      });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Share access request error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
