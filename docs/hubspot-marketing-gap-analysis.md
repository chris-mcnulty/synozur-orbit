# HubSpot Marketing Hub vs. Orbit — Capability Comparison, Gap Analysis & Implementation Plan

_Last updated: 2026-06-20_

## 1. Purpose & Scope

This document compares the marketing capabilities of **HubSpot Marketing Hub** against **Orbit's** marketing modules, identifies feature gaps, and proposes a phased plan to close the ones that fit Orbit's strategy.

### Scope boundary (important)

Orbit does **not** own the public website. Synozur's public marketing site (`synozur.com`), its API server, and the Galaxy client portal live in a separate repo, **`chris-mcnulty/synozur-webbase`**. Per direction, capabilities the website layer already provides are **not** counted as Orbit gaps.

Confirmed from `synozur-webbase` documentation (`docs/no-code-page-authoring-plan.md`, `docs/content-types.md`, `docs/integrations.md`, `docs/seo-env.md`), the following are **owned by `synozur-webbase`** and out of scope for Orbit:

- **Landing pages & page building** — no-code drag-and-drop block builder (hero, prose, CTA cards, FAQs, logo strips, testimonials, video, etc.), in-place editing, templates, scheduled publishing.
- **On-page CTAs** — first-class CTA-card blocks in the page builder.
- **Forms & lead capture** — contact forms, subscription signups, and "get started" submissions (hand-coded interactive flows).
- **Blog / CMS publishing** — a `collateral` library covering blog posts, case studies, white papers, videos, podcasts, and events, each with public detail routes and an admin editor. (Orbit generates this content as branded Word docs today; the website is the publishing target.)
- **On-page SEO** — SEO titles/descriptions, OG images, sitemap generation.
- **Microsoft Bookings** scheduling and **Entra SSO**.

**Critical finding — the website already runs a HubSpot lead pipeline.** Per `synozur-webbase/docs/integrations.md`, the site **captures leads from contact forms, subscriptions, and "get started" submissions and syncs them to HubSpot as contacts with custom timeline events**, toggleable per form type. **HubSpot is therefore already the system of record for inbound contacts and their engagement timeline.** This reframes the gap analysis: the question is not "should Orbit rebuild a contact/automation spine?" but "how should Orbit interoperate with the HubSpot contact graph the website already feeds?" (see §5 and §7).

## 2. HubSpot Marketing Hub — Capability Map

HubSpot Marketing Hub (Free → Starter → Professional → Enterprise, plus 2025 Breeze AI and Marketing Studio additions) covers:

| # | Module | Summary |
|---|--------|---------|
| 1 | **Email marketing** | Drag-and-drop builder, templates, personalization tokens, A/B testing, send-time optimization, automated & transactional email, AI email (2025). |
| 2 | **Forms** | Standalone, embedded, pop-up; progressive profiling. |
| 3 | **Landing pages** | Drag-and-drop builder, templates, smart content, A/B testing. |
| 4 | **Blog / CMS & SEO** | Blog tool, SEO recommendations in editor, topic clusters / pillar pages, content strategy. |
| 5 | **Social media** | Publish/schedule, monitoring & social inbox, engagement reporting (LinkedIn, FB, IG, X, YouTube). |
| 6 | **Ads** | Google / Meta / LinkedIn ad management, list-synced ad audiences, lead sync, ROI/attribution. |
| 7 | **CTAs** | Buttons & smart CTAs, A/B testing, embeds. |
| 8 | **Marketing automation / Workflows** | Visual builder, enrollment triggers, branching (if/then), delays, property updates, internal notifications, re-enrollment. |
| 9 | **Lead scoring** | Manual + predictive scoring/grading. |
| 10 | **Lists & Segments** | Active (dynamic, behavior-driven) and static lists; 2025 **Segments** unify known + anonymous visitors in real time. |
| 11 | **Smart content / Personalization** | Personalization tokens + smart rules by segment/lifecycle/device; 2025 Personalization app. |
| 12 | **Campaigns** | Asset association, budget/spend, goals, campaign analytics. |
| 13 | **Analytics & Reporting** | Traffic analytics, custom report builder, dashboards, **multi-touch revenue attribution**, customer journey analytics (2025). |
| 14 | **ABM** | Target accounts, company/ICP scoring, ABM dashboards, ad audiences. |
| 15 | **CRM (Smart CRM)** | Shared contacts/companies/deals, activity timeline, lifecycle stages. |
| 16 | **AI (Breeze)** | Content assistant, AI image, social agent, content agent, AI email. |
| 17 | **Other** | SMS/WhatsApp (add-on), subscription types & consent (GDPR), Marketing Studio collaborative canvas (2025), Lookalike lists & Journey automation (2025 Enterprise), business units / multi-account. |

