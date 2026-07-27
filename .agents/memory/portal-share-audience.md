---
name: Portal share audience vs distribution
description: Share rules are stored per PERSON; distribution side-effects need a USER. Audience lists must include pending invitees.
---
Portal share rules (`portal_shares`) are keyed by person_id and take effect at portal read time — so sharing with someone whose invite is still pending (project_members row with person_id but user_id NULL) is meaningful: they see the item the moment they accept.

**Why:** The share dialog's People tab once filtered to accepted members only (person_id AND user_id), showing "No portal members" while people were invited. In production, invite acceptance can even leave user_id NULL (e.g. the user account was later deleted/scrubbed by tenant cleanup), so accepted-only lists can be empty despite real shares existing.

**How to apply:** Audience *listing* endpoints should return all person-linked members with an `accepted` flag (UI marks "invite pending"). *Distribution* side-effects (emails, push, distribution rows, recipientCount) still require user_id — keep those on the accepted-only subset. Also: issue Share buttons must not be gated on a file existing; ShareModal supports `shareText` for file-less shares.
