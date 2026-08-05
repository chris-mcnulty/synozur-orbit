# Triggers

Every agent checks these at the top of every tick AND immediately before every send. Any one active → the agent stops the relevant work.

Configuration values come from `sales-harness-config.md` in the OneDrive sales-harness folder. Example settings:

- `AGENTS_PAUSED = false`
- `DAILY_SEND_CAP_EMAIL = 25`
- `WEEKLY_SEND_CAP_PER_DOMAIN = 3`
- `MIN_REPLY_RATE_PCT = 5`

| Trigger | Source | Effect |
|---|---|---|
| `AGENTS_PAUSED=true` | config file | All three agents exit cleanly at next tick. Global stop. |
| `do_not_contact: true` on a lead | lead frontmatter | All three agents skip this lead. Permanent. |
| Reply contains opt-out word | inbox scan | Cadence sets `do_not_contact: true`, appends to suppression list. |
| Per-rep daily send cap exceeded | running count | Cadence pauses auto-sends for that rep until next UTC day. |
| Per-domain weekly send cap exceeded | running count | Cadence pauses sends to that domain until next Monday. |
| Campaign reply rate < `MIN_REPLY_RATE_PCT` over last 50 sends | running stats | Campaign auto-pauses; alert posted. |
| Tool error rate > 10% over last 20 calls | running stats | Agent pauses, alerts operator. |
| Voice DNA file contains "PLACEHOLDER" | content scan | Composer stops; tells operator to extract Voice DNA. |
| Unrecoverable model error or tool exception on a lead | per-lead | Lead → `state: needs_review` with full trace in `## Audit`. |

## Opt-out words

Case-insensitive substring match in the reply body OR subject:

- `unsubscribe`
- `stop`
- `remove me`
- `take me off`
- `do not contact`
- `please stop`
- `no thanks` (only when the body is < 5 words total — short rejections)

## Per-rep daily send cap

Default `DAILY_SEND_CAP_EMAIL=25` from the config. Counted across:
- `state: sent` events written today by the Cadence agent on this rep's leads
- Plus drafts the Composer queued that have not yet sent

When the count hits the cap, the Composer stops drafting and the Cadence agent stops auto-firing templated steps for that rep, until 00:00 UTC.

## Per-domain weekly send cap

Default `WEEKLY_SEND_CAP_PER_DOMAIN=3`. Counted across all reps in the tenant — protects deliverability against accidental floods.

## Campaign reply-rate floor

`MIN_REPLY_RATE_PCT=5`. Computed over the rolling last 50 sends in a campaign (a campaign is the set of leads sharing a `campaign:` tag in their frontmatter). If below the floor, the campaign pauses and the operator gets a one-line alert.

The floor is not punishment. It is a circuit breaker: if a campaign is landing badly, the answer is to rewrite the messaging or rebuild the list, not to keep sending.

## How to clear a trigger

- `AGENTS_PAUSED` → operator edits the config file to set it to false; agents pick up on next tick.
- Campaign auto-pause → operator reviews and clears via the config or campaign file.
- `do_not_contact: true` → effectively permanent. A human operator edits the prospect file in OneDrive directly, sets `do_not_contact: false`, and appends a one-line entry to `## Audit` explaining why. Agents never clear this flag.
- Send caps → wait for the window to roll. Do not bypass.
