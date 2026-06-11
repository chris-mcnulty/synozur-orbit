---
name: App pages need AppLayout wrapper
description: Why /app pages render without a nav menu and how to prevent it
---

App pages do NOT get the sidebar/nav from the router. Each page component must wrap its own returned JSX in `<AppLayout>` (from `@/components/layout/AppLayout`). Routes in `client/src/App.tsx` only mount the page component — they do not provide the app shell.

**Why:** `insights-outcomes.tsx` shipped returning a bare `<div className="container ...">` with no `AppLayout`, so it rendered with no menu while every sibling page (e.g. `insights-visualizations.tsx`) wraps in `<AppLayout>`. Symptom reported as "there is no menu on the page."

**How to apply:** When adding or reviewing any page under `/app/*`, confirm its top-level return is `<AppLayout>...</AppLayout>`. Missing it = no nav, no regression caught by typecheck.
