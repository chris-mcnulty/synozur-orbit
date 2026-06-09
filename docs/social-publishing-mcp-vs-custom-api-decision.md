# Decision Memo: Social Publishing — Third-Party Aggregator (MCP Bundles) vs. Custom API

**Date:** 2026-06-09
**Author:** Engineering (drafted with Claude Code)
**Status:** Recommendation — pending vendor due diligence
**Decision owner:** Marketing/Platform engineering

---

## TL;DR

We already own a working, multi-tenant, direct-API social publishing stack for
five platforms. We should **keep it for the self-serve platforms (X, Facebook,
Instagram, Bluesky)** and **adopt an approved aggregator (MCP Bundles) for
LinkedIn only**, slotted in behind our existing `SocialPublisher` abstraction.

The deciding factor is **not** engineering maintenance — it's **LinkedIn API
access approval**, which is a business/regulatory gate we currently cannot
clear (our app is at dev/limited tier). An approved aggregator buys us that
access. We keep everything else in-house to preserve our credential-isolation
and audit posture.

This recommendation is contingent on confirming, in writing, that tenant OAuth
credentials remain within our trust boundary under the aggregator model.

---

## Context: this is not a greenfield build-vs-buy

Synozur Orbit already has a substantial direct-API publishing stack:

- **Five platform publishers** with native OAuth —
  `server/services/social-publishers/{linkedin,twitter,facebook,instagram,bluesky}.ts`
  - LinkedIn (member + org page), Twitter/X (OAuth + PKCE), Facebook & Instagram
    (Graph API), Bluesky (app password)
- **Publish worker** (`server/services/marketing-publish-worker.ts`):
  approval workflow (draft → approved → published), scheduling, exponential-
  backoff retries (5min → 15min → 1hr → 4hr → 1day), per-tenant daily caps
  (default 200/day), and a `social_publish_attempts` audit trail.
- **Multi-tenant credential isolation**: per-tenant OAuth client secrets
  (`tenantPlatformCredentials`) and per-account tokens (`socialAccounts`),
  all AES-256-GCM encrypted at rest (`server/utils/encryption.ts`).
- **Voice profiles**, campaign linkage (`campaignSocialAccounts.autoPublish`),
  and UTM attribution.

So the real question is **"keep extending what we own" vs. "route some platforms
through a third party,"** not "build from scratch vs. buy."

> **Note on terminology:** MCP (Model Context Protocol) is a tool-calling
> protocol for agents, not a posting service. "An MCP social tool" is really a
> third-party posting backend exposed over MCP. The build-vs-buy tradeoff is
> about that backend and its LinkedIn partner approval — not the protocol.

---

## The crux: LinkedIn is access-gated, the others are not

LinkedIn is uniquely restrictive. Posting on behalf of members and organization
pages at scale runs through LinkedIn's Marketing Developer Platform / Community
Management API, and **production access requires LinkedIn's review/approval of
the app** (historically, partner status). This is categorically different from:

- **Bluesky** — app password, no gatekeeper
- **X / Facebook / Instagram** — self-serve OAuth with rate tiers

**Our current status: LinkedIn app is at dev/limited tier.** We do not have
production approval to post to arbitrary tenant org pages at volume. We may not
be able to clear that gate on our own timeline, or at all.

MCP Bundles is, per our understanding, an **approved aggregator that operates
under LinkedIn's approval**. Its core value to us is therefore **the approval
itself** — a business moat, not engineering toil we're offloading. That is a far
stronger reason to adopt a third party than the generic "they handle API churn"
argument.

---

## Options considered

### Option A — Keep custom API for all platforms (status quo)

**Pros**
- Most of the build cost is already sunk and working.
- Tenant tokens never leave our boundary — clean enterprise security story.
- Full control of scheduling, retries, audit, voice profiles, attribution.
- No per-post marginal cost beyond infra.

**Cons**
- **Does not solve LinkedIn.** We remain blocked at dev/limited tier with no
  guaranteed path to production approval.
