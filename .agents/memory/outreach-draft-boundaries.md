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
