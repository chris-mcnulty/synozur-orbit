---
name: Prompt-grounded generation contract
description: What "grounded strictly in the user's prompt" must mean for any generation feature (Quick Generate precedent) — completion review enforces it.
---

# Prompt-grounded generation contract

When a feature promises output grounded strictly in the user's prompt, the completion code review enforces it literally. Two rejections established the bar:

**Rule 1 — no tenant facts in the prompt, with ONE deliberate exception.**
- Strategic context sections (messaging/positioning framework, GTM plan, recommendations, personas, competitive intel, briefing action items) carry tenant facts and claims — exclude them all.
- **Brand identity is included by explicit user decision (Aug 23, 2026)** as style/character grounding. User said messaging may follow later, but only brand identity for now.
- The personal outbound voice profile (soundLikeMeInstructions) is user-editable free text and counts as a fact source — it must not reach prompt-grounded drafting.
- Static fact-free voice rules (SYNOZUR_VOICE_RULES / copywriter system prompt) always apply.
- `draftFromBrief` has a `promptGrounded` opt for this mode (strategic context reduced to brand identity only).

**Rule 2 — anything that round-trips through the client is a fact-injection vector.**
Normalizing shape is not validation. Server-generated artifacts the client sends back (e.g. selected angles) must be server-bound: HMAC-sign them bound to tenant + exact prompt (SESSION_SECRET), verify on use, reject otherwise.

**Rule 3 — tests must prove exclusion, not inclusion.**
Reviewers reject tests that only assert prompt content is present. Use sentinel strings in mocked context/profile sources and assert they do NOT appear in captured prompts; test that forged/tampered client artifacts are rejected.

**Rule 4 — campaign-only means campaign-owned factual sources only.**
- Campaign mission, campaign briefs/thematic brief, and attached campaign assets are allowed.
- Skip tenant grounding, global grounding, GTM/strategic context, founding signals, personas, and model-knowledge fallbacks.
- Scope the campaign, briefs, drafted assets, personas, and media by tenant + active market before any read or mutation.
- Global grounding documents have no tenant owner and must never be loaded automatically into tenant generation. Resolve them only through an explicit, permission-checked selection path.

**Why:** Task-completion review rejected the work twice for exactly these gaps even though all tests and typecheck passed.

**How to apply:** Any future "use only what the user said" generation path (or extension of Quick Generate) — start from these three rules; grep quick-generate-service/quick-generate-core for the reference implementation.
