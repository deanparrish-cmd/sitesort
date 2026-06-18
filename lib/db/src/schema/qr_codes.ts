import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const qrCodesTable = pgTable("qr_codes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  category: text("category").notNull(),
  token: text("token").notNull().unique(),
  label: text("label").notNull(),
  requiresLogin: boolean("requires_login").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQrCodeSchema = createInsertSchema(qrCodesTable).omit({ createdAt: true });
export type InsertQrCode = z.infer<typeof insertQrCodeSchema>;
export type QrCode = typeof qrCodesTable.$inferSelect;
