import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { projectInvitesTable } from "./project_invites";

// Every time an invite link issued before #169 is refused (Dean, 2026-10-23:
// those links were handed to the inviter, so they no longer open; the person
// asks for it to be sent again). One row per attempt, append-only.
export const inviteLinkRefusalsTable = pgTable("invite_link_refusals", {
  id: text("id").primaryKey(),
  inviteId: text("invite_id").notNull().references(() => projectInvitesTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull(),
  // open = the link was opened (GET); accept = someone tried to accept it.
  stage: text("stage").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("invite_link_refusals_invite_idx").on(t.inviteId)]);
