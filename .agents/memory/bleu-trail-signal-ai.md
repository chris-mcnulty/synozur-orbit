---
name: Bleu Trail / SignalAI angles-first pattern
description: External reference repo for the angles-first ideation model the user wants Orbit to adopt incrementally.
---

# Bleu Trail = SignalAI repo

"Bleu Trail" is the user's parallel news-content project: **github.com/chris-mcnulty/signal-ai** (public; cloneable). It also lives as a Replit workspace under the synozurapps org (user can share a collab invite if live-workspace access is ever needed; the GitHub repo is the practical reference from here). Its ideation engine was itself ported *from* Orbit's brief-interview-core, then simplified.

## The pattern the user prefers
Facts (news story / user prompt) → propose 6–8 **angles** → user picks → only then choose format (case study / opinion / news piece). Key files:
- `artifacts/api-server/src/engine/ideation-core.ts` — `buildIdeationPrompt`: concept briefs as JSON `{ title, summary, angle, keyPoints, audience, category, fitAssessment }`.
- An **angle is one string** ("the distinct take or hook"), never a strategy object — no forced demand signal/differentiation (that forcing is what makes Orbit's interview hallucinate on plain event announcements, e.g. the Airfield Estates incident where a venue became a "collection").
- **Fit assessment**: voiceFit/topicFit strong|moderate|weak + keep/reject recommendation with rationale; weak angles are shown marked "reject", never silently omitted.
- The chosen angle passes **verbatim** to the copywriter (`- Angle: ${brief.angle}`), alongside the raw source.

## Decision (Aug 2026)
**Why:** user confirmed direction via Q&A — start small: add an *optional* angles step to the prompt-based Quick Generate flow ("Just make it" vs "Show me angles first"), evaluate, then decide whether to rework the whole brief process around facts→angles→format. Do NOT rip out the strategy interview; it stays for source-less strategic campaigns.

**How to apply:** any new ideation/generation surface should keep the user's raw text attached as ground truth end-to-end and treat strategic fields as optional, never required inventions.
