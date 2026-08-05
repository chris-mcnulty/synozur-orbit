# Timing Rules

## Business-hour windows (prospect-local)

Cadence queues sends only between **08:00 and 17:00** in the prospect's local timezone, **Monday through Thursday**.

Why these windows:
- Pre-08:00 mail competes with overnight backlog
- After 17:00 mail dies in tomorrow's morning sweep
- Friday-afternoon sends underperform; Friday-morning is OK but v1 keeps it simple
- Weekend sends underperform broadly

## Timezone

If the prospect MD file has `timezone:` in the frontmatter, use it. Otherwise infer from the company HQ location in `## Dossier`. If still unknown, default to `[YOUR_DEFAULT_TIMEZONE — e.g. America/New_York]`.

## Day-of-week math (business days only)

When a template says `days_after_previous: 3`, count **business days** in the prospect's locale, skipping weekends and public holidays. v1 uses US federal holidays as the holiday list; revisit when running UK or EU campaigns.

## Same-thread enforcement

All follow-ups (steps 2+) must be sent as replies on the original thread, not as new emails with a fresh subject. Cadence reads the existing thread ID from the prospect's frontmatter (`thread_id:`, set at step 1 send time) and uses `CreateReplyDraft` with that message ID — never `CreateDraftMessage` for follow-ups.

## Rate pacing

Within a single hour, Cadence queues no more than 10 messages total across all leads, to avoid burst behavior that trips spam filters. If more are due in the same hour, stagger them randomly over the window.

## Reply windows

A reply received during business hours triggers the Composer's reply draft within 5 minutes (target). A reply received outside business hours sits in the queue and is drafted at the next 08:00 local-to-the-rep.