## 3. Orbit — Marketing Capability Inventory (condensed)

Source: codebase audit of `client/src/pages/app/marketing/*`, `server/routes/marketing-*.ts`, and `server/services/*`.

| Function | Orbit status | Where |
|---|---|---|
| **Campaigns** | ✅ Full — types, parent/child, persona targeting, dates, asset/brand/social mapping, AI ideation from news + competitive intel | `marketing-saturn.ts`, `campaign-ideation.ts`, `campaigns` tables |
| **Email** | ✅ Send (SendGrid), open/click tracking, recipient lists, suppression list, HMAC unsubscribe, SendGrid event webhooks, test send, scheduled send | `email-campaign-sender.ts`, `email-service.ts`, `marketing-delivery.ts` |
| **Social publishing** | ✅ Full — LinkedIn, X, Instagram, Facebook, Bluesky; scheduling, auto-publish worker w/ retry & rate caps, publish-attempt audit | `social-publishers/*`, `marketing-publish-worker.ts` |
| **Social monitoring** | ✅ Engagement snapshots / metrics | `social-monitoring.ts`, `social_metrics` |
| **Content library** | ✅ Full — ingest, extract, categorize, search, CSV, repurpose engine, SEO/AEO optimizer, copywriter | `content-production.ts`, `repurpose-service.ts`, `seo-aeo-service.ts` |
| **Brand library** | ✅ Full — logos, palettes, fonts, templates, tags | `brand-library.tsx` |
| **Editorial / marketing calendar** | ✅ Full — AI briefs, distribution planner, unified calendar across posts/emails/briefs, CSV export, load analysis | `editorial-calendar.ts`, `marketing-calendar.ts` |
| **Conference / event promotion** | ✅ Full — anchor + per-session posts, AI hero/carousel graphics | `conference-promotion-service.ts` |
| **Personas / ICP** | ✅ Persona CRUD, ICP flag, channel prefs; campaign targeting | `personas` table |
| **UTM / link tracking** | ✅ UTM builder, short links, click log w/ bot filtering, analytics, CSV | `marketing-links.ts` |
| **Performance / attribution** | ⚠️ Good but single-touch — campaign/content rollups, click→conversion, baseline vs. competitor benchmark | `marketing-performance.ts`, `performance-service.ts` |
| **SEO** | ✅ Keyword/SERP tracking, share-of-voice; ✅ content SEO/AEO optimization | `seo.ts`, `seo-provider.ts` |
| **GTM plan / messaging framework** | ✅ AI-generated long-form strategy w/ versioning | `gtm-plan.tsx`, `messaging-framework.tsx` |
| **HubSpot integration** | ⚠️ Partial — OAuth, company sync/enrich, deal rollup, contact list (read); outbound notes/tasks (Enterprise). No marketing-side sync. | `hubspot-integration.ts`, `hubspot-service.ts` |
| **AI content generation** | ✅✅ Core differentiator across all of the above | `ai-provider.ts`, many services |

## 4. Side-by-Side Comparison

✅ at parity / Orbit advantage  ⚠️ partial  ❌ missing  🌐 owned by `synozur-webbase` (not an Orbit gap)

