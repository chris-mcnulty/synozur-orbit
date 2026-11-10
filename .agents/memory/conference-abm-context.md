---
name: Conference ABM context
description: User requirements for relationship-aware event meeting development and shared promotion context.
---

Conference meeting development must distinguish relationship roles such as customer and partner, and use the organization's event goals, actual presence, and relevant speaking sessions as context.

**Why:** The user explicitly requested relationship-specific meeting development, not only new-prospect discovery, and a connection to Event Promotion where relevant.

**How to apply:** When designing this addition, reuse confirmed event facts across ABM and Event Promotion instead of creating conflicting briefs. Keep this as a design requirement, not a claim that integration has shipped. Do not infer attendance, speaking, or exhibiting from generic goals; follow the explicit event-confirmation rules.

Wiza and Sales Navigator are external research tools for this workflow. Use Apollo in-app; when it produces no usable contacts, support reviewed imports of contacts the operator finds externally rather than adding Wiza or Sales Navigator integrations.

**Why:** The user explicitly chose external Wiza and Sales Navigator research as the fallback to Apollo.

**How to apply:** Preserve source attribution on reviewed imports. Do not silently invoke either external provider or treat a Sales Navigator subscription as automated API access.
