---
name: SiteSort invoice ↔ project ownership
description: The rule for where invoices live once assigned to a project, and the unpaid round-trip.
---
- An invoice's `projectId` is the single source of truth for where it shows: null = main Invoices page; set = that project's Finances tab only. The two surfaces must never both show the same invoice.
- **Why:** the user treats "move to project" as a real move (leaves the main list and its totals), and "mark unpaid" as the reverse — marking unpaid must clear `projectId` so the invoice returns to the main page.
- **How to apply:** any new write that changes an invoice's paid/project state must keep status and projectId consistent with this rule, and any new invoice view must filter by projectId the same way.
- Invoice share/view helpers dereference the attachment URL and throw when it is absent — always gate view/share controls behind a present attachment. Gate invoice mutation controls behind the invoice-management capability, matching the main Invoices page.