| Capability | Orbit | HubSpot | Verdict |
|---|---|---|---|
| AI content generation (posts, email, briefs, repurpose, graphics) | ✅✅ | ⚠️ (Breeze, newer) | **Orbit advantage** |
| Competitive-intel-driven campaign ideation | ✅✅ | ❌ | **Orbit advantage** |
| Conference/event social promotion | ✅✅ | ❌ | **Orbit advantage** |
| Multi-network social publishing (5 networks) | ✅ | ✅ | Parity |
| Email send + open/click tracking + unsubscribe | ✅ | ✅ | Parity |
| Content & brand asset library | ✅ | ✅ | Parity |
| SEO keyword/SERP + content optimization | ✅ | ✅ | Parity |
| UTM / link tracking | ✅ | ✅ | Parity |
| Landing page builder/hosting | 🌐 ✓confirmed | ✅ | Website-owned |
| Forms / lead-capture widgets / on-site CTAs | 🌐 ✓confirmed | ✅ | Website-owned |
| Blog / CMS publishing | 🌐 ✓confirmed | ✅ | Website-owned |
| On-page SEO (titles/meta/OG/sitemap) | 🌐 ✓confirmed | ✅ | Website-owned |
| Inbound lead → contact sync w/ timeline | 🌐→HubSpot ✓confirmed | ✅ | Website-owned (into HubSpot) |
| **Marketing automation / workflows** | ❌ | ✅ | **Gap (high)** |
| **Email nurture / drip sequences** | ❌ | ✅ | **Gap (high)** |
| **Dynamic / behavioral segmentation** | ❌ (static lists only) | ✅ | **Gap (high)** |
| **Lead scoring / grading** | ❌ | ✅ | **Gap (med-high)** |
| **Unified marketing contact DB + lifecycle timeline** | ⚠️ (email recipients + HubSpot read) | ✅ | **Gap (high)** |
| **Multi-touch attribution / customer journey** | ⚠️ (single-touch) | ✅ | **Gap (med)** |
| Email A/B testing | ❌ | ✅ | **Gap (med)** |
| Smart content / personalization tokens | ❌ | ✅ | **Gap (med)** |
| Subscription types / preference center | ⚠️ (single unsubscribe) | ✅ | **Gap (low-med)** |
| Paid ads management + audience sync | ❌ | ✅ | **Gap (low — strategic)** |
| ABM target-account scoring | ⚠️ (personas/ICP only) | ✅ | **Gap (low-med)** |
| Custom report builder / dashboards | ⚠️ | ✅ | **Gap (low-med)** |
| SMS / WhatsApp | ❌ | ✅ (add-on) | Out of scope |

## 5. Gap Analysis (prioritized, website + existing-HubSpot items excluded)

The unifying theme: **Orbit creates and distributes content brilliantly but is blind to the contact journey that HubSpot already holds.** The website feeds leads + engagement into HubSpot; Orbit can read companies/deals but not the contact-level marketing timeline, and it can't act on it (segment, nurture, score, attribute). Closing this turns Orbit into a closed-loop GTM engine — **without rebuilding the contact spine HubSpot already owns.**

> **Build-vs-integrate stance:** Because HubSpot is already the contact system of record (website → HubSpot lead sync is live), the recommended default is to **integrate with the HubSpot contact graph, not duplicate it.** Where a gap could be solved either by building natively or by pushing/pulling to HubSpot, the plan favors the HubSpot path unless Orbit needs the capability for prospects HubSpot never sees (e.g., competitive-intel-sourced audiences). The native-build alternative is noted for each item. Decision §7.2 picks the overall posture.

**Tier 1 — Contact visibility (unlocks everything else)**
1. **Two-way HubSpot contact sync (read marketing timeline).** Extend `hubspot-integration.ts` beyond company/deal read to pull **contact-level** properties, lifecycle stage, and engagement timeline (opens, clicks, form submits, page views the website logged). This gives Orbit the journey view it lacks. _Native alternative: a `marketing_contacts` + `marketing_contact_events` spine fed by website webhooks — only worthwhile if we decide HubSpot should not be the SoR._
2. **Dynamic segmentation usable by Orbit.** Either **push Orbit-derived audiences to HubSpot lists** (persona/solution-area/competitive-intel segments → HubSpot active lists) or evaluate rule-based segments locally over synced contacts. Today Orbit has only static `email_recipient_lists`.

**Tier 2 — Activation (highest user-visible value)**
3. **Nurture / automation — decide owner.** Multi-step nurture is squarely HubSpot's strength and the website already routes leads there. **Recommended: orchestrate nurture in HubSpot, with Orbit contributing AI-generated content + audiences**, rather than building a parallel engine. _Native alternative (only if Orbit must own sends end-to-end): a workflow engine extending the existing **sales-outreach cadence engine** (`cadence-service.ts`, `cadence-core.ts`) + job queue, with action types send-email / wait / branch / set-property / notify._
4. **Close the email loop with HubSpot.** Orbit's SendGrid sends/opens/clicks (`email-campaign-sender.ts`) currently don't reach HubSpot. Log them as HubSpot timeline events so the contact record is complete regardless of which tool sent the email.

