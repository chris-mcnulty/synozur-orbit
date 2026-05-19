---
name: cowork-gtm-analysis
description: Step-by-step guide for analyzing a company's Go-To-Market strategy in Orbit and recommending next steps. Use when the user asks to run a GTM analysis, interpret a GTM plan, review GTM gaps, or recommend what to do after generating a GTM plan. Specifically tuned for collaborative workspace / coworking companies but applies to any B2B or B2C tenant.
---

# GTM Analysis Guide — Orbit

This skill walks through how to conduct a complete GTM analysis inside Orbit, how to interpret what the platform produces, and what to recommend next. It is grounded in Orbit's actual data pipeline and AI generation logic.

---

## What "GTM Analysis" means in Orbit

Orbit's GTM plan is an AI-generated markdown document (`long_form_recommendations` table, type `gtm_plan`) produced by `gpt-5.2`. It synthesises five grounding sources:

| Input | Where it lives | What it contributes |
|---|---|---|
| Company profile | `company_profiles` | Company name, website, description, B2B/B2C type |
| Competitor list | `competitors` + crawled pages | Who they compete with and their positioning |
| Gap analysis | `analysis` table | Identified gaps across messaging, features, audience, content, positioning |
| Personas | `personas` table | Decision-maker profiles, priorities, preferred channels |
| Grounding documents | `grounding_documents`, `competitor_documents`, `global_grounding_documents` | Uploaded source docs (PDFs, DOCX) used for additional AI context |

The GTM plan then feeds **downstream**: marketing task generation, social campaign content, email newsletters, relationship reports, and PDF exports all pull from the GTM plan via `StrategicContext`.

---

## Step 1 — Verify the data inputs are complete

Before generating or reviewing a GTM plan, confirm these exist and are current:

### 1a. Company profile
- Go to **Workspace → Company Profile**
- Confirm: company name, website URL, description, and industry are filled in
- Confirm: the website has been crawled (check "last crawled" date under Intelligence Health)
- Confirm: B2B or B2C market type is set (Marketing > Settings or Market configuration)

### 1b. Competitors
- Go to **Workspace → Competitors**
- There should be at least 3–5 competitors with crawled website data
- Red flag: any competitor showing `https///` or a broken URL — fix the URL before running analysis

### 1c. Gap analysis
- Go to **Intelligence → Analysis**
- An analysis must exist and have gap data (messaging, features, audience, content, positioning gaps)
- If stale: trigger a re-analysis from the Analysis page before generating the GTM plan

### 1d. Personas
- Go to **Marketing → Personas**
- At least 2 personas should be defined with role, priorities, and preferred channels
- The GTM prompt injects persona context directly — missing personas produce generic output

### 1e. Grounding documents
- Go to **Workspace → Documents** (or competitor detail → Documents tab)
- Upload any relevant positioning docs, product briefs, or annual reports
- These are extracted as text and injected into the AI context (up to ~8,000 tokens)

---

## Step 2 — Generate the GTM plan

**Entry points:**

| Path | Endpoint | When to use |
|---|---|---|
| Marketing → GTM Plan → Generate | `POST /api/baseline/recommendations/gtm_plan/generate` | Company-level baseline GTM plan |
| Intelligence → Projects → [Project] → GTM Plan | `POST /api/projects/:id/recommendations/gtm_plan/generate` | Client/prospect-specific GTM plan |
| Full Refresh (Intelligence Health) | `full-regeneration-service.ts` | Batch regeneration of all deliverables |

**Optional custom guidance field** — use it to focus the plan:
- `"Focus on enterprise financial services and regulated industries"`
- `"Emphasise European market expansion"`
- `"B2C pivot: prioritise direct-to-consumer and social commerce"`

For **B2C companies** (coworking consumer memberships, retail, etc.), the system automatically shifts the entire plan: consumer acquisition channels, influencer/UGC, CAC/LTV metrics, loyalty programs, and conversion funnel language replace B2B motions.

---

## Step 3 — Read and interpret the GTM plan

The plan is structured into 9–10 sections. Here is what to look for in each:

### Executive Summary
- Should name 3–5 specific strategic bets, not generic strategy language
- Red flag: vague phrases like "leverage synergies" with no specifics
- Good signal: numbered strategic pillars tied to identified gaps (e.g., "Address gap: weak social proof")

### Target Market & Personas
- Should reference the actual personas defined in Orbit, not invented archetypes
- For B2B: look for ICP clarity (company size, industry, buying committee roles)
- For B2C (coworking): look for demographic + behavioural profiles (freelancers, remote workers, startups, enterprise flex-desk buyers)

### Value Proposition & Positioning
- Should clearly differentiate from the named competitors in the analysis
- Check: does it address the top gaps from the Analysis page?
- Red flag: "we are the best in class" without naming what specific gap is being exploited

### Channel Strategy
- B2B: direct sales, partnerships, digital/SEO, events
- B2C / coworking: social commerce, Google Maps / local SEO, influencer partnerships, corporate flex-desk channel, employer partnerships
- Should be prioritised (primary vs. secondary), not a flat list

### Marketing Strategy
- Look for specific tactics, not just categories
- Good: "LinkedIn thought leadership targeting VP of Real Estate at 500+ employee companies"
- Weak: "content marketing and demand generation"

