---
name: Responsive email + structured sections
description: How generated emails get mobile-readable output and the case-study/events/blog sections block
---
Generated emails (generated_emails) store a bare HTML fragment; AI output historically used 13–14px inline fonts, unreadable on mobile in both SendGrid sends and HubSpot pastes.

Rules:
- `enforceMinimumFontSize(html, 16)` (email-campaign-sender) bumps inline font-size <15px; applied at send time, at HubSpot generation-normalization, and in the export endpoint. Never regenerate copy to fix font size — enforce the floor.
- Structured sections (case study / upcoming events / recent updates) are rendered **server-side, deterministically** (email-sections-renderer) — never by the AI — into fluid-hybrid HTML: inline-block max-width columns that stack on mobile without media queries, PLUS MSO conditional fixed-width tables for Outlook desktop (Word engine ignores inline-block/max-width).
- Sections HTML is wrapped in `<!-- orbit:sections:start/end -->` markers; `appendSectionsToBody()` dedups on the marker and inserts before `</body>` when the stored body is a full document (raw suffix after `</html>` gets dropped by some clients).
- HubSpot paste path must use the export endpoint (`/api/email/saved/:id/export-html` → wrapResponsiveDocument + font floor), not the raw fragment copy.
- Section source queries must be tenant **and market** scoped (conferences allow null marketId); tenant-only scoping leaks cross-market content (caught in review).

**Why:** July–Aug 2026 mobile-unreadability complaints; three conventional HubSpot sections were always hand-built before this.
