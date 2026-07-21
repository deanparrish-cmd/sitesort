---
name: Portal permission & submission-privacy model
description: How Site Issues / Plant & Materials / Daily Report are gated and whose content a member can see
---
Rule (current, replaces the older read-for-all model): the per-member flags (canLogIssues, canUpdatePlantMaterials, canEditDailyReport) gate BOTH section visibility (nav entry absent without the grant) and writes. On top of that, content is submission-private: a member only sees plant/material items they created or that were distributed to them (plant_item_distributions), and only daily-report days they contributed to (contributorsForReport via activity_log). The PM's dashboard entries are invisible in the portal until shared, including in the /portal/unseen badge counts.

**Why:** the earlier read-for-all default let subcontractor contacts see the PM's private plant log and site diary — user explicitly reversed it ("only visible to the person submitting it and the PM, until the PM shares").

**How to apply:** any new portal read path (lists, detail, badges, exports) for these sections must apply the same visibility predicate — including metadata like counts, or it leaks existence of private entries. Daily-report writes must reject non-contributors on content-bearing days (blind-overwrite + leak-via-save).
