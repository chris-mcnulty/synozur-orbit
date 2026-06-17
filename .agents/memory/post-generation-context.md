---
name: Post generation context injection
description: Why generatePostsAsync drifts generic and the fix — content briefs must be injected before foundingSignals
---

## The problem
`generatePostsAsync` has three context layers fed into the prompt:
1. `campaignMissionContext` — built from `campaign.objective` + `campaign.interview` (themes/newsItems/product/releaseDate)
2. `foundingSignalsContext` — built from `campaign.foundingSignals` (competitive intelligence scan results)
3. `groundingContext` / `strategicContext` — brand/market-level guidelines

When `campaign.interview` is NULL (not filled in via the interview wizard), `campaignMissionContext` is empty even if `objective` is set. The `foundingSignals.actionItems` (competitive recs like "develop thought leadership", "reposition messaging") then become the dominant campaign-specific signal, and the AI writes posts about generic marketing strategy instead of the campaign's actual topic.

## The fix
Fetch `contentBriefs` directly via `eq(contentBriefs.campaignId, campaignId)` — the table has a direct `campaignId` FK, no join to `editorial_calendars` needed. Filter `status IN ['suggested', 'approved']`, limit 15.

Build `briefsContext` with: brief titles, differentiationAngle, targetReader, demandSignal. Inject it **after** `campaignMissionContext` and **before** `foundingSignalsContext` in the prompt string.

**Why:** The briefs are the team's signed-off content plan — they name the exact hooks, angles, and target readers. That's more specific than the founding signals and must override generic drift.

## Prompt injection order (correct)
```
campaignMissionContext → briefsContext → foundingSignalsContext → groundingContext → strategicContext → personaContext → pool.context
```

## Related
- `contentBriefs.campaignId` is a direct FK column — confirmed by usage at marketing-saturn.ts ~line 1759.
- Bulk-wipe endpoint: `DELETE /api/campaigns/:id/generated-posts` — deletes status IN [draft, approved, scheduled, failed, deleted, rejected]; preserves exported/published/posted/delivered.
