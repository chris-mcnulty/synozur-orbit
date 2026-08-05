# Stop Conditions

A lead moves to `state: dormant` when ANY of the following is true.

## Hard stops (immediate)

- Reply contains an opt-out word (`unsubscribe`, `stop`, `remove me`, `do not contact`, "take me off your list"). Sets `do_not_contact: true` and appends to the suppression list. Never resurfaces.
- Bounce on the send address (hard bounce — soft bounce gets retried). Sets `email_invalid: true`.
- Manual operator override (a `state: dormant` set by a human).

## Soft stops (move to dormant, allow re-engage later)

- 3 templated cadence steps sent with no reply → dormant, `re_engage_at: now + 90 days`.
- `not-now` reply classified → dormant, `re_engage_at: now + 90 days` (or the date the prospect named, if they named one).
- The campaign auto-paused (campaign-level reply rate below floor) → all in-flight leads pause until the campaign resumes; not dormant, just held.

## Re-engagement

When `re_engage_at` is in the past AND the lead has fresh signals (detected at Prospector run-time on the dormant-pool sweep), the lead returns to `state: new` and is researched again with the updated context. This is a deliberate loop, not a default — the Prospector sweep over dormant leads runs only when the operator explicitly invokes it with `--include-dormant`.

## Touch count caps

- Max 4 outbound touches per lead per 12-month window. After cap → dormant for 12 months minimum.
- Max 8 touches per lead lifetime. After cap → permanent dormant.
