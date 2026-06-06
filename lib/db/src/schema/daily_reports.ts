import { pgTable, text, timestamp, integer, jsonb, index, unique } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export type DailyReportData = {
  subcontractorsOnSite: {
    id: string;
    workerName: string;
    checkedInAt: string;
    photoUrl: string | null;
  }[];
  documentActivity: {
    uploaded: { documentId: string; name: string; type: string; version: number; uploaderName: string; at: string }[];
    amended: { documentId: string; name: string; type: string; version: number; uploaderName: string; at: string }[];
    viewed: { documentId: string; documentName: string; userName: string; at: string }[];
    signedOff: {
      documentId: string;
      documentName: string;
      documentVersion: number;
      userName: string;
      userRole: string;
      signedOffWithPin: boolean;
      at: string;
    }[];
  };
  sitePhotos: {
    id: string;
    referenceNumber: string;
    category: string;
    description: string | null;
    zone: string | null;
    uploaderName: string;
    photoUrl: string | null;
    takenAt: string;
  }[];
};

// One immutable end-of-day snapshot per project per day. The collated activity is
// frozen into `data` (jsonb) at generation time so the report stays accurate even
// if underlying records change later.
export const dailyReportsTable = pgTable("daily_reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // YYYY-MM-DD in Europe/London (the day the report covers).
  reportDate: text("report_date").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  checkinCount: integer("checkin_count").notNull().default(0),
  documentEventCount: integer("document_event_count").notNull().default(0),
  photoCount: integer("photo_count").notNull().default(0),
  data: jsonb("data").$type<DailyReportData>().notNull(),
}, (t) => [
  unique("daily_reports_project_date_uq").on(t.projectId, t.reportDate),
  index("daily_reports_project_idx").on(t.projectId),
]);

export type DailyReport = typeof dailyReportsTable.$inferSelect;
