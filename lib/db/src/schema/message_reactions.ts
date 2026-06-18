import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { messagesTable } from "./messages";
import { usersTable } from "./users";

export const messageReactionsTable = pgTable("message_reactions", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.messageId, t.userId, t.emoji)]);

export type MessageReaction = typeof messageReactionsTable.$inferSelect;