**Tier 3 — Intelligence & optimization (Orbit's differentiated lane)**
5. **AI lead scoring that writes back to HubSpot.** Orbit's competitive-intel + engagement signals → an AI-assisted score pushed to a HubSpot contact property. This is a genuine Orbit differentiator HubSpot can't replicate, and it lands where sales already works.
6. **Multi-touch attribution & customer journey.** Upgrade `marketing-performance.ts` from single-touch click→conversion to first/last/linear/position models over the synced timeline + Orbit's own link clicks.
7. **Email A/B testing + smart content / personalization tokens** for Orbit-sent email (variant sends + winner selection; merge tokens from synced contact properties).

**Tier 4 — Strategic / optional**
8. **Subscription types & preference center** (granular consent beyond single unsubscribe — GDPR upgrade; coordinate with website + HubSpot subscription types).
9. **ABM target-account scoring** (extend personas/ICP + existing HubSpot company sync into account scoring & dashboards — strong fit with Orbit's intel core).
10. **Paid ads management & audience sync** (Google/Meta/LinkedIn). Largest build, least aligned; if pursued, do it as **audience push to HubSpot Ads** rather than native ad management. Recommend deferring.
11. **Custom report builder / dashboards** (generalize existing performance reports).

## 6. Proposed Implementation Plan

Phased to deliver value early and reuse existing infrastructure. Each phase notes concrete touchpoints.

### Phase 0 — Decide posture & design (1–2 weeks)
- Lock the **build-vs-integrate** decision (§7.2). The website→HubSpot lead sync is live, so the default recommendation is **HubSpot as contact system of record; Orbit integrates**.
- Confirm what the website can expose to Orbit beyond HubSpot (e.g., does Orbit read the timeline _from HubSpot_, or does the website also emit events to Orbit directly?).

### Phase 1 — Contact visibility via HubSpot (Tier 1, integrate-first)
- **Extend** `hubspot-integration.ts` / `hubspot-service.ts` to read **contacts**, lifecycle stage, and engagement timeline (not just companies/deals).
- **Schema** (`shared/schema.ts`): lightweight `hubspot_contact_mirror` + `marketing_segments` (rule JSON). Avoid a full parallel contact DB unless §7.2 chooses native. Generate migration (`npm run db:generate`).
- **Segments**: evaluate Orbit segments over synced contacts, and/or **push** Orbit audiences to HubSpot active lists. Reuse for email recipient selection in `marketing-delivery.ts`.
- **UI**: surface a contact timeline + segment builder under `client/src/pages/app/marketing/`; register features in `server/services/plan-policy.ts` / `FEATURE_REGISTRY`.
- _Native fallback (only if §7.2 = build): `marketing_contacts` + `marketing_contact_events` fed by a website webhook endpoint; backfill `email_recipients` + SendGrid/link-click events._

### Phase 2 — Activation & email loop (Tier 2)
- **Close the email loop**: write Orbit SendGrid send/open/click events into HubSpot as timeline events (`email-campaign-sender.ts` → HubSpot engagement API).
- **Nurture**: if HubSpot-owned (recommended) — provide an Orbit "send to HubSpot workflow / enroll segment" handoff + AI content contribution. If native — build `marketing-workflow-service.ts` modeled on `cadence-service.ts` (job-queue-driven; action types send-email / wait / branch / set-property / create-task / notify) with a builder UI at `client/src/pages/app/marketing/workflows.tsx`.

### Phase 3 — Scoring & attribution (Tier 3)
- **Lead scoring**: `marketing_scoring_rules` + `score` on `marketing_contacts`; recompute on event ingest; **AI-assisted rule/score suggestions** via `ai-provider.ts`. Lifecycle stage transitions trigger workflows.
- **Multi-touch attribution**: extend `performance-service.ts` to attribute conversions across the contact timeline (first/last/linear/position models); add model selector to `performance.tsx`.

### Phase 4 — Optimization & polish (Tier 3/4)
- Email **A/B testing** (variant sends + winner logic in `email-campaign-sender.ts`).
- **Smart content / personalization tokens** resolved from contact properties at send time.
- **Subscription types / preference center** (extend `email_suppressions` + unsubscribe flow).

### Phase 5 — Strategic (Tier 4, optional / deferred)
- ABM account scoring (extend HubSpot company sync + personas).
- Custom report builder / dashboards.
- Paid ads management (separate epic; evaluate ROI before committing).

## 7. Open Questions / Decisions Needed

1. **Website boundary (now confirmed from docs):** `synozur-webbase` owns landing pages, CTAs, forms/lead capture, blog/CMS, and on-page SEO, and **already syncs leads to HubSpot with timeline events**. Please confirm this is current/accurate so these stay excluded from Orbit's gaps.
2. **HubSpot strategy (biggest fork):** Given HubSpot is already the contact SoR via the website, should Orbit **integrate** (read the HubSpot timeline, push segments/scores/content, let HubSpot run nurture) — the recommended default — or **build native** marketing automation/scoring/contact DB? This changes Phases 1–3 substantially.
3. **Ads (Tier 4):** In or out? Largest, least-aligned build; if in, recommend audience-push to HubSpot Ads over native ad management.
4. **Doc destination:** Should I convert the prioritized gaps into `backlog.md` entries (matching the existing format) so they enter the normal prioritization flow?
