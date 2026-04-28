import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  companiesTable,
  documentsTable,
  documentDistributionsTable,
  permitsTable,
  insuranceRecordsTable,
  qrCodesTable,
  photosTable,
  notificationsTable,
  projectsTable,
  subcontractorsTable,
} from "@workspace/db/schema";
import { eq, gte, lt, and, desc, sql, count, isNotNull, inArray } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const ADMIN_EMAIL = "dean.parrish@me.com";

const router: IRouter = Router();

function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const req = _req as Request & { user?: { email: string } };
  if (req.user?.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
    return;
  }
  next();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function pct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

async function n(query: Promise<{ count: unknown }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.count ?? 0);
}

router.get("/admin/stats", authenticate, requireAdmin, async (req, res) => {
  try {
    const todayStart = daysAgo(0);
    const weekAgo = daysAgo(7);
    const twoWeeksAgo = daysAgo(14);
    const thirtyDaysAgo = daysAgo(30);
    const sevenPlusAgo = daysAgo(7);

    const [
      totalUsers, newThisWeek, newLastWeek, activeThisWeek, activeToday,
      totalCompanies,

      docsAll, docsWeek, docsLastWeek, docsToday,
      signOffsAll, signOffsWeek, signOffsLastWeek, signOffsToday,
      permitsAll, permitsWeek, permitsLastWeek, permitsToday,
      insuranceAll, insuranceWeek, insuranceLastWeek, insuranceToday,
      qrAll, qrWeek, qrLastWeek, qrToday,
      photosAll, photosWeek, photosLastWeek, photosToday,

      notifAll, notifWeek, notifLastWeek,
      projectsAll, projectsWeek, projectsLastWeek,
    ] = await Promise.all([
      // User counts
      n(db.select({ count: count() }).from(usersTable)),
      n(db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(usersTable).where(and(gte(usersTable.createdAt, twoWeeksAgo), lt(usersTable.createdAt, weekAgo)))),
      n(db.select({ count: count() }).from(usersTable).where(gte(usersTable.lastActiveAt, weekAgo))),
      n(db.select({ count: count() }).from(usersTable).where(gte(usersTable.lastActiveAt, todayStart))),
      n(db.select({ count: count() }).from(companiesTable)),

      // Documents
      n(db.select({ count: count() }).from(documentsTable)),
      n(db.select({ count: count() }).from(documentsTable).where(gte(documentsTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(documentsTable).where(and(gte(documentsTable.createdAt, twoWeeksAgo), lt(documentsTable.createdAt, weekAgo)))),
      n(db.select({ count: count() }).from(documentsTable).where(gte(documentsTable.createdAt, todayStart))),

      // Sign-offs (acknowledged distributions)
      n(db.select({ count: count() }).from(documentDistributionsTable).where(isNotNull(documentDistributionsTable.acknowledgedAt))),
      n(db.select({ count: count() }).from(documentDistributionsTable).where(and(isNotNull(documentDistributionsTable.acknowledgedAt), gte(documentDistributionsTable.acknowledgedAt, weekAgo)))),
      n(db.select({ count: count() }).from(documentDistributionsTable).where(and(isNotNull(documentDistributionsTable.acknowledgedAt), gte(documentDistributionsTable.acknowledgedAt, twoWeeksAgo), lt(documentDistributionsTable.acknowledgedAt, weekAgo)))),
      n(db.select({ count: count() }).from(documentDistributionsTable).where(and(isNotNull(documentDistributionsTable.acknowledgedAt), gte(documentDistributionsTable.acknowledgedAt, todayStart)))),

      // Permits
      n(db.select({ count: count() }).from(permitsTable)),
      n(db.select({ count: count() }).from(permitsTable).where(gte(permitsTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(permitsTable).where(and(gte(permitsTable.createdAt, twoWeeksAgo), lt(permitsTable.createdAt, weekAgo)))),
      n(db.select({ count: count() }).from(permitsTable).where(gte(permitsTable.createdAt, todayStart))),

      // Insurance
      n(db.select({ count: count() }).from(insuranceRecordsTable)),
      n(db.select({ count: count() }).from(insuranceRecordsTable).where(gte(insuranceRecordsTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(insuranceRecordsTable).where(and(gte(insuranceRecordsTable.createdAt, twoWeeksAgo), lt(insuranceRecordsTable.createdAt, weekAgo)))),
      n(db.select({ count: count() }).from(insuranceRecordsTable).where(gte(insuranceRecordsTable.createdAt, todayStart))),

      // QR codes
      n(db.select({ count: count() }).from(qrCodesTable)),
      n(db.select({ count: count() }).from(qrCodesTable).where(gte(qrCodesTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(qrCodesTable).where(and(gte(qrCodesTable.createdAt, twoWeeksAgo), lt(qrCodesTable.createdAt, weekAgo)))),
      n(db.select({ count: count() }).from(qrCodesTable).where(gte(qrCodesTable.createdAt, todayStart))),

      // Photos
      n(db.select({ count: count() }).from(photosTable)),
      n(db.select({ count: count() }).from(photosTable).where(gte(photosTable.takenAt, weekAgo))),
      n(db.select({ count: count() }).from(photosTable).where(and(gte(photosTable.takenAt, twoWeeksAgo), lt(photosTable.takenAt, weekAgo)))),
      n(db.select({ count: count() }).from(photosTable).where(gte(photosTable.takenAt, todayStart))),

      // Notifications (secondary: messages)
      n(db.select({ count: count() }).from(notificationsTable)),
      n(db.select({ count: count() }).from(notificationsTable).where(gte(notificationsTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(notificationsTable).where(and(gte(notificationsTable.createdAt, twoWeeksAgo), lt(notificationsTable.createdAt, weekAgo)))),

      // Projects (secondary: project creation)
      n(db.select({ count: count() }).from(projectsTable)),
      n(db.select({ count: count() }).from(projectsTable).where(gte(projectsTable.createdAt, weekAgo))),
      n(db.select({ count: count() }).from(projectsTable).where(and(gte(projectsTable.createdAt, twoWeeksAgo), lt(projectsTable.createdAt, weekAgo)))),
    ]);

    const primaryAll = docsAll + signOffsAll + permitsAll + insuranceAll + qrAll + photosAll;
    const primaryWeek = docsWeek + signOffsWeek + permitsWeek + insuranceWeek + qrWeek + photosWeek;
    const primaryLastWeek = docsLastWeek + signOffsLastWeek + permitsLastWeek + insuranceLastWeek + qrLastWeek + photosLastWeek;
    const primaryToday = docsToday + signOffsToday + permitsToday + insuranceToday + qrToday + photosToday;

    // Retention (approximate from lastActiveAt vs createdAt)
    const eligibleForDay1 = await db.select({
      id: usersTable.id,
      createdAt: usersTable.createdAt,
      lastActiveAt: usersTable.lastActiveAt,
    }).from(usersTable).where(isNotNull(usersTable.lastActiveAt));

    let day1Count = 0;
    let week1Count = 0;
    let day1Eligible = 0;
    let week1Eligible = 0;

    for (const u of eligibleForDay1) {
      if (!u.lastActiveAt) continue;
      const msSinceCreation = u.lastActiveAt.getTime() - u.createdAt.getTime();
      const daysSinceCreation = (Date.now() - u.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation >= 1) {
        day1Eligible++;
        if (msSinceCreation >= 86400000) day1Count++;
      }
      if (daysSinceCreation >= 7) {
        week1Eligible++;
        if (msSinceCreation >= 7 * 86400000) week1Count++;
      }
    }

    const day1Retention = day1Eligible > 0 ? Math.round((day1Count / day1Eligible) * 100) : 0;
    const week1Retention = week1Eligible > 0 ? Math.round((week1Count / week1Eligible) * 100) : 0;

    // At-risk users: active in past 14 days but not in last 7
    const atRiskUsers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      lastActiveAt: usersTable.lastActiveAt,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(and(
      isNotNull(usersTable.lastActiveAt),
      lt(usersTable.lastActiveAt, sevenPlusAgo),
      gte(usersTable.lastActiveAt, thirtyDaysAgo),
    )).orderBy(desc(usersTable.lastActiveAt)).limit(10);

    // Funnel: signups → first action → return visit → power user
    const usersWithDoc = await db.select({ uploadedBy: documentsTable.uploadedBy })
      .from(documentsTable)
      .groupBy(documentsTable.uploadedBy);
    const usersWithPhoto = await db.select({ uploadedBy: photosTable.uploadedBy })
      .from(photosTable)
      .groupBy(photosTable.uploadedBy);

    const firstActionUserIds = new Set([
      ...usersWithDoc.map(r => r.uploadedBy),
      ...usersWithPhoto.map(r => r.uploadedBy),
    ]);

    const returnVisitUsers = await db.select({ id: usersTable.id }).from(usersTable).where(and(
      isNotNull(usersTable.lastActiveAt),
      sql`EXTRACT(EPOCH FROM (${usersTable.lastActiveAt} - ${usersTable.createdAt})) > 86400`,
    ));

    // Power users: users who uploaded 5+ docs or photos
    const docCounts = await db.select({
      uploadedBy: documentsTable.uploadedBy,
      c: count(),
    }).from(documentsTable).groupBy(documentsTable.uploadedBy);
    const powerUserIds = new Set(docCounts.filter(r => Number(r.c) >= 5).map(r => r.uploadedBy));

    // Feature usage (by table count, unique users where available)
    const [subAll] = await db.select({ count: count() }).from(subcontractorsTable);

    const featureUsage = [
      { name: "Document Hub", count: docsAll, icon: "FileText" },
      { name: "Digital Sign-offs", count: signOffsAll, icon: "PenLine" },
      { name: "Permit Tracking", count: permitsAll, icon: "ClipboardCheck" },
      { name: "Insurance Monitor", count: insuranceAll, icon: "ShieldCheck" },
      { name: "QR Site Boards", count: qrAll, icon: "QrCode" },
      { name: "Photo Log", count: photosAll, icon: "Camera" },
      { name: "Projects", count: projectsAll, icon: "Building2" },
      { name: "Notifications", count: notifAll, icon: "Bell" },
      { name: "Subcontractors", count: Number(subAll.count), icon: "HardHat" },
    ].sort((a, b) => b.count - a.count);

    // Top 10 users by doc + photo activity
    const allDocUploads = await db.select({
      userId: documentsTable.uploadedBy,
      c: count(),
    }).from(documentsTable).groupBy(documentsTable.uploadedBy);

    const allPhotoUploads = await db.select({
      userId: photosTable.uploadedBy,
      c: count(),
    }).from(photosTable).groupBy(photosTable.uploadedBy);

    const userActionMap: Record<string, number> = {};
    for (const r of allDocUploads) userActionMap[r.userId] = (userActionMap[r.userId] ?? 0) + Number(r.c);
    for (const r of allPhotoUploads) userActionMap[r.userId] = (userActionMap[r.userId] ?? 0) + Number(r.c);

    const topUserIds = Object.entries(userActionMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    const topUsersData = topUserIds.length > 0
      ? await db.select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          createdAt: usersTable.createdAt,
          lastActiveAt: usersTable.lastActiveAt,
        }).from(usersTable).where(inArray(usersTable.id, topUserIds))
      : [];

    const topUsers = topUsersData
      .map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        signupDate: u.createdAt.toISOString(),
        totalActions: userActionMap[u.id] ?? 0,
        lastActive: u.lastActiveAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.totalActions - a.totalActions);

    // Company breakdown by subscription tier
    const companiesByTier = await db.select({
      tier: companiesTable.subscriptionTier,
      c: count(),
    }).from(companiesTable).groupBy(companiesTable.subscriptionTier);

    // Alerts
    const alerts: Array<{ level: "green" | "yellow" | "red"; message: string }> = [];
    if (activeToday === 0) alerts.push({ level: "yellow", message: "No active users today yet" });
    if (newThisWeek === 0) alerts.push({ level: "yellow", message: "No new signups in the past 7 days" });
    if (primaryWeek > 0 && primaryLastWeek > 0 && pct(primaryWeek, primaryLastWeek) < -30) {
      alerts.push({ level: "red", message: `Activity dropped ${Math.abs(pct(primaryWeek, primaryLastWeek))}% vs last week` });
    }
    if (alerts.length === 0) alerts.push({ level: "green", message: "All systems healthy" });

    // Time to first action (average hours from signup to first doc upload)
    const usersWithFirstDoc = await db.select({
      userId: documentsTable.uploadedBy,
      firstDoc: sql<string>`MIN(${documentsTable.createdAt})`.as("first_doc"),
    }).from(documentsTable).groupBy(documentsTable.uploadedBy).limit(50);

    let totalHoursToFirstAction = 0;
    let firstActionCount = 0;
    for (const r of usersWithFirstDoc) {
      const userRows = await db.select({ createdAt: usersTable.createdAt })
        .from(usersTable).where(eq(usersTable.id, r.userId)).limit(1);
      if (userRows[0]) {
        const hours = (new Date(r.firstDoc).getTime() - userRows[0].createdAt.getTime()) / 3600000;
        if (hours >= 0 && hours < 720) { // ignore outliers > 30 days
          totalHoursToFirstAction += hours;
          firstActionCount++;
        }
      }
    }
    const avgHoursToFirstAction = firstActionCount > 0
      ? Math.round((totalHoursToFirstAction / firstActionCount) * 10) / 10
      : null;

    res.json({
      generatedAt: new Date().toISOString(),
      alerts,
      userMetrics: {
        totalUsers,
        newThisWeek,
        newLastWeek,
        newThisWeekPct: pct(newThisWeek, newLastWeek),
        activeThisWeek,
        activeToday,
        totalCompanies,
      },
      primaryActions: {
        total: { allTime: primaryAll, thisWeek: primaryWeek, lastWeek: primaryLastWeek, today: primaryToday, pctChange: pct(primaryWeek, primaryLastWeek), perUser: totalUsers > 0 ? Math.round((primaryAll / totalUsers) * 10) / 10 : 0 },
        documents: { allTime: docsAll, thisWeek: docsWeek, lastWeek: docsLastWeek, today: docsToday, pctChange: pct(docsWeek, docsLastWeek) },
        signOffs: { allTime: signOffsAll, thisWeek: signOffsWeek, lastWeek: signOffsLastWeek, today: signOffsToday, pctChange: pct(signOffsWeek, signOffsLastWeek) },
        permits: { allTime: permitsAll, thisWeek: permitsWeek, lastWeek: permitsLastWeek, today: permitsToday, pctChange: pct(permitsWeek, permitsLastWeek) },
        insurance: { allTime: insuranceAll, thisWeek: insuranceWeek, lastWeek: insuranceLastWeek, today: insuranceToday, pctChange: pct(insuranceWeek, insuranceLastWeek) },
        qrCodes: { allTime: qrAll, thisWeek: qrWeek, lastWeek: qrLastWeek, today: qrToday, pctChange: pct(qrWeek, qrLastWeek) },
        photos: { allTime: photosAll, thisWeek: photosWeek, lastWeek: photosLastWeek, today: photosToday, pctChange: pct(photosWeek, photosLastWeek) },
      },
      secondaryActions: {
        notifications: { allTime: notifAll, thisWeek: notifWeek, lastWeek: notifLastWeek, pctChange: pct(notifWeek, notifLastWeek) },
        projects: { allTime: projectsAll, thisWeek: projectsWeek, lastWeek: projectsLastWeek, pctChange: pct(projectsWeek, projectsLastWeek) },
        signUps: { allTime: totalUsers, thisWeek: newThisWeek, lastWeek: newLastWeek, pctChange: pct(newThisWeek, newLastWeek) },
      },
      revenue: {
        note: "No payment processor connected — showing subscription tier data",
        totalCompanies,
        byTier: Object.fromEntries(companiesByTier.map(r => [r.tier, Number(r.c)])),
        paidTiers: companiesByTier.filter(r => r.tier !== "free").reduce((s, r) => s + Number(r.c), 0),
      },
      retention: {
        day1: day1Retention,
        week1: week1Retention,
        atRiskUsers: atRiskUsers.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
      },
      funnel: {
        signups: totalUsers,
        firstAction: firstActionUserIds.size,
        returnVisit: returnVisitUsers.length,
        powerUser: powerUserIds.size,
      },
      speedMetrics: {
        avgHoursToFirstAction,
      },
      featureUsage,
      topUsers,
    });
  } catch (err) {
    req.log.error({ err }, "Admin stats error");
    res.status(500).json({ error: "server_error", message: "Failed to load admin stats" });
  }
});

router.get("/admin/chart-data", authenticate, requireAdmin, async (req, res) => {
  try {
    const thirtyDaysAgo = daysAgo(30);

    const [usersPerDay, docsPerDay, activityByDow, activityByHour] = await Promise.all([
      db.select({
        date: sql<string>`(date_trunc('day', ${usersTable.createdAt}))::date`.as("date"),
        count: count(),
      }).from(usersTable)
        .where(gte(usersTable.createdAt, thirtyDaysAgo))
        .groupBy(sql`date_trunc('day', ${usersTable.createdAt})`)
        .orderBy(sql`date_trunc('day', ${usersTable.createdAt})`),

      db.select({
        date: sql<string>`(date_trunc('day', ${documentsTable.createdAt}))::date`.as("date"),
        count: count(),
      }).from(documentsTable)
        .where(gte(documentsTable.createdAt, thirtyDaysAgo))
        .groupBy(sql`date_trunc('day', ${documentsTable.createdAt})`)
        .orderBy(sql`date_trunc('day', ${documentsTable.createdAt})`),

      db.select({
        dow: sql<number>`EXTRACT(DOW FROM ${documentsTable.createdAt})`.as("dow"),
        count: count(),
      }).from(documentsTable)
        .groupBy(sql`EXTRACT(DOW FROM ${documentsTable.createdAt})`)
        .orderBy(sql`EXTRACT(DOW FROM ${documentsTable.createdAt})`),

      db.select({
        hour: sql<number>`EXTRACT(HOUR FROM ${documentsTable.createdAt})`.as("hour"),
        count: count(),
      }).from(documentsTable)
        .groupBy(sql`EXTRACT(HOUR FROM ${documentsTable.createdAt})`)
        .orderBy(sql`EXTRACT(HOUR FROM ${documentsTable.createdAt})`),
    ]);

    // Fill in zeros for missing days in last 30 days
    const usersMap = new Map(usersPerDay.map(r => [String(r.date), Number(r.count)]));
    const docsMap = new Map(docsPerDay.map(r => [String(r.date), Number(r.count)]));
    const days: Array<{ date: string; users: number; documents: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = daysAgo(i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, users: usersMap.get(key) ?? 0, documents: docsMap.get(key) ?? 0 });
    }

    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const byDow = dowNames.map((name, i) => ({
      name,
      count: Number(activityByDow.find(r => Number(r.dow) === i)?.count ?? 0),
    }));

    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
      count: Number(activityByHour.find(r => Number(r.hour) === h)?.count ?? 0),
    }));

    res.json({ days, byDow, byHour });
  } catch (err) {
    req.log.error({ err }, "Admin chart data error");
    res.status(500).json({ error: "server_error", message: "Failed to load chart data" });
  }
});

router.get("/admin/activity", authenticate, requireAdmin, async (req, res) => {
  try {
    const [recentDocs, recentSignOffs, recentPermits, recentQr, recentPhotos, recentUsers, recentInsurance] = await Promise.all([
      db.select({
        id: documentsTable.id,
        userId: documentsTable.uploadedBy,
        detail: documentsTable.name,
        subDetail: documentsTable.type,
        ts: documentsTable.createdAt,
      }).from(documentsTable).orderBy(desc(documentsTable.createdAt)).limit(20),

      db.select({
        id: documentDistributionsTable.id,
        userId: documentDistributionsTable.userId,
        detail: sql<string>`'Sign-off'`.as("detail"),
        subDetail: documentDistributionsTable.documentId,
        ts: documentDistributionsTable.acknowledgedAt,
      }).from(documentDistributionsTable)
        .where(isNotNull(documentDistributionsTable.acknowledgedAt))
        .orderBy(desc(documentDistributionsTable.acknowledgedAt)).limit(20),

      db.select({
        id: permitsTable.id,
        userId: permitsTable.responsibleUserId,
        detail: permitsTable.type,
        subDetail: permitsTable.description,
        ts: permitsTable.createdAt,
      }).from(permitsTable).orderBy(desc(permitsTable.createdAt)).limit(20),

      db.select({
        id: qrCodesTable.id,
        userId: sql<string>`''`.as("userId"),
        detail: qrCodesTable.label,
        subDetail: qrCodesTable.category,
        ts: qrCodesTable.createdAt,
      }).from(qrCodesTable).orderBy(desc(qrCodesTable.createdAt)).limit(20),

      db.select({
        id: photosTable.id,
        userId: photosTable.uploadedBy,
        detail: photosTable.category,
        subDetail: photosTable.referenceNumber,
        ts: photosTable.takenAt,
      }).from(photosTable).orderBy(desc(photosTable.takenAt)).limit(20),

      db.select({
        id: usersTable.id,
        userId: usersTable.id,
        detail: usersTable.name,
        subDetail: usersTable.email,
        ts: usersTable.createdAt,
      }).from(usersTable).orderBy(desc(usersTable.createdAt)).limit(20),

      db.select({
        id: insuranceRecordsTable.id,
        userId: sql<string>`''`.as("userId"),
        detail: insuranceRecordsTable.type,
        subDetail: insuranceRecordsTable.expiryDate,
        ts: insuranceRecordsTable.createdAt,
      }).from(insuranceRecordsTable).orderBy(desc(insuranceRecordsTable.createdAt)).limit(20),
    ]);

    // Collect all user IDs to resolve names in one batch
    const allUserIds = [...new Set([
      ...recentDocs.map(r => r.userId),
      ...recentSignOffs.map(r => r.userId),
      ...recentPermits.map(r => r.userId),
      ...recentPhotos.map(r => r.userId),
      ...recentUsers.map(r => r.userId),
    ].filter(Boolean))];

    const userRows = allUserIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, allUserIds))
      : [];
    const userMap = new Map(userRows.map(u => [u.id, u.name]));

    const combined = [
      ...recentDocs.map(r => ({ id: r.id, type: "Document uploaded", userName: userMap.get(r.userId) ?? "Unknown", detail: r.detail, subDetail: r.subDetail, ts: r.ts!.toISOString() })),
      ...recentSignOffs.map(r => ({ id: r.id, type: "Sign-off completed", userName: userMap.get(r.userId) ?? "Unknown", detail: r.detail, subDetail: r.subDetail, ts: (r.ts as Date | null)?.toISOString() ?? "" })),
      ...recentPermits.map(r => ({ id: r.id, type: "Permit created", userName: userMap.get(r.userId) ?? "Unknown", detail: r.detail, subDetail: r.subDetail, ts: r.ts!.toISOString() })),
      ...recentQr.map(r => ({ id: r.id, type: "QR code generated", userName: "—", detail: r.detail, subDetail: r.subDetail, ts: r.ts!.toISOString() })),
      ...recentPhotos.map(r => ({ id: r.id, type: "Photo uploaded", userName: userMap.get(r.userId) ?? "Unknown", detail: r.detail, subDetail: r.subDetail, ts: r.ts!.toISOString() })),
      ...recentUsers.map(r => ({ id: r.id, type: "User registered", userName: r.detail, detail: r.detail, subDetail: r.subDetail, ts: r.ts!.toISOString() })),
      ...recentInsurance.map(r => ({ id: r.id, type: "Insurance uploaded", userName: "—", detail: r.detail, subDetail: String(r.subDetail), ts: r.ts!.toISOString() })),
    ].filter(r => r.ts).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 50);

    res.json(combined);
  } catch (err) {
    req.log.error({ err }, "Admin activity error");
    res.status(500).json({ error: "server_error", message: "Failed to load activity" });
  }
});

router.get("/admin/export/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      emailVerified: usersTable.emailVerified,
      createdAt: usersTable.createdAt,
      lastActiveAt: usersTable.lastActiveAt,
      companyId: usersTable.companyId,
    }).from(usersTable).orderBy(desc(usersTable.createdAt));

    const header = "id,name,email,role,emailVerified,createdAt,lastActiveAt,companyId\n";
    const rows = users.map(u =>
      [u.id, `"${u.name}"`, u.email, u.role, u.emailVerified, u.createdAt.toISOString(), u.lastActiveAt?.toISOString() ?? "", u.companyId].join(",")
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sitesort-users.csv");
    res.send(header + rows);
  } catch (err) {
    req.log.error({ err }, "Admin export users error");
    res.status(500).json({ error: "server_error", message: "Export failed" });
  }
});

