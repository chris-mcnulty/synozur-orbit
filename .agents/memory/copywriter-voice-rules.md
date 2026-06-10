---
name: Copywriter voice enforcement
description: Where Synozur brand voice rules are enforced in AI copy generation, and a past defect to avoid repeating.
---

# Copywriter voice enforcement

Synozur voice rules (sentence case, no em dashes, no hashtags, anti-hype, hard CTA,
no corporate filler, no rhetorical-question transitions) are enforced in
`server/services/copywriter-service.ts` via shared `VOICE_NON_NEGOTIABLES` +
`SELF_CHECK` constants, injected into both the draft and rewrite system prompts.

**Why:** Previously the system prompt was generic ("expert B2B copywriter") and relied
on the MPF/StrategicContext to carry voice, so rules were only followed when the
messaging framework happened to mention them.

**Past defect:** `FORMAT_GUIDANCE` in `server/services/editorial-calendar-core.ts`
literally instructed the model to append hashtags (linkedin_post: "3-5 hashtags";
x_post: "1-2 hashtags") and to use a "soft CTA" — directly contradicting the brand's
no-hashtags / hard-CTA rules.

**How to apply:** Any change to copy formatting guidance must respect the no-hashtags
and hard-CTA rules. FORMAT_GUIDANCE is shared by brief generation and the copywriter,
so edits there affect both.

Note: content-strategist (editorial-calendar) and pricing-intelligence were already
well-realized — full brief schema (cta/channels/estimatedHours), 40/35/25 funnel
targets, demand-signal enforcement, quality warnings. The brief schema fields
cta/channels/estimatedHours exist but are NOT all surfaced on the campaign-detail
brief cards (only title/format/funnelStage/status/angle/reader/demandSignal shown).
