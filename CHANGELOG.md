# Changelog

All notable changes to SiteSort. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are release (Publish) dates.
The complete numbered feature history lives in `CLAUDE.md` (`#N`) and
`CLAUDE_ARCHIVE.md`.

## [Unreleased]

_Nothing pending._

## 2026-07-15

### Added
- **Team Portal sharing — Everyone / Trade(s) / Individual(s)** (#65). A PM shares a
  Document, Photo (Site Issue) or Permit to a portal audience via the single shared
  Share dialog. Trade shares are stored as a rule and resolved at read time, so they
  reach members **invited later**. Sharing registers the item in the document's
  distribution tracking; viewing it logs to the activity log.
- **Gated portal visibility.** Portal members now see **only** what's shared with them
  (friendly "Nothing shared with you here yet" empty states), **except** Safety
  documents, which stay visible to everyone. A new **"Shared with me"** portal section
  aggregates everything shared with the member. The portal never exposes who else an
  item was shared with.
- **Deep-links for actionable/to-do items** (#64). Every count/status/outstanding-item
  row (close-out readiness card, dashboard stat & "needs attention" widgets, portfolio
  snapshot, calendar rows, finances totals) now links to its exact pre-filtered
  destination via shareable `?param` URLs. New shared `<LinkRow>` component; destination
  pages read the params and filter on load.
- **Delete a subcontractor.** New Delete button on each subcontractor card (manager-only)
  with a confirmation dialog spelling out the cascade. Backed by a new tenant-scoped
  `DELETE /subcontractors/:id` — the app previously had no way to remove a subcontractor.
- **Orphaned portal-account cleanup.** `GET /portal-users/orphaned` +
  `DELETE /portal-users/:userId` safely purge portal-only accounts that have no project
  membership (they can't log into anything), clearing their dependent rows first.

### Changed
- **One Share dialog everywhere.** All six remaining bespoke email/WhatsApp share
  dropdowns (permit, invoice, and the Team / Subcontractor / project-Team contact cards)
  now use the single shared Share dialog. Non-portal entities (invoices, insurance,
  contacts, notes) keep External (Email / WhatsApp) sharing only.

### Fixed
- **Site Board QR now persists.** The generated QR code stays on the Site Board tab after
  reload instead of reverting to the empty "Generate" state.
- **Site Board pins surface reliably.** Pinned documents show in a dedicated
  "Pinned documents" list on the Site Board tab and on the public scanned page, which now
  flags superseded documents.

## 2026-07-14

### Added
- **Per-person Team Portal invites** (#63). Portal access is granted per person via a new
  `people` model; every portal member is portal-only (no dashboard access).

### Fixed
- **Messages unread badge/list mismatch.** The sidebar badge counted direct messages
  across all companies while the list was company-scoped; both now use the same
  company-scoped filter (badge counts DMs only, not channels).

---

Older history (features #1–#62) is documented in `CLAUDE.md` and `CLAUDE_ARCHIVE.md`.
