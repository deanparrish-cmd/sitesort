import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// Tracks the last time a user read a project channel — used to compute unread counts
export const channelReadsTable = pgTable("channel_reads", {
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  userId: text("user_id").notNull().references(() => usersTable.id),
  lastReadAt: timestamp("last_read_at").notNull(),
});

export type ChannelRead = typeof channelReadsTable.$inferSelect;
