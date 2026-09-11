---
name: Layout validation trust
description: Layout pass counts require authenticated content and meaningful state coverage.
---
Never equate route navigation with content coverage. Permission-denied screens, skipped portal sessions and empty fixtures cannot prove populated portal layouts work.

**Why:** Earlier high pass counts hid permission failures and omitted portal destinations. Expanded hit tests also misclassified intentionally inert backgrounds under open menus.

**How to apply:** Validate fixture permissions, discover routes, fail closed on missing fixtures, and distinguish menu foreground targets from intentionally blocked background targets. Report probe limitations and failing gates explicitly.

Do not exempt all descendants of an overflow-clipped container from layout failures. Shared page-level clipping can hide real truncated text and actions; decorative exceptions must be explicit, and horizontal scrollers treated separately.

**Why:** A blanket ancestor-clipping exception made the gate insensitive to the very content overflow it was intended to catch.

**How to apply:** Keep content bounds checks beneath shared clipping, distinguish decorative content, and use dedicated temporary identities for privileged coverage rather than elevating existing users.