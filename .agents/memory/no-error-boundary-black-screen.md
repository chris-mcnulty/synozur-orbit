---
name: No error boundary + dark theme = black screen
description: Why uncaught React render errors blank the whole Orbit app to a black screen, and the fix.
---

Orbit uses `defaultTheme="dark"` with `<html class="dark">`. The app had **no React error boundary** at all, so any render-time exception unmounted the entire tree and exposed the dark `<body>` — users perceive this as a "black screen" plus apparent data loss (the data is actually fine on the server).

**The fix:** a global `ErrorBoundary` (`client/src/components/ErrorBoundary.tsx`) wraps the whole app just inside `ThemeProvider` in `App.tsx`. It logs the real error in `componentDidCatch` (so the underlying crash is diagnosable in the browser console / production) and renders a recoverable fallback (reload + go-to-dashboard).

**Why:** Diagnosing "black screen" reports is otherwise opaque — without a boundary the actual exception never surfaces and the user is stranded with no recovery. A clean DB read confirmed the symptom was a frontend render crash, not a persistence bug.

**How to apply:** When a user reports a "black screen" / blank page after some action, suspect an uncaught render exception (not data loss). Check the browser console for the `[ErrorBoundary]` log to find the real error. Keep the boundary high in the tree (inside ThemeProvider) so it also catches provider-level crashes.