- We own the API-churn maintenance treadmill (X pricing/tiers, LinkedIn API
  migrations, Instagram quirks).
- Adding new platforms (TikTok, Threads, YouTube) is real engineering each time.

### Option B — Replace everything with the aggregator

**Pros**
- Single integration; vendor absorbs all API churn and new-platform work.

**Cons**
- **Writes off working, differentiating code** (worker, retries, encryption,
  multi-tenancy, audit) to *add* cost and risk.
- Vendor lock-in; their outage = our customers' missed campaigns.
- Per-post/per-profile pricing scales against us as we grow.
- Likely surrenders our credential-isolation posture across **all** platforms,
  not just the one that needs it. Not justified.

### Option C — Hybrid: aggregator for LinkedIn, custom for the rest (RECOMMENDED)

**Pros**
- Solves the **one** genuinely hard problem (LinkedIn approval) without
  rebuilding anything.
- Worker, retry logic, encryption, audit trail, voice profiles, and campaign
  linkage stay intact and platform-agnostic — the aggregator becomes just one
  more implementation of the `SocialPublisher` interface.
- Confines third-party trust surface to a single platform.
- Reversible: if we later get our own LinkedIn approval, we swap the
  implementation back with no change to the worker or data model.

**Cons**
- Two code paths to reason about for LinkedIn (ours vs. aggregator) during
  transition.
- Adds a vendor dependency and contract to manage.
- Requires verifying the aggregator's credential/data-handling model.

---

## Recommendation

**Adopt Option C.** Integrate MCP Bundles as the LinkedIn publisher behind our
existing `SocialPublisher` abstraction; keep our own publishers for X, Facebook,
Instagram, and Bluesky.

This is the only option that **actually unblocks LinkedIn** while preserving the
expensive, differentiating infrastructure we've already built and confining the
third-party trust surface to the single platform that requires it.

---

## Conditions / open items before committing

1. **Credential custody (gating).** Confirm in writing that tenant OAuth
   credentials remain within our trust boundary (our current understanding is
   "tokens stay with us"). If the aggregator instead stores tenant tokens on
   their side, this requires a full compliance/security review against our
   multi-tenant model before proceeding.
2. **Approval scope.** Confirm the aggregator's LinkedIn approval covers our
   actual use case: posting to **tenant-owned organization pages** and member
   profiles, at our expected volume — not just a narrower scope.
3. **Commercial model.** Pricing basis (per-post / per-profile / flat), and how
   it scales at 200 posts/day/tenant across N tenants.
4. **SLA & failure semantics.** Uptime SLA, how publish failures are surfaced,
   and whether we can map them onto our existing retry/audit model.
5. **Data residency & logging.** Where post content and any PII transit/reside;
   what they log and retain.

---

## Decision

| Field | Value |
|-------|-------|
| Recommended option | **C — Hybrid (aggregator for LinkedIn only)** |
| LinkedIn app status | Dev/limited tier (no production approval) |
| Credential model | Tokens stay within our boundary — **to be confirmed in writing** |
| Blocking conditions | Items 1 and 2 above |
| Reversibility | High — confined to one `SocialPublisher` implementation |

---

## Appendix: key file references

| Component | Path |
|-----------|------|
| Social publishers | `server/services/social-publishers/{linkedin,twitter,facebook,instagram,bluesky}.ts` |
| Publish worker | `server/services/marketing-publish-worker.ts` |
| Scheduled jobs loop | `server/services/scheduled-jobs.ts` |
| Per-tenant platform credentials | `shared/schema.ts` (`tenantPlatformCredentials`) |
| Social account tokens | `shared/schema.ts` (`socialAccounts`) |
| Encryption (AES-256-GCM) | `server/utils/encryption.ts` |
| Campaign / autoPublish linkage | `shared/schema.ts` (`campaignSocialAccounts`, `generatedPosts`) |
