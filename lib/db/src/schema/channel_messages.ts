import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const channelMessagesTable = pgTable("channel_messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  senderId: text("sender_id").notNull().references(() => usersTable.id),
  content: text("content").notNull().default(""),
  attachmentType: text("attachment_type"),
  attachmentId: text("attachment_id"),
  replyToId: text("reply_to_id"),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ChannelMessage = typeof channelMessagesTable.$inferSelect;