router.get("/admin/export/activity", authenticate, requireAdmin, async (req, res) => {
  try {
    const docs = await db.select({
      type: sql<string>`'document'`,
      id: documentsTable.id,
      userId: documentsTable.uploadedBy,
      detail: documentsTable.name,
      subDetail: documentsTable.type,
      ts: documentsTable.createdAt,
    }).from(documentsTable).orderBy(desc(documentsTable.createdAt)).limit(500);

    const permits = await db.select({
      type: sql<string>`'permit'`,
      id: permitsTable.id,
      userId: permitsTable.responsibleUserId,
      detail: permitsTable.type,
      subDetail: permitsTable.description,
      ts: permitsTable.createdAt,
    }).from(permitsTable).orderBy(desc(permitsTable.createdAt)).limit(500);

    const combined = [...docs, ...permits].sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, 1000);

    const header = "type,id,userId,detail,subDetail,timestamp\n";
    const rows = combined.map(r =>
      [r.type, r.id, r.userId, `"${r.detail}"`, `"${r.subDetail}"`, r.ts.toISOString()].join(",")
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sitesort-activity.csv");
    res.send(header + rows);
  } catch (err) {
    req.log.error({ err }, "Admin export activity error");
    res.status(500).json({ error: "server_error", message: "Export failed" });
  }
});

export default router;
