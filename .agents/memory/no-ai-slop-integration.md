---
name: no-ai-slop integration
description: Anti-AI-slop rules planned for content generation prompts and a sharpen-writing editor action. Covers rollback risk if rules prove too aggressive for human-written content.
---

# No-AI-Slop Integration

## What was planned (Task #518, July 2026)

Two-layer approach to remove AI writing patterns from all external-facing Orbit outputs:

### Layer 1 — Prompt-level prevention (generative)
Expand banned-word lists and structural anti-pattern rules in:
- `VOICE_NON_NEGOTIABLES` in `server/services/copywriter-service.ts` (blog posts, newsletters, whitepapers)
- `SYNOZUR_VOICE_RULES` in `server/services/repurpose-core.ts` (repurposed content)
- Social post system prompt in `server/services/brief-interview-service.ts`
- `COMPOSER_SYSTEM_PROMPT` in `server/services/outreach-composer-core.ts` (1:1 sales emails, LinkedIn outreach)

**New banned words to add** (beyond what was already blocked):
delve, foster, utilize, facilitate, streamline, robust, cutting-edge, paradigm shift, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving

**Structural patterns to add to prompt rules:**
binary contrasts ("not X, it's Y"), throat-clearing openers ("Here's the thing…"), faux-insight setups ("What most people miss…"), colon-reveal drama, superficial -ing clauses (highlighting/underscoring/showcasing), importance puffery ("marks a pivotal moment"), weasel attribution ("experts agree"/"studies show"), fake-strong verbs ("serves as a hub"), synonym cycling, negative listing, fake-profound kickers, summary-recap endings, formatting slop (emoji in headings, mid-sentence bold for emphasis)

### Layer 2 — On-demand "Sharpen writing" action (corrective)
- New endpoint: `POST /api/content-assets/:id/sharpen`
- Returns `{ content, changelog }` — edited draft + a "What changed" list
- Button in the long-form editor (blog posts, newsletters, whitepapers) and outreach composer
- User sees the changelog and accepts or rejects the rewrite — never automatic

## Rollback risk: rules may be too aggressive on human-written content

**Why this is a concern (user flagged July 23, 2026):** The banned-word list and structural rules were designed for AI-generated output. A human author who genuinely uses a word like "paramount" or writes a binary contrast for deliberate rhetorical effect could have that word/pattern suppressed by the prompt-layer rules (during AI-assisted generation) or stripped by the sharpen pass (from manually written drafts).

**What was already in place before Task #518** (pre-existing, not new risk):
No em dashes, no hashtags, no synergy/leverage/unlock/empower/game-changer/deep dive, no rhetorical-question transitions, hard CTA closer.

## How to roll back or soften each layer

**Prompt-layer rollback** — the banned-word list and structural rules are a single block inside `VOICE_NON_NEGOTIABLES` in `copywriter-service.ts` and mirrored in the other three files. Remove or trim the list there. No schema change, no migration — redeploy only.

**Selective scoping** — rules live in separate constants per service. The `copywriter-service.ts` block (blog/newsletter) can be rolled back independently of `outreach-composer-core.ts` (sales emails).

**Sharpen endpoint** — purely on-demand; user clicks a button and can reject the rewrite. Disabling it is removing the button. The endpoint itself is harmless if unused.

**Why:** The user explicitly asked (July 23, 2026) to remember this plan and the rollback path, in case the rules prove too aggressive against genuinely human-authored words within the next month or so.
