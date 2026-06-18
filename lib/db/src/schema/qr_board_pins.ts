import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const qrBoardPinsTable = pgTable("qr_board_pins", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // 'document' | 'photo' | 'permit' | 'invoice'
  itemId: text("item_id").notNull(),
  pinnedAt: timestamp("pinned_at").notNull().defaultNow(),
}, t => [unique().on(t.projectId, t.itemType, t.itemId)]);
