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

Campaign contacts need overlapping classifications for why they are included: customer/partner relationships, explicit attendance, event roles such as speaker, custom tags, and source context.

**Why:** The user asked to tag and group people by these dimensions, including “what came from me” versus HubSpot.

**How to apply:** Keep classification campaign-specific, reuse the existing relationship/attendance truth, and preserve original import provenance separately from operator-entered source details. A speaker role or a free-text tag must not silently confirm attendance.
