# Sales Harness Config (example)

Copy this file into `OneDrive - [YOUR_TENANT] / sales-harness / sales-harness-config.md` and replace the placeholders. The harness reads this file at the top of every agent tick.

## Identity

- `OUTLOOK_FROM`: `[YOUR_OUTLOOK_EMAIL]`
- Operator timezone: `[YOUR_DEFAULT_TIMEZONE — e.g. America/New_York]`

## Folder references

- `PROSPECT_DIR_DRIVE_ID`: `[YOUR_DRIVE_ID]`
- `PROSPECT_DIR_FOLDER_ID`: `[YOUR_FOLDER_ITEM_ID]`
- Local session canonical path: `/mnt/workspace/output/prospects/`

## Kill-switch toggles

- `AGENTS_PAUSED`: `false`   # set to `true` to stop all three agents at the next tick
- `DAILY_SEND_CAP_EMAIL`: `25`
- `WEEKLY_SEND_CAP_PER_DOMAIN`: `3`
- `MIN_REPLY_RATE_PCT`: `5`
- `TOOL_ERROR_RATE_PAUSE_PCT`: `10`   # over last 20 calls

## Mailbox folder IDs (optional — well-known names usually work)

- Drafts: `drafts` (or paste an ID from `ListMailFolders`)
- Sent Items: `sentitems`
- Inbox: `inbox`

## How to clear a flag

- `AGENTS_PAUSED` → edit this file, set to `false`. Picks up on next tick.
- Campaign auto-pause → edit the campaign file or set a `campaign_paused: false` override here.
- `do_not_contact` on a lead → edit the prospect MD file directly. Agents never clear this.
- Send caps → wait for the window to roll. Do not bypass.
