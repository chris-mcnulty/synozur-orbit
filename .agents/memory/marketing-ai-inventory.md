---
name: Marketing AI feature inventory
description: Which "copilot marketing skills" already exist as Orbit product features, so you don't rebuild them.
---

# Marketing AI feature inventory

Orbit already implements most of the cowork copilot-marketing skill library as
product features (not as .agents skills). Before assuming a marketing AI capability
is missing, check for these:

- Content strategist → editorial calendar (briefs with full 10-field schema, 40/35/25
  funnel targets, demand-signal enforcement, quality warnings).
- Copywriter → copywriter-service (draft + rewrite).
- Repurposing → repurpose-service.
- Pricing analyst → pricing-intelligence (structured tiers, change scoring, alerts).
- SEO/AEO → seo-aeo-service + tracked_keywords/seo_metrics.
- Distribution planner → distribution-planner-{core,service} + route
  POST /api/editorial-calendars/:id/distribution-plan; deterministic scheduler (no AI),
  materializes briefs into the marketing planner. UI lives in editorial-calendar page.
- Performance analyst → performance-service + route POST /api/marketing/performance-report;
  joins first-party clicks + GA4 conversions, benchmarks vs prior period, AI synthesis,
  emits recommendations that ground the next editorial calendar (closes the loop). UI at
  /app/marketing/performance.

**Why:** A prior session wrongly told the user "Orbit has no distribution-planner or
performance-analyst" — they had been built recently and a filename grep that didn't
include those terms missed them. Always grep broadly (service + route + page) before
declaring a marketing capability absent.
