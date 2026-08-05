---
name: Headless crawler under production load
description: Chromium launch failures in prod were CPU starvation, not a broken browser; fixes are launch serialization + generous launch budget, with a circuit breaker as last resort.
---

Production crawls failed for a week (~942 failed vs 4 completed) with puppeteer "Timed out waiting for WS endpoint". The browser binary itself was fine — the same nix Chromium launches instantly in dev. Under a crawl storm the prod box's CPU is saturated, Chromium can't finish startup in 30s, and each failed launch spawns retries that add more load (death spiral). Plain-HTTP fallback is NOT an acceptable primary mode — JS-heavy sites return empty app shells (user explicitly rejected this).

**Why:** Launch failure is an environment/load condition, not per-page or per-site. Diagnose via prod deployment logs filtered on `(?i)headless` plus `scheduled_job_runs` status/error_message before touching crawler code.

**How to apply:**
- Browser launches are single-flight (shared in-flight promise) — never let concurrent crawls each spawn a Chromium.
- Launch budget is generous (120s launch timeout, per-attempt hard cap widened only when a launch is needed).
- Circuit breaker (2 consecutive launch failures → headless off 10 min → HTTP fallback) is a last-resort safety net only.
- Crawl job timeout must fit real headless cost (~30-40s/page ⇒ 15 min default); monitors stay tighter (5 min).
