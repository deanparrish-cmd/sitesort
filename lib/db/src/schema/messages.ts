import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

export const messagesTable = pgTable("messages", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  senderId: text("sender_id").notNull().references(() => usersTable.id),
  recipientId: text("recipient_id").notNull().references(() => usersTable.id),
  content: text("content").notNull(),
  readAt: timestamp("read_at"),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
