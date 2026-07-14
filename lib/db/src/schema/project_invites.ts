import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
import { peopleTable } from "./people";

// Team Portal invites (Feature: Team Portal). A PM invites a worker to ONE
// project by name + email. The raw invite token is shown to the PM as a
// copyable link and is NEVER stored — only its sha256 hash lives here, so a DB
// leak can't be replayed into a valid link. Single-use (status flips to
// "accepted") and time-boxed (expiresAt, 7 days). "sending" is deferred: for now
// the PM copies the link; an email provider slots into the same create path.
export const projectInvitesTable = pgTable("project_invites", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  // The individual person this invite is for. Portal invites now originate from
  // a `people` row (subcontractor person or in-house member). Nullable so legacy
  // rows created before the per-person restructure remain valid. email/name are
  // kept denormalised for display and for the pre-account accept flow.
  personId: text("person_id").references(() => peopleTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").notNull(),
  // sha256 hex of the raw single-use token (never store the raw token).
  tokenHash: text("token_hash").notNull(),
  // project_members role vocab: worker | manager | subcontractor.
  role: text("role").notNull().default("worker"),
  // pending | accepted | revoked.
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  invitedByUserId: text("invited_by_user_id").notNull().references(() => usersTable.id),
  acceptedUserId: text("accepted_user_id").references(() => usersTable.id),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProjectInvite = typeof projectInvitesTable.$inferSelect;
