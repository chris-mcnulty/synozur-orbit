---
name: typecheck baseline (npm run check)
description: npm run check has a non-zero pre-existing error baseline; the app still runs because tsx/esbuild strip types.
---

# `npm run check` has a pre-existing error baseline

Running `npm run check` (tsc --noEmit) reports ~30 errors scattered across the
repo (e.g. battlecards, intelligence, relationship-reports, tenant-admin,
storage, conference-promotion-service, docx-generator, thumbnail-service, and a
couple in marketing-saturn / marketing-calendar). These are long-standing static
type mismatches, NOT runtime breakage.

**Why it doesn't break the app:** dev runs via `tsx server/index.ts` and the
build uses esbuild + vite, both of which strip/transpile types without a strict
typecheck gate. So the server boots and serves even with these tsc errors.

**How to apply:** When you run `npm run check`, do NOT assume every error is your
regression. Diff against this baseline mindset — only treat NEW errors in files
you touched (or that your change's types flow into) as yours. Don't scope-creep
into fixing unrelated pre-existing errors unless asked. `npm run check` is slow
(>2 min); cap it and tail the output.

PR58 ("target": "es2020" in tsconfig.json) intentionally cleared the ~25
`downlevelIteration` errors (for/of + spread over Map/Set); none of those remain.
