---
name: compliance
description: Compliance and content checks that gate every outbound send in the [YOUR_FIRM] sales harness. Use whenever the Composer drafts an outbound email/Teams message or the Cadence skill prepares to queue a templated step. Enforces banned-phrase scans, suppression-list lookup, CAN-SPAM (US), GDPR (EU/UK), and send-cap checks.
cowork:
  category: automation
  icon: CheckmarkCircle
---

# Compliance

Every outbound message — first-touch, reply, or templated cadence step — must pass these checks. The Composer runs them at draft time. The Cadence skill runs them again immediately before any queued send.

## Files in this skill

- `banned-phrases.md` — exact strings the Composer must not emit. Cliché outbound language plus voice-specific bans merged from `outbound-voice/voice-dna.md`.
- `suppression-list.md` — emails and domains never to contact. Maintained as a flat list. Append on opt-out; never remove without an explicit human decision.

CAN-SPAM and GDPR rules are encoded inline in the checks below (no separate files in v1).

## Checks

For every draft, in order:

1. **Suppression check.** Is the recipient's email or domain on `suppression-list.md`? If yes → hard fail. Move lead to `state: dormant` with `do_not_contact: true` and never draft again.
2. **Banned-phrases scan.** Any string from `banned-phrases.md` in the draft body or subject? If yes → redraft. Maximum 3 redraft attempts; after that, save with `hold_reason: voice` and flag for human review.
3. **CAN-SPAM** (US sends). Verify:
   - Sender name and address match the configured `OUTLOOK_FROM` (currently `[YOUR_OUTLOOK_EMAIL]`)
   - Reply-to is a real, monitored mailbox
   - A physical [YOUR_FIRM] address appears in the signature
   - An unsubscribe path exists (a plain "reply STOP works" line counts for one-to-one B2B; bulk sends need a real unsubscribe link)
4. **GDPR** (EU/UK recipients). Verify:
   - Lawful basis recorded on the lead (`lawful_basis:` in frontmatter: legitimate-interest, consent, or contract). If absent → hard hold until the operator records it.
   - Subject and body contain no special-category data.
5. **Send-cap check.** Per-rep daily, per-domain weekly, campaign reply-rate floor. See `kill-switches/triggers.md`.

## Failure modes

- Hard fail (suppression, GDPR-missing) → log, stop, do not draft again without explicit operator action.
- Soft fail (banned phrase, send-cap) → save with a `hold_reason`. The operator decides whether to send by hand.

## Audit

Every send must log to the prospect MD file's `## Audit` section:
- Timestamp
- Compliance checks run
- Pass/fail per check
- Final disposition (sent / held / blocked)
