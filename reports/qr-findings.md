# QR "gone" investigation + prod data questions (2026-10-07)

No code changed.

## Most likely cause: the QR was hidden on purpose, not broken

#109 was committed on 2026-09-18 at 18:49. The "the QR code has gone" report came shortly after, in the same session as the 18:52 and 18:54 test check-ins. That commit removed the QR card from the **Team Portal's Site Board for everyone, admins included**. It also stopped the server sending the QR token to the portal at all.

Admins can get into the portal: `/portal/login` accepts any project member, not only portal-only accounts, and an earlier boot fix mentions your own accepted portal invite. So if you were looking at the portal, the QR disappearing was #109 working as designed. There is no code path that would hide the QR from an admin on the dashboard.

## 1. Where an admin should and shouldn't see the QR (current code)

| Place | Admin or PM | Everyone else |
|---|---|---|
| Project > Site Board tab | QR, URL, Print/Download, or a "Generate Site Board QR Code" button if the project has never had one | Pinned items plus "only available to admins and project managers" |
| `/qr` page | Every active project's QR | A "Not available" card |
| Sidebar "QR Codes" link | Shown | Hidden |
| Check-Ins tab "View Site Board" link and the Share dialog's site link | Shown | Hidden |
| **Team Portal > Site Board** | **No QR, since #109** | No QR |
| Public `/site/<token>` page | That page is the destination of the QR, so it never shows a QR itself | Same |

Before #109, the portal Site Board had a "Site board QR code" card with Open and Copy link buttons, shown to every portal member.

## 2. requireQrManager and the active company in the token

- The guard (`artifacts/api-server/src/routes/qr.ts:165`) only checks that the role in the token is `admin` or `project_manager`.
- At login, that role comes from your `company_members` row for the company you land in. You land in your home company if you're still a member of it, otherwise your first membership alphabetically. `users.role` is only a fallback.
- `/auth/me` returns the same role from the token. The Site Board tab, the `/qr` page and the sidebar all use it, so the screen and the server always agree.

Could a wrong active company hide the QR from an admin?

- **It could, but it wouldn't look like "gone."** If you landed in a company where your role isn't admin or PM, you'd see an explicit "only available to admins and project managers" message, and the "QR Codes" sidebar link would be missing. You'd only see that company's projects, so the project wouldn't even be listed.
- **Portal invites don't affect this.** Accepting a portal invite never adds a `company_members` row, so it can't change which company you land in.
- **A role change waits for the next login.** The token stores the role; the per-request check only confirms you're still a member. Very unlikely for you as the owner, but worth knowing.

Second, weaker explanation: on the Site Board tab, if loading the QR fails for any reason, the page quietly shows the empty "Generate Site Board QR Code" button instead of an error. A project that has never had a QR shows the same button. Clicking Generate brings back the existing QR rather than making a new one.

## 3. What to click on prod (about 2 minutes)

1. Log in to the dashboard. Check the company switcher shows the company that owns the project, and that the sidebar has **"QR Codes."** If that link is missing, your active role isn't admin there. Note which company it shows.
2. Open **QR Codes** (`/qr`). Your active projects should each show a QR. If one does, the dashboard is fine.
3. Open the project > **Site Board** tab. You should see the QR. If you see a "Generate Site Board QR Code" button instead, click it. If the QR appears, it was one of the "Generate" cases above, not a permissions problem.
4. Open the **Team Portal** for that project > Site Board. You'll see no QR. **If this is where you noticed it, it's intended since #109.** Open question: do you want admins and PMs to get it back in the portal?

## Prod data questions

I can't query prod: `DATABASE_URL` here is the workspace database. It has no 18:52 or 18:54 rows, only one legacy Dean Parrish row from June. These need you to check:

**Dean's 18:52 and 18:54 check-ins:** project > Check-Ins tab, find the 18:52 row. If it shows "Out HH:MM" between 18:52 and 18:54, it was a sign-out then a new check-in: expected, not a bug. If "Out" is empty, the double check-in guard failed on prod and I'd need that row.

**"Amy" vs "Amy Parrish":**

- **Can the names drift? Yes.** The Contacts card stores the contact's name; the primary contact's person record keeps a copy synced on edit, and that sync can miss. A fix that runs on every server start now overwrites the copy from the Contacts card. New check-ins link either name to the same person, so new rows stay merged.
- **Can old rows be merged retrospectively? Yes.** Older rows have no identity link and are grouped by name plus company, so they count as two people. Fixing it is a data update setting the link on those rows, shipped as a one-off fix that runs on server start (I can't reach prod). A blanket automatic backfill is risky since "Amy" doesn't match "Amy Parrish" by name, so target the specific rows you confirm. It mainly matters for rows still open, which show as two people on site.

## Questions for you

1. Which place did you notice the QR missing: Team Portal, project Site Board tab, or `/qr`?
2. Do you want the old Amy rows merged?
