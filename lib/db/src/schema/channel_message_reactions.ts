import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { channelMessagesTable } from "./channel_messages";
import { usersTable } from "./users";

export const channelMessageReactionsTable = pgTable("channel_message_reactions", {
  id: text("id").primaryKey(),
  channelMessageId: text("channel_message_id").notNull().references(() => channelMessagesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.channelMessageId, t.userId, t.emoji)]);

export type ChannelMessageReaction = typeof channelMessageReactionsTable.$inferSelect;
