---
name: Content Advisor + time-of-day (Master Calendar)
description: How the Master Calendar's scheduling advisor and time-of-day field are wired, and the scoping/timezone gotchas.
---

# Content Advisor (marketing-calendar.tsx)
- `computeAdvisories(visibleScheduled, backlogCount)` is a pure client-side function — no API call. It flags: undated backlog pile-up, past-but-undelivered, duplicate/near-dupe content (normalized preview||title), overloaded days (>4), empty-week gaps, weekend posts.
- `visibleScheduled` is already campaign-scoped **server-side** (the main items query sends `campaignId=`), then type-filtered client-side. So the advisor re-scopes per campaign automatically.

**Why scoping matters:** the backlog query (`?unscheduledOnly=true`) is tenant-wide and does NOT take the campaign filter. So you must re-derive a campaign+type-scoped backlog count before passing it in — otherwise a per-campaign review counts unrelated campaigns' drafts.

**Timezone gotcha:** date-only keys ("YYYY-MM-DD") from `localKey` must be parsed with `parseLocalDay` (`new Date(y, m-1, d)`), never `new Date(string)` — the latter is parsed as UTC and shifts day/week boundaries in non-UTC zones, breaking gap detection. Full ISO timestamps (item.date) parse fine as local.

# Time-of-day in DetailDialog
- DetailDialog has separate date + time inputs combined via `pushSchedule(day, time)` into a full ISO string; replaced the old hardcoded `T09:00:00`. Time defaults to 9:00 AM, seeded from `localTime(item.date)`.
- Backend PATCH `/api/marketing-calendar/items/:type/:id` already accepts a full ISO datetime in the `date` field — no server change needed for time-of-day.
