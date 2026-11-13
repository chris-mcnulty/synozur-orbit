---
name: Outreach draft boundaries
description: Refusals and clarification questions are operator-only responses, never recipient email drafts.
---

Never save an AI refusal, drafting explanation, or questions addressed to the sender as an outreach email to the prospect. Give the sender a separate way to answer questions and retry with the same recipient and channel.

**Why:** The user reported refusal text being saved as an email to the same person, while its clarification questions had no answer mechanism. An arbitrary-text fallback is unsafe for recipient-facing generation.

**How to apply:** Require a complete draft before persistence or prospect status advancement. Keep non-draft outcomes separate from recipient drafts, preserve entered clarification across retries, and do not automatically delete historical records or send a retry. Check older drafts for assistant notes before external delivery.

Clarification must stay readable and answerable, not live only in a temporary notification. Hiding the clarification window is not permission to discard the questions or the seller's answers.

**Why:** The user again reported an Avanade compose attempt showing raw Markdown questions in a disappearing window with no usable way to note answers.

**How to apply:** Keep a way to resume the pending clarification on the campaign page; discard only on an explicit discard action or successful completion. Preserve answers through failed retries, keep different recipients/channels separate, and retain question text while the seller types. Never expose rejected draft sections as if they were the assistant's clarification explanation.

Explicit sender facts about their own relationship take precedence over automated research's “unconfirmed” or missing evidence. An exploratory recipient question must not become a prerequisite question to the sender.

**Why:** The user supplied a known partner/reseller relationship and asked to explore the recipient's Microsoft work; drafting instead demanded vendor certification and AI practice confirmation. These are distinct relationships, and asking about work does not assert that it exists.

**How to apply:** Use the supplied relationship without inventing vendor credentials, attendance or shared experiences. Ask the recipient about unknown work or omit optional claims. Never require reconfirmation merely because public research lacks evidence, and retain all consent, exclusion and hold protections.

An explicitly declared personal friendship must change drafting tone, not merely appear as a contact tag. Keep personal familiarity independent of business categories such as customer or partner.

**Why:** The user reported that classifying a personal friendship was not available and the system was producing overly formal emails to friends.

**How to apply:** Use a warm, conversational opening without a cold introduction or invented shared memories. Do not infer friendship from a generic personal tag or business relationship. Preserve factual accuracy, holds, opt-outs and reviewed delivery.

Users insert their own rich signatures in Outlook after opening Orbit-created drafts. Signature graphics, styling and links must remain usable; Orbit should not generate or duplicate the seller's signature.

**Why:** The user reported that plain-text Outlook drafts stripped their signature's graphical content and links.

**How to apply:** Keep the Outlook handoff HTML-compatible while preserving the reviewed message text. Do not regenerate copy during approval, invent a signature, rewrite existing mailbox drafts, or change the human-reviewed draft-and-send workflow.
