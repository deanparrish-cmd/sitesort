import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const shareLogsTable = pgTable("share_logs", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  entityType: text("entity_type").notNull(), // document | photo | permit | invoice | certificate
  entityId: text("entity_id").notNull(),
  entityName: text("entity_name").notNull(),
  method: text("method").notNull(), // email | whatsapp | team
  recipientInfo: text("recipient_info"),
  sentByUserId: text("sent_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
