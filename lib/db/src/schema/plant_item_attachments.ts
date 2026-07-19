import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plantItemsTable } from "./plant_items";
import { usersTable } from "./users";

// Documents & photos attached to a plant/materials item (delivery tickets,
// plant certs, test certificates, photos). Flat and append-only — each upload
// is a discrete record, not a version of "the same document" like the main
// project document hub's supersede chain.
export const plantItemAttachmentsTable = pgTable("plant_item_attachments", {
  id: text("id").primaryKey(),
  plantItemId: text("plant_item_id").notNull().references(() => plantItemsTable.id, { onDelete: "cascade" }),
  uploadedBy: text("uploaded_by").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'delivery_ticket'|'certificate'|'test_certificate'|'photo'|'other'
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  itemIdx: index("plant_item_attachments_item_idx").on(t.plantItemId),
}));

export const insertPlantItemAttachmentSchema = createInsertSchema(plantItemAttachmentsTable).omit({ createdAt: true });
export type InsertPlantItemAttachment = z.infer<typeof insertPlantItemAttachmentSchema>;
export type PlantItemAttachment = typeof plantItemAttachmentsTable.$inferSelect;
