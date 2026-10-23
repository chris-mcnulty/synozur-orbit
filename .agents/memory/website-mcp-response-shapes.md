---
name: Website MCP tool response shapes
description: Exact payload shapes and params of the Synozur website MCP tools; mismatch causes silent empty imports
---

Source of truth: the website codebase (Replit project "Synozur-Baseline", GitHub chris-mcnulty/Synozur-WebBase), `artifacts/api-server/src/mcp/tools/*.ts`. Always check there before guessing tool params/shapes.

**Shapes (verified Aug 2026):**
- `search_posts` → `{ items, page, pageSize, total }` (paginated object, NOT array). Params: query, categorySlug, tagSlug, status enum (defaults published-only), page, pageSize (max 50).
- `list_episodes`, `list_landing_pages` → `{ items, page, pageSize }`. Param is `pageSize` (max 50), not `limit`.
- `list_events` → flat array. `upcoming` defaults **true** server-side — pass `upcoming: false` explicitly to get past events.

**Why:** casting the `{items}` envelope to an array makes downstream `.map/.filter` silently produce nothing — the "import does nothing, no errors" class of bug. Client-side `unwrapItems()` in the website MCP client normalises both shapes and throws loudly on anything else.

**How to apply:** when adding a new website MCP tool call, read the tool's zod schema + JSON.stringify return in the website repo first; wrap list results in `unwrapItems()`. Also: SSE body reads need their own timeout — `AbortSignal.timeout` on fetch() does not reliably abort body reads.

**Event schedules (website source verified October 2026):** `get_event({slug})` returns full event details plus sessions. Event/session IDs are serial integers, not UUID strings. Sessions expose `startTime`, `sessionUrl`, and a display-string `speakers`; there is no session end time or abstract. `list_events` omits the slug that `get_event` requires, so use the event page/schedule URL rather than guessing a slug from the title. Public routes are `/events/:slug` and `/events/:slug/schedule`.

**Why:** Tool descriptions omit important details and list summaries are not full schedules. Treat missing source fields as unavailable, not permission to fabricate values or erase local edits.
