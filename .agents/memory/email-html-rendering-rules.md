---
name: Email HTML rendering rules
description: Hard-won rules for SendGrid/HubSpot email HTML — images, tracking links, CTA buttons, dark mode, CAN-SPAM.
---

# Email HTML rendering rules

- **Never rewrite `<img src>` through the `/r/` tracking redirector.** `wrapOutboundLinksInText` once matched a logo's absolute URL inside `src="..."` and turned it into a redirect (image rendered as garbage). The replacer now skips any occurrence preceded by `src=` (case/whitespace tolerant).
- **Recipients fetch images from the public internet.** Relative `/objects/` or `/public-objects/` srcs break. At send time the sender publishes private objects to the public bucket (deterministic `email-images/<id>` path) and absolutizes srcs with baseUrl — gated on tenant ownership (path referenced by tenant's content/brand asset), `image/*` MIME, 10 MB cap, or a pasted private path could leak via `/public-objects/`.
- **Never add `background-color:inherit !important` dark-mode CSS.** It wipes `td bgcolor` on CTA buttons/stat cards → invisible buttons. Use `color-scheme: light` meta only; also `hardenCtaButtons` copies td bgcolor onto the anchor inline style.
- **AI email prompt must not generate About/sign-off/footer** — the platform appends the General Information section + compliance footer at send time; otherwise About appears twice.
- **Header/logo selection:** logo = brand asset with "logo" in name or assetType logo (never "any image"); a brand asset named `*header*` becomes the full-width prebuilt header image via HEADER_RULE in marketing-saturn.ts.
- **CAN-SPAM:** `tenants.mailing_address` (migration 0079) injected into HTML+text footers; editable in Settings → Branding. Sends are not yet blocked when empty (follow-up task exists).
