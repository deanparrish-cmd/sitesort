# Invoices removed from production (#126), 2026-10-09

Record of every row in the production `invoices` table before
`lib/invoice-removal.ts` deletes the attachments and drops the table. The
feature was removed in bebe715; attachments answered 410 since #121.
The user confirmed all 4 as test data (counterparty "test" / "test 1",
description "pool").

| Invoice id | Company | Project | Created by | Direction | Amount | Status | Due | Created | Attachment |
|---|---|---|---|---|---|---|---|---|---|
| 3453a55a-af90-4f8f-a468-2c4c21bcb22d | 78d4ad64 (Acme Construction*) | e97a0679 (Test Project*) | 49f1f17e (Paul Smith, demo*) | outbound | EUR 350 | pending | 2026-05-18 | 2026-05-27 10:38 | 5e5d1f77-7853-4445-9304-14521306d835.pdf |
| a6409e1c-eb8b-484f-ade5-b0a6b5971e40 | 8ee3d021 (Test SiteSort*) | 09b3eb48 (test 1 site sort*) | 18a888a1 (Amy*) | outbound | EUR 347.27 | paid | 2026-05-10 | 2026-05-13 10:47 | dccbf650-91e2-4597-8cb9-a3e17a098003.pdf |
| be2e5faf-1184-465d-8e4b-3fcb8b5dfa02 | 8ee3d021 (Test SiteSort*) | 09b3eb48 (test 1 site sort*) | 18a888a1 (Amy*) | inbound | GBP 100 | paid | 2026-07-31 | 2026-07-27 11:53 | f17d9676-32b5-49c3-8bf9-aa0cca6cb820.png |
| efb62be4-ef83-4389-a9c5-16f03025f6aa | 8ee3d021 (Test SiteSort*) | 09b3eb48 (test 1 site sort*) | 18a888a1 (Amy*) | inbound | GBP 200 | paid | 2026-06-10 | 2026-06-08 09:56 | dc729f44-515c-4fde-a1ed-531a80a8b17c.pdf |

\* Names looked up by id in the WORKSPACE database (same ids as production);
not yet confirmed against production.

All descriptions "pool" (one "pool " with a trailing space), reference empty.

## State of the attachment files in storage (checked 2026-10-09)

The workspace and production share ONE object storage bucket.

- `5e5d1f77-…pdf`: deleted on 2026-10-09 by the workspace run of the new
  startup step (the workspace database held a copy of invoice 3453a55a).
  A soft-deleted copy is still in the bucket (generation 1779878427790667)
  and can be restored if wanted.
- `dccbf650-…pdf`: not in the bucket, and no soft-deleted copy. Already
  missing before today (likely an upload from before object storage).
- `f17d9676-…png`, `dc729f44-…pdf`: present; the production startup step
  deletes them on the first boot after publishing #126.

## Raw rows as returned by production

```
"filename","invoice"
"5e5d1f77-7853-4445-9304-14521306d835.pdf","{""id"":""3453a55a-af90-4f8f-a468-2c4c21bcb22d"",""amount"":350,""status"":""pending"",""currency"":""EUR"",""due_date"":""2026-05-18"",""direction"":""outbound"",""reference"":"""",""company_id"":""78d4ad64-0588-4ffb-a827-9518429f3727"",""created_at"":""2026-05-27T10:38:59.502436"",""created_by"":""49f1f17e-b36d-4daa-ad3e-a60f26cef529"",""project_id"":""e97a0679-e400-47ad-a0f1-2a66616297d5"",""description"":""pool"",""attachment_url"":""/api/uploads/5e5d1f77-7853-4445-9304-14521306d835.pdf"",""counterparty_name"":""test""}"
"dccbf650-91e2-4597-8cb9-a3e17a098003.pdf","{""id"":""a6409e1c-eb8b-484f-ade5-b0a6b5971e40"",""amount"":347.27,""status"":""paid"",""currency"":""EUR"",""due_date"":""2026-05-10"",""direction"":""outbound"",""reference"":"""",""company_id"":""8ee3d021-3340-47ac-9562-cffc52434bc6"",""created_at"":""2026-05-13T10:47:15.452939"",""created_by"":""18a888a1-40e3-4b8a-9457-c37101b4c383"",""project_id"":""09b3eb48-5c9f-4687-b5f6-954b27f708bd"",""description"":""pool "",""attachment_url"":""/api/uploads/dccbf650-91e2-4597-8cb9-a3e17a098003.pdf"",""counterparty_name"":""test""}"
"f17d9676-32b5-49c3-8bf9-aa0cca6cb820.png","{""id"":""be2e5faf-1184-465d-8e4b-3fcb8b5dfa02"",""amount"":100,""status"":""paid"",""currency"":""GBP"",""due_date"":""2026-07-31"",""direction"":""inbound"",""reference"":"""",""company_id"":""8ee3d021-3340-47ac-9562-cffc52434bc6"",""created_at"":""2026-07-27T11:53:53.424155"",""created_by"":""18a888a1-40e3-4b8a-9457-c37101b4c383"",""project_id"":""09b3eb48-5c9f-4687-b5f6-954b27f708bd"",""description"":""pool"",""attachment_url"":""/api/uploads/f17d9676-32b5-49c3-8bf9-aa0cca6cb820.png"",""counterparty_name"":""test""}"
"dc729f44-515c-4fde-a1ed-531a80a8b17c.pdf","{""id"":""efb62be4-ef83-4389-a9c5-16f03025f6aa"",""amount"":200,""status"":""paid"",""currency"":""GBP"",""due_date"":""2026-06-10"",""direction"":""inbound"",""reference"":"""",""company_id"":""8ee3d021-3340-47ac-9562-cffc52434bc6"",""created_at"":""2026-06-08T09:56:32.895366"",""created_by"":""18a888a1-40e3-4b8a-9457-c37101b4c383"",""project_id"":""09b3eb48-5c9f-4687-b5f6-954b27f708bd"",""description"":""pool"",""attachment_url"":""/api/uploads/dc729f44-515c-4fde-a1ed-531a80a8b17c.pdf"",""counterparty_name"":""test 1""}"
```
