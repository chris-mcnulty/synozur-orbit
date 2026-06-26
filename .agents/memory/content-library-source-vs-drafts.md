---
name: Content library = url-fronted source assets only
description: Rule for what belongs in the Digital/Web Assets library vs generated drafts, and how it's enforced.
---

# Digital/Web Assets library = URL-fronted source assets only

The "Digital/Web Assets" library (page `content-library.tsx`, backed by the
`content_assets` table via `GET /api/content-assets` in
`server/routes/marketing-saturn.ts`) is, per the user (tenant Synozur), ONLY for
URL-fronted, publicly-accessible **finished-good SOURCE** assets used to generate
outbound social/email. It is NOT a place for generated deliverables.

Generated drafts (editorial calendar "draft from brief" flow in
`server/routes/editorial-calendar.ts`) are also stored as `content_assets` rows
(so they can be edited and exported to a branded Word .docx by id), but they have
`content` and **no `url`/`fileUrl`**.

**Rule / enforcement:** the library list query keeps only assets where
`url` is non-empty OR `fileUrl` is non-null. Drafts (content-only) are excluded.
The same single endpoint also feeds source-asset pickers, so this one filter also
stops drafts from being pulled into outbound campaigns. `url` is normalized to
`null` on create/update so blank/whitespace doesn't slip through.

**Why this approach:** chosen over (a) a brief-link filter — brittle, breaks if
the brief link is lost, and dev had zero brief-linked rows so it was unverifiable;
and (b) an explicit `isDraft` column — avoids a migration. The url-presence rule
matches the user's own definition exactly and is self-correcting (existing url-less
drafts vanish from the library with no backfill).

**How to apply:** if a future flow needs a legitimate library asset with no public
URL, this rule would hide it — at that point introduce an explicit
`isSourceAsset`/`origin` flag instead of loosening the url filter.

**Extended rule (confirmed):** long-form repurposed drafts (blog posts, podcast
outlines, whitepapers, etc.) are in the same category as social post drafts — they
do NOT go to Content Library. Repurposed long-form → Content Briefs (drafted
brief + linked asset). Only a human-curated decision to add a URL elevates something
into the Library. Even published podcasts are only 10-20% Library-worthy.
