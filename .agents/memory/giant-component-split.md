---
name: Giant component split recipe
description: How the 4,600-line SiteSort project detail page was safely modularized; reuse the pattern for other monoliths.
---

Pattern: keep ALL state/queries/handlers in one `useXState()` hook returning every top-level
name; provide it via a context (`useDetail()`); narrow nullable data with a `Ready` type after
loading guards in a slim `index.tsx`; each tab/dialog file is a verbatim JSX slice wrapped in a
fragment that destructures only what it uses from context.

**Why:** Byte-identical JSX + unchanged closure ownership means zero behavior change; tsc then
proves every identifier still resolves. The shadcn Tabs component is React-context based, so
`TabsContent` renders fine from child components.

**How to apply:** For future splits of large SiteSort pages, generate slices mechanically
(script parsing top-level `const`/`function` declarations for the return set, filtering original
imports per slice by word-boundary identifier match) rather than hand-copying. Context value is
one big object → all consumers rerender together; acceptable (same as monolith), split providers
only if perf actually degrades.
