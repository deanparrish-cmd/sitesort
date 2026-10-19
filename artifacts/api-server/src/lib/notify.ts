import { db } from "@workspace/db";
import { notificationsTable, projectsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

// Every notification belongs to one company, and the bell shows only the
// company the user is signed into, whatever their role elsewhere (2026-10-19:
// Amy saw Acme fire-roll alerts while working in Test SiteSort). Pass the
// companyId, or the projectId and the company is taken from the project.
type Row = typeof notificationsTable.$inferInsert;
export type NewNotification = Omit<Row, "companyId"> & ({ companyId: string; projectId?: never } | { projectId: string; companyId?: never });
type Executor = Pick<typeof db, "select" | "insert">;

export async function insertNotifications(input: NewNotification | NewNotification[], ex: Executor = db): Promise<void> {
  const rows = Array.isArray(input) ? input : [input];
  if (rows.length === 0) return;
  const projectIds = [...new Set(rows.flatMap(r => ("projectId" in r && r.projectId ? [r.projectId] : [])))];
  const companyOf = new Map<string, string>();
  if (projectIds.length) {
    const projects = await ex.select({ id: projectsTable.id, companyId: projectsTable.companyId }).from(projectsTable).where(inArray(projectsTable.id, projectIds));
    for (const p of projects) companyOf.set(p.id, p.companyId);
  }
  const values: Row[] = [];
  for (const r of rows) {
    const { projectId, companyId, ...rest } = r as NewNotification & { projectId?: string; companyId?: string };
    const company = companyId ?? (projectId ? companyOf.get(projectId) : undefined);
    if (!company) { logger.warn({ type: rest.type, projectId }, "notification skipped: no company"); continue; }
    values.push({ ...rest, companyId: company });
  }
  if (values.length) await ex.insert(notificationsTable).values(values);
}
