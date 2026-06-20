# HubSpot Marketing Hub vs. Orbit — Capability Comparison, Gap Analysis & Implementation Plan

_Last updated: 2026-06-20_

## 1. Purpose & Scope

This document compares the marketing capabilities of **HubSpot Marketing Hub** against **Orbit's** marketing modules, identifies feature gaps, and proposes a phased plan to close the ones that fit Orbit's strategy.

### Scope boundary (important)

Orbit does **not** own the public website. Synozur's public marketing site (`synozur.com`), its API server, and the Galaxy client portal live in a separate repo, **`chris-mcnulty/synozur-webbase`**. Per direction, capabilities that the website layer already provides are **not** counted as Orbit gaps. We therefore treat the following as **owned by `synozur-webbase`** and out of scope for Orbit:

- Public landing page **building/hosting** (Orbit already generates landing-page _copy_ as branded Word docs for handoff).
- On-site **forms / lead-capture** rendering, contact/newsletter signup widgets, and on-page **CTAs**.
- **Blog / CMS publishing** (Orbit generates blog content as branded Word docs; replit.md notes the plan to post directly via the website API once it ships).
- On-site cookie/consent banners and on-page SEO meta rendering.

> Note: `synozur-webbase` is outside this session's repo scope, so its exact feature set could not be enumerated directly. The boundary above is based on its README (public marketing site + api-server + Galaxy portal). **Open question for confirmation in §7.**

The interesting gaps, then, are not the website widgets themselves but the **connective tissue** between website lead capture and marketing execution — the contact lifecycle, segmentation, scoring, automation, and attribution that HubSpot bundles and that neither Orbit nor (presumably) the website currently owns.

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
| Landing page builder/hosting | 🌐 | ✅ | Website-owned |
| Forms / lead-capture widgets / on-site CTAs | 🌐 | ✅ | Website-owned |
| Blog / CMS publishing | 🌐 | ✅ | Website-owned |
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

## 5. Gap Analysis (prioritized, website items excluded)

The unifying theme: **Orbit creates and distributes content brilliantly but cannot yet orchestrate a contact's journey.** It has no behavioral contact model, no automation engine, and no way to nurture or score the leads the website captures. Closing this turns Orbit from a content/intel platform into a closed-loop GTM engine.

**Tier 1 — Foundational (unlocks everything else)**
1. **Unified Marketing Contact model + activity timeline.** Today contacts exist only as `email_recipients` and read-only HubSpot mirrors. A first-class `marketing_contacts` table with an event timeline (email opens/clicks already exist via `marketing_link_clicks`/SendGrid webhooks; add form-submit, page-view, post-engagement events) is the substrate for segmentation, scoring, and automation.
2. **Dynamic segmentation engine.** Rule-based "active lists" that recompute from contact properties + timeline events (vs. today's static `email_recipient_lists`). Reuse for email targeting, automation enrollment, and ad audiences later.

**Tier 2 — Automation (highest user-visible value)**
3. **Marketing workflow / automation engine.** Visual sequence builder with enrollment triggers (segment membership, form submit, link click), steps (send email, wait/delay, branch if/then, set property, internal notification, create task), and re-enrollment rules. Orbit already has the adjacent primitives: the **sales-outreach cadence engine** (`cadence-service.ts`, `cadence-core.ts`) and the **job queue / scheduled-jobs** infra — extend rather than build from zero.
4. **Email nurture / drip sequences.** The first concrete workflow action type, layered on the existing `email-campaign-sender` send path.

**Tier 3 — Intelligence & optimization**
5. **Lead scoring / grading.** Property + behavior weighted scoring; AI-assisted score suggestions are a natural Orbit differentiator. Feeds lifecycle stage + sales handoff.
6. **Multi-touch attribution & customer journey.** Upgrade `marketing-performance.ts` from single-touch click→conversion to first/last/linear/position-based models over the new contact timeline.
7. **Email A/B testing + smart content / personalization tokens.** Variant sends with winner selection; merge tokens resolved from contact properties.

**Tier 4 — Strategic / optional**
8. **Subscription types & preference center** (granular consent beyond single unsubscribe — also a GDPR upgrade).
9. **ABM target-account scoring** (extend personas/ICP + HubSpot company sync into account scoring & dashboards).
10. **Paid ads management & audience sync** (Google/Meta/LinkedIn). Largest build, least aligned with Orbit's AI/intel core — recommend deferring or partnering.
11. **Custom report builder / dashboards** (generalize existing performance reports).

## 6. Proposed Implementation Plan

Phased to deliver value early and reuse existing infrastructure. Each phase notes concrete touchpoints.

### Phase 0 — Confirm boundaries & design (1–2 weeks)
- Confirm `synozur-webbase` ownership of forms/landing pages/blog and define the **lead-handoff contract**: how website form submissions and page-view events reach Orbit (webhook into Orbit, shared API, or pull). This contract gates Tier 1.
- Decide build-vs-extend on the cadence engine for automation.
- Decide the HubSpot relationship: **Orbit-native automation** vs. **deepen HubSpot sync** and let HubSpot run automation. (See §7.)

### Phase 1 — Contact spine & segmentation (Tier 1)
- **Schema** (`shared/schema.ts`): `marketing_contacts`, `marketing_contact_events` (timeline), `marketing_segments` (rule JSON), `marketing_segment_members` (materialized). Generate migration (`npm run db:generate`).
- **Ingestion**: webhook endpoint to receive website form submits / page views; backfill existing `email_recipients` and SendGrid/link-click events into the timeline.
- **Segment evaluation**: scheduled job in `scheduled-jobs.ts` (or job-queue task) to recompute active segments; reuse for email recipient selection in `marketing-delivery.ts`.
- **UI**: new `client/src/pages/app/marketing/contacts.tsx` and `segments.tsx`; surface contact timeline.
- **Plan gating**: register features in `server/services/plan-policy.ts` / `FEATURE_REGISTRY`.

### Phase 2 — Automation & nurture (Tier 2)
- **Schema**: `marketing_workflows`, `marketing_workflow_steps`, `marketing_workflow_enrollments`, `marketing_workflow_step_runs`.
- **Engine**: new `marketing-workflow-service.ts` modeled on `cadence-service.ts`; driven by the job queue for delays/scheduling; enrollment triggers off segment membership + events.
- **Action types v1**: send email (reuse `email-campaign-sender`), wait/delay, if/then branch, set contact property, create task (reuse Planner/Outlook integrations), internal notification (`notification-service.ts`).
- **UI**: visual builder under `client/src/pages/app/marketing/workflows.tsx`; nurture templates seeded from personas/solution areas.

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

1. **Website boundary:** Please confirm that `synozur-webbase` owns forms, landing-page hosting, blog/CMS, and on-site CTAs — and tell me whether it can emit **form-submit and page-view events** to Orbit (this is the linchpin for Phase 1). If those events can't flow to Orbit, the contact spine is much weaker.
2. **HubSpot strategy:** Should Orbit **build native marketing automation/scoring**, or **lean on HubSpot** (deepen the existing sync, push segments/scores to HubSpot, let HubSpot run workflows)? This is the single biggest fork in the plan — it changes Phases 1–3 substantially.
3. **Ads (Tier 4):** In or out? It's the largest, least-aligned build.
4. **Doc destination:** Should I convert the prioritized gaps into `backlog.md` entries (matching the existing format) so they enter the normal prioritization flow?
