import { pool } from "@workspace/db";
import { logger } from "./logger";

// Idempotent boot migration. The PRODUCTION database is separate from the dev
// workspace and `drizzle push` is NOT part of the deploy, so a newly-deployed
// build could query company_members before that table exists. Creating it (and
// backfilling one membership per existing user) on every boot guarantees the
// membership-aware login path always has its table. Safe to run repeatedly.
export async function ensureSchema(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_members (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'site_worker',
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT company_members_user_company_unique UNIQUE (user_id, company_id)
      )
    `);
    await pool.query(`
      INSERT INTO company_members (id, user_id, company_id, role)
      SELECT gen_random_uuid()::text, id, company_id, role FROM users
      ON CONFLICT (user_id, company_id) DO NOTHING
    `);
    // Tracks which expiry-reminder emails (30/21/14/7/1 days + expired daily) have
    // been sent, so the daily job fires each milestone exactly once. New table →
    // must exist in prod before the reminder job runs, hence created here too.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expiry_reminder_logs (
        id text PRIMARY KEY,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        milestone text NOT NULL,
        sent_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT expiry_reminder_logs_entity_milestone_uq UNIQUE (entity_type, entity_id, milestone)
      )
    `);
    // Dedup ledger for Stripe webhook deliveries — the webhook claims each event
    // id here (ON CONFLICT DO NOTHING) and skips duplicates/retries so a redelivered
    // event can't create duplicate subscriptions/charges. New table → must exist in
    // prod before the webhook runs, hence created here too.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id text PRIMARY KEY,
        type text NOT NULL,
        received_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Optional photo attached to a daily-note "site update" (B1 fix). New column →
    // must exist in prod before the daily-notes insert references it.
    await pool.query(`ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS photo_url text`);
    // Assignment & accountability (F1) — assignee + due date on site issues (photos).
    await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS assigned_to_user_id text`);
    await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS due_date date`);
    // F1 Phase 2 — permits reuse responsible_user_id as the assignee; add the
    // (optional) action deadline. Overdue is derived (due_date < today && not archived).
    await pool.query(`ALTER TABLE permits ADD COLUMN IF NOT EXISTS due_date date`);
    // F1 Phase 3 — insurance certs get an explicit assignee + (optional) action
    // deadline (no pre-existing responsible field). Overdue is derived likewise.
    await pool.query(`ALTER TABLE insurance_records ADD COLUMN IF NOT EXISTS assigned_to_user_id text`);
    await pool.query(`ALTER TABLE insurance_records ADD COLUMN IF NOT EXISTS due_date date`);
    // F3 — alphabetical drawing revision label on documents (drawings default
    // A/B/C… by version, editable to match the title block).
    await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS revision text`);
    // F2 — project close-out / handover sign-off (append-only audit). New table →
    // must exist in prod before the close-out endpoints run.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_closeouts (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        signed_off_by_user_id text NOT NULL REFERENCES users(id),
        signed_off_by_name text NOT NULL,
        signed_off_by_role text NOT NULL,
        note text,
        ip_address text,
        user_agent text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Email verification — registration now sends a verification link and only
    // marks the account verified once it's clicked, so the register handler writes
    // these columns. email_verified already exists in prod (the login gate reads
    // it, so the ALTER no-ops and existing verified users are untouched); the
    // token/expiry columns may not, hence add them here before register uses them.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token text`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expiry timestamp`);
    // Team Portal — portal-only member accounts (invited into a single project).
    // The main /auth/login rejects these; portal login accepts only these.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_only boolean NOT NULL DEFAULT false`);
    // Team Portal — a user is a member of a project at most once. Partial unique
    // index (skips subcontractor-only rows where user_id IS NULL). Must exist
    // before invite-accept relies on ON CONFLICT semantics / duplicate guards.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_uq
      ON project_members (project_id, user_id) WHERE user_id IS NOT NULL
    `);
    // Team Portal — single-use, time-boxed project invites. Only the token HASH
    // is stored. New table → must exist in prod before the invite endpoints run.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_invites (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email text NOT NULL,
        name text NOT NULL,
        token_hash text NOT NULL,
        role text NOT NULL DEFAULT 'worker',
        status text NOT NULL DEFAULT 'pending',
        expires_at timestamp NOT NULL,
        invited_by_user_id text NOT NULL REFERENCES users(id),
        accepted_user_id text REFERENCES users(id),
        accepted_at timestamp,
        revoked_at timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS project_invites_project_idx ON project_invites (project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS project_invites_token_idx ON project_invites (token_hash)`);
    // Team Portal — activity audit log. Written automatically by portal
    // middleware on every section-open / document-view (+ blocked attempts).
    // New table → must exist in prod before the portal middleware runs.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id text NOT NULL,
        section text NOT NULL,
        action text NOT NULL DEFAULT 'view',
        item_type text,
        item_id text,
        user_agent text,
        ip_address text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_project_idx ON activity_log (project_id, created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_user_idx ON activity_log (user_id, created_at)`);
    // Per-person Team Portal restructure — one `people` row per individual human
    // (subcontractor person when subcontractor_id set, else in-house member).
    // Portal invites + memberships now reference people.id. New table + nullable
    // person_id FK columns → must exist in prod before the person/invite endpoints
    // run. Nullable so pre-existing invites/members (0 or legacy) never orphan.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS people (
        id text PRIMARY KEY,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        subcontractor_id text REFERENCES subcontractors(id) ON DELETE CASCADE,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        name text NOT NULL,
        email text NOT NULL,
        phone text,
        role_title text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS people_subcontractor_email_uq ON people (subcontractor_id, email) WHERE subcontractor_id IS NOT NULL`);
    await pool.query(`DROP INDEX IF EXISTS people_company_user_uq`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS people_company_inhouse_email_uq ON people (company_id, email) WHERE subcontractor_id IS NULL`);
    await pool.query(`ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS person_id text REFERENCES people(id) ON DELETE CASCADE`);
    // Per-person "show contact details in portal" flag (NULL = role-based default).
    await pool.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS show_contact_in_portal boolean`);
    // Invite email delivery state (Resend integration).
    await pool.query(`ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS email_status text`);
    await pool.query(`ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS email_last_sent_at timestamp`);
    await pool.query(`ALTER TABLE project_members ADD COLUMN IF NOT EXISTS person_id text REFERENCES people(id) ON DELETE CASCADE`);
    // F5 — Daily Site Reports hub. These base tables were only ever created via
    // `drizzle push` (dev-only), so they may NOT exist in prod. Create them here
    // (idempotent) before the reports routes / 18:00 generation job / daily-notes
    // authoring touch them, then add the F5 manager-authored site-diary columns.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_notes (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id),
        author_id text NOT NULL REFERENCES users(id),
        note_date text NOT NULL,
        body text NOT NULL,
        source text NOT NULL DEFAULT 'voice',
        photo_url text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        report_date text NOT NULL,
        generated_at timestamp NOT NULL DEFAULT now(),
        checkin_count integer NOT NULL DEFAULT 0,
        document_event_count integer NOT NULL DEFAULT 0,
        photo_count integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        CONSTRAINT daily_reports_project_date_uq UNIQUE (project_id, report_date)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_reports_project_idx ON daily_reports (project_id)`);
    await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS manager_report jsonb`);
    await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS authored_by text`);
    await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS authored_at timestamp`);
    await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false`);
    // Team Portal share targets (gated portal visibility). Polymorphic item + audience rule.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_shares (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        item_type text NOT NULL,
        item_id text NOT NULL,
        audience_type text NOT NULL,
        trade text,
        person_id text REFERENCES people(id) ON DELETE CASCADE,
        shared_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_shares_uq ON portal_shares (project_id, item_type, item_id, audience_type, coalesce(trade, ''), coalesce(person_id, ''))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_shares_project_idx ON portal_shares (project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_shares_item_idx ON portal_shares (item_type, item_id)`);

    // Team Portal member sessions — server-side lifetime (sliding 30d + 12h
    // inactivity + explicit-logout/revoke). Portal JWTs carry only a session id.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at timestamp NOT NULL DEFAULT now(),
        last_active_at timestamp NOT NULL DEFAULT now(),
        expires_at timestamp NOT NULL,
        revoked_at timestamp
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_sessions_user_project_idx ON portal_sessions (user_id, project_id)`);

    // Web Push — per-member per-device subscriptions + a debounce/batch queue.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        endpoint text NOT NULL,
        p256dh text NOT NULL,
        auth text NOT NULL,
        user_agent text,
        created_at timestamp NOT NULL DEFAULT now(),
        last_seen_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uq ON push_subscriptions (endpoint)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id, project_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_pushes (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind text NOT NULL,
        item_type text,
        item_id text,
        title text NOT NULL,
        project_name text NOT NULL,
        deep_link text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS pending_pushes_user_idx ON pending_pushes (user_id, created_at)`);
    logger.info("ensureSchema: company_members + expiry_reminder_logs + stripe_webhook_events + project_closeouts + documents.revision + daily_notes.photo_url + photos/permits/insurance assignment cols + users email-verification cols + team-portal (users.portal_only, project_members uq, project_invites, activity_log) + people table + project_invites/project_members person_id + daily_notes/daily_reports base tables + daily_reports F5 manager-report cols + portal_shares + portal_sessions + push_subscriptions + pending_pushes ready");
  } catch (err) {
    // Don't crash the server — membership lookups fall back to the home company.
    logger.error({ err }, "ensureSchema failed (continuing with home-company fallback)");
  }
}
