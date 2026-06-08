---
name: Subcontractor notes — two distinct concepts
description: Don't conflate the static subcontractor blurb with the timestamped reminders log.
---

# Subcontractor notes

A subcontractor has TWO separate note concepts — keep them distinct:
- A single static "about" blurb (edited in the Add/Edit dialog).
- An append-only, timestamped reminders LOG (one row per entry), surfaced via the "Notes & Reminders" dialog.

**Why:** The user wanted a date+time-stamped history of chasing expiring insurance/permits — history, not one overwritten field. Modelled on the existing daily-notes log pattern.

**How to apply:** Any per-record "history/log" feature here should be a dedicated child table (not a text column), and its API must tenant-scope by the parent's companyId on both read and write, with authorId taken from the session (never the client body).
