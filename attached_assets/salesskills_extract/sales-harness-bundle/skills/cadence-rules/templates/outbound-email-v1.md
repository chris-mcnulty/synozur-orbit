---
id: outbound-email-v1
campaign: outbound-email-v1
description: Default outbound cadence for cold prospects with a recent signal. 3 templated follow-ups after the first-touch human-approved send.
steps:
  - id: outbound-email-v1-step-2
    days_after_previous: 3
    channel: email
  - id: outbound-email-v1-step-3
    days_after_previous: 4
    channel: email
  - id: outbound-email-v1-step-4
    days_after_previous: 7
    channel: email
variables:
  - first_name
  - hook_summary
  - re_engage_trigger
---

# outbound-email-v1

The first-touch message is drafted by the Composer and human-approved. After it sends, this cadence drives three templated follow-ups.

---

## Step 2 — Day 3 nudge

**Same subject as step 1. Reply on the same thread.**

```
{first_name}, no pressure on the previous note.

The reason I asked: {hook_summary}.

If it's not a fit, just say so and I'll get out of your way.
```

Variable sources:
- `first_name` → frontmatter `name:`, first token
- `hook_summary` → ## Hook section, one sentence

---

## Step 3 — Day 7 backup

**Same thread.**

```
{first_name}, last try on this one.

Saw {hook_summary} and figured it was worth one more nudge.

If now's not the right time, happy to resurface {re_engage_trigger}.
```

Variable sources:
- `re_engage_trigger` → from `## Notes` if present, otherwise default to "next quarter"

---

## Step 4 — Day 14 graceful close

**Same thread.**

```
{first_name}, closing the loop. Not chasing.

If anything changes on your end, easiest is to reply to this thread.

Otherwise I'll resurface {re_engage_trigger}. Be well.
```

After step 4 sends, the lead moves to `state: dormant` with `re_engage_at: now + 90 days`.

---

## Guardrails for this template

- Never use this cadence on a lead with `do_not_contact: true`.
- Skip if the prospect has replied at any point (state should not be `cadence_step_due` if a reply was detected — Cadence enforces).
- Skip if the lead's domain is on the suppression list.
- All three steps must satisfy `timing.md` business-hour windows.

## Versioning

This file is `v1`. Changes to wording → new file `outbound-email-v2.md` with a new ID. In-flight leads keep their original cadence ID to preserve experiment integrity.
