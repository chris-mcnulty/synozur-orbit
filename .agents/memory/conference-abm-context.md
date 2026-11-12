---
name: Conference ABM context
description: User requirements for relationship-aware event meeting development and shared promotion context.
---

Conference meeting development must distinguish relationship roles such as customer and partner, and use the organization's event goals, actual presence, and relevant speaking sessions as context.

**Why:** The user explicitly requested relationship-specific meeting development, not only new-prospect discovery, and a connection to Event Promotion where relevant.

**How to apply:** When designing this addition, reuse confirmed event facts across ABM and Event Promotion instead of creating conflicting briefs. Keep this as a design requirement, not a claim that integration has shipped. Do not infer attendance, speaking, or exhibiting from generic goals; follow the explicit event-confirmation rules.

Event outreach should have one canonical contact directory and reuse the original event goals and brief rather than requiring duplicate setup.

**Why:** The user called the stacked event workspace nearly unusable: too tall, the same contacts shown twice, and no visible reuse of the original planning context.

**How to apply:** Keep setup secondary to contact work, open per-person prep from the canonical list, preserve private overrides, and carry original event and campaign context into generation. Inheriting context is not consent to enable a workflow, confirm attendance, or send anything.

Wiza and Sales Navigator are external research tools for this workflow. Use Apollo in-app; when it produces no usable contacts, support reviewed imports of contacts the operator finds externally rather than adding Wiza or Sales Navigator integrations.

**Why:** The user explicitly chose external Wiza and Sales Navigator research as the fallback to Apollo.

**How to apply:** Preserve source attribution on reviewed imports. Do not silently invoke either external provider or treat a Sales Navigator subscription as automated API access.

An explicit operator-supplied drafting brief can replace generated-angle selection for event outreach, but not relationship checks or send approval.

**Why:** The user approved direct drafting after a detailed message brief was repeatedly blocked by the generated-angle prerequisite.

**How to apply:** Review current relationship history automatically for this path, preserve suppression and exclusion rules, and retain the server-reviewed context with the pending draft for approval validation. Never treat drafting as consent to send or invent recipient-specific personalization.

Normal Compose must also work when private context is empty: use the saved event/campaign brief and check history automatically. Generated angles are optional, not a mandatory drafting gate.

**Why:** The user repeatedly encountered the same prerequisite error after the supplied-brief fix because the ordinary Compose button submits no private context. Requiring them to paste the brief again did not solve the actual workflow.

**How to apply:** Cover absent, empty and whitespace-only private context in compose regression tests. Do not confuse private page-local answers with durable campaign context, and do not weaken suppression or send approval.

For automatic angle-generation history checks, distinguish no linked CRM record from failure to read a linked CRM record.

**Why:** Requiring CRM membership would exclude legitimate externally researched contacts, but treating a permission failure as empty history could generate misleading relationship suggestions.

**How to apply:** Allow missing links with visible coverage cautions; fail with retry/connection guidance when linked history reads fail. Do not silently change the separate compose or approval policy when adjusting angle generation.

Campaign contacts need overlapping classifications for why they are included: customer/partner relationships, explicit attendance, event roles such as speaker, custom tags, and source context.

**Why:** The user asked to tag and group people by these dimensions, including “what came from me” versus HubSpot.

**How to apply:** Keep classification campaign-specific, reuse the existing relationship/attendance truth, and preserve original import provenance separately from operator-entered source details. A speaker role or a free-text tag must not silently confirm attendance.

Meeting priority must remain separate from ICP fit. An inbound meeting request is a strong follow-up signal, not evidence of a matching title, industry, location, or company size.

**Why:** The user approved editable scoring facts and independent meeting priority after known contacts and an inbound requester both scored 20 based only on email and LinkedIn.

**How to apply:** Explain missing evidence separately from mismatches. Allow non-AI rescoring from operator-supplied campaign facts; retain those overrides through research. Do not manufacture fit scores, attendance, or send consent from meeting interest.

External correspondence belongs to the shared contact across campaigns; messaging direction belongs to a campaign membership. The user requested distinct directions for customers, prospective customers, partners and prospective partners.

**Why:** Manual email outside Orbit must inform the next draft, and an existing customer may also be a partner. Guessing one relationship from overlapping classifications can produce the wrong message.

**How to apply:** Require an explicit messaging group or shared-brief choice. Log actual sender, time, message and outcome; do not infer a reply or established partnership. Keep holds contact-wide and explicit. Follow-up dates are reminders, not consent or automatic scheduling. Editing/deleting shared activity must be clearly identified as affecting history across campaigns.

Familiarity with the campaign sender is independent of the customer/partner messaging group, with explicit cold, known, and unknown choices. Keep it campaign-specific rather than a global contact trait.

**Why:** A prospective partner can be an old acquaintance, while an employee at an existing customer can be unknown to the sender. The user approved bulk assignment of these independent dimensions.

**How to apply:** Preserve an unchanged dimension in bulk edits. Default familiarity to unknown; never infer it from CRM membership or company. Known contacts do not need a cold bio, but the label cannot invent shared experiences. Recorded correspondence takes precedence over a cold-introduction label.

Outside-Orbit messages and replies must be recordable without an existing Orbit message, directly from the campaign directory.

**Why:** The user explicitly needs to track separate outreach and out-of-band responses without reconstructing an Orbit send first.

**How to apply:** Distinguish received from sent activity and allow honest “content not recorded” notes rather than invented message text. Explicit replies stop that campaign's pending cadence; shared history informs other campaigns without marking all of them replied. Editing or deleting history must not automatically restart outreach.
