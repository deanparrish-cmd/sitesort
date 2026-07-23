---
name: Site-board QR check-in matching
description: Which project member types the public check-in endpoint must match, and the insurance rule
---

Rule: project_members links members three ways — user_id (in-house dashboard users), subcontractor_id (subcontractor company contact), and person_id (individual team contacts/workers). Any public identity-matching flow (site-board check-in) must handle all three or legitimate workers get "not_registered".
**Why:** person_id members were added later and the check-in matcher wasn't updated — real workers were denied site access.
**How to apply:** when adding a new membership link type or a new flow that matches people by typed name/company, cover every link type. Insurance rule: anyone tied to a subcontractor (contact or person) needs a valid non-archived, non-expired insurance record; in-house users and sub-less people don't.
