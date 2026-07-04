---
name: Marketing calendar deep-link to undated posts
description: How ?post=/?brief=/?emailId= deep links land on items that have no send date yet on the Master Marketing Calendar
---

The Master Marketing Calendar grid renders ONLY dated items (`scheduled = items.filter(i => i.date)`, `byDay` only holds dated). An undated draft never gets a day cell, so a deep link cannot highlight it on the grid.

**Rule:** undated `?post=` targets are surfaced in the backlog RAIL, not by drilling a batch.

**Why:** the main grid query rolls up dense social batches into summaries (member ids not shipped) AND excludes undated items entirely (windowed query, no `includeUnscheduled`). Drilling into an "unscheduled" batch would fetch/render nothing. The separate backlog query (`?unscheduledOnly=true`) returns every undated item individually with its real id and NO rollup — so the target is always findable there by id (loose or collapsed alike).

**How to apply:** in the deep-link effect, when the target isn't in `scheduled`, look it up in `backlogItems` by id first. If found, force the rail-visible view (calendar + month + no groupBy), relax any type/campaign/theme/event filter that would hide it from `railBacklog`, then scroll + ring-highlight the rail row (mirrors the dated day-cell cue). The server `locate/social/:id` endpoint returns `batch.day === "unscheduled"` for these — only ever drill a batch when `batch.day !== "unscheduled"`.
