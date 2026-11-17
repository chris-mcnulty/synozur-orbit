---
name: Verification resource contention
description: Distinguish slow concurrent verification from real test regressions.
---
Avoid running the full Vitest suite concurrently with TypeScript checking when investigating short test timeouts in this workspace.

**Why:** Full-suite runs alongside typechecking repeatedly timed out unrelated image-rendering and database tests, while the same tests passed quickly in isolation without code changes.

**How to apply:** Prefer serial full-suite and type checks. If a full run reports timeouts, retry the affected files alone and inspect the result before changing application code or raising timeouts. Report the original timeout and isolated result honestly.