### Sales / Conversion Strategy
- B2B: sales motion (PLG, sales-led, channel), objection handling, discovery playbook
- B2C: conversion funnel (trial → member), cart/booking abandonment, loyalty/referral
- Should map to the personas' buying triggers identified in the analysis

### Launch Plan (30/60/90 days)
- Phase 1 (Foundation): ICP definition, messaging lock, one primary channel activated
- Phase 2 (Growth): second channel, content production, pipeline building
- Phase 3 (Scale): paid amplification, partnership activation, reporting cadence
- Red flag: all three phases look identical or equally vague

### Success Metrics / KPIs
- Should be specific and measurable, not aspirational
- B2B: pipeline generated, MQL-to-SQL rate, ACV, sales cycle length
- B2C / coworking: new member acquisitions, CAC, LTV, occupancy rate, NPS, churn rate
- If metrics are missing or generic, add custom guidance and regenerate

### Resource Requirements
- Look for realistic team structure aligned to the channel strategy
- A LinkedIn-heavy strategy with no content team is a gap worth flagging

---

## Step 4 — Identify gaps and recommend next steps

After reviewing the GTM plan, use this checklist to prioritise next steps:

### Immediate (within the session)
- [ ] If personas are missing → go to Marketing → Personas and create them, then regenerate
- [ ] If the messaging framework hasn't been generated → generate it first (it feeds GTM context)
- [ ] If competitors haven't been crawled recently → trigger refresh from Intelligence Health
- [ ] If the plan is too generic → add custom guidance and regenerate with more specific direction

### Short-term (next 1–2 weeks)
- [ ] Generate **Battle Cards** for each key competitor (Intelligence → Analysis → Battle Cards) — these sharpen the positioning and objection-handling sections of the GTM plan
- [ ] Create a **Marketing Plan** in the Marketing Planner (uses GTM plan as "Key Strategic Input" for AI task generation)
- [ ] Start a **Social Campaign** grounded in the GTM positioning (Marketing → Social Campaigns → New)
- [ ] Build out the **Messaging Framework** if not yet generated — it becomes the voice of every AI-generated content piece

### Medium-term (30+ days)
- [ ] Upload **grounding documents** (product briefs, analyst reports, case studies) to Documents — they improve every subsequent AI generation
- [ ] Set up **SEO tracking** for the keywords identified in the GTM plan (Intelligence → SEO Dashboard)
- [ ] Generate an **Intelligence Briefing** to get a regular AI-synthesised view of how competitor activity is shifting against the GTM plan
- [ ] Export a **PDF report** to share the GTM plan + analysis with stakeholders (Deliverables → Reports)

---

## Coworking / Collaborative Workspace Context

When analysing a coworking or flexible workspace company specifically, look for these in the GTM plan:

**Market segments to expect:**
- Freelancers / independent workers (B2C consumer)
- Remote-first startups and scale-ups (B2B SMB)
- Enterprise flex-desk / distributed workforce buyers (B2B enterprise)
- Community-focused professional associations

**Competitive differentiators to probe:**
- Location density and accessibility
- Community programming and networking value
- Technology infrastructure (AV, high-speed internet, booking systems)
- Pricing flexibility (day pass, monthly, enterprise agreements)
- Amenity tier (lounge vs. dedicated desk vs. private office)

**Channels that matter:**
- Google Maps / local SEO (primary for consumer walk-ins)
- LinkedIn + employer partnerships (for enterprise flex)
- Content: "hybrid work", "future of work", "productivity" topic clusters
- Referral programmes among existing members

**KPIs to include in the GTM plan:**
- Occupancy rate (target: 75–85%)
- New member acquisition rate (monthly)
- Member CAC by channel
- Net member churn rate (target: <5% monthly)
- Revenue per desk per month
- NPS (target: 50+)

---

## Example: Custom Guidance prompts for Cowork companies

Use these in the "Custom Guidance" field when generating the GTM plan:

```
Focus on three segments: enterprise flex-desk buyers, remote-first startups (Series A–C), 
and freelancer community. Emphasise Google Maps local SEO and LinkedIn employer partnerships 
as primary acquisition channels. Include occupancy rate and member LTV as primary KPIs.
```

```
This is a B2C-first coworking brand targeting freelancers and solo professionals. 
Prioritise community and belonging as the core value proposition over amenities. 
Social media (Instagram, TikTok), influencer partnerships, and referral programmes 
should be the primary growth levers.
```

```
Enterprise focus: our target buyer is VP of Real Estate or Head of Workplace at 
companies with 200–2,000 employees adopting hybrid work. Emphasise cost-per-desk 
vs. traditional office lease, flexibility (scale up/down), and no CapEx commitment 
as the core objection-handling framework.
```

---

## Quick Reference — Key Orbit Endpoints

| Action | Route |
|---|---|
| Generate baseline GTM plan | `POST /api/baseline/recommendations/gtm_plan/generate` |
| Retrieve current GTM plan | `GET /api/baseline/recommendations/gtm_plan` |
| Generate messaging framework | `POST /api/baseline/recommendations/messaging_framework/generate` |
| Run competitor analysis | `POST /api/competitors/:id/analyze` |
| Get gap analysis | `GET /api/analysis` |
| Trigger full regeneration | `POST /api/regenerate` |
| Export PDF report | `POST /api/reports` → polling for PDF status |
| List grounding documents | `GET /api/grounding-documents` |
