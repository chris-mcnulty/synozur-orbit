---
name: GNews ideation/founding-signals scan relevance
description: Why the campaign ideation news scan must sort by relevance + phrase-match, not newest.
---

# GNews ideation news scan must favor relevance, not recency

The campaign ideation news scan (`scanNewsForSubjects` in `server/services/news-service.ts`,
consumed by ideation + frozen onto a campaign's Founding Signals) must:
- phrase-quote multi-word subjects (`"AI costs"`, not `AI costs`),
- query GNews with `sortby=relevance` and `in=title,description`.

**Why:** Production users saw a campaign's frozen "Founding Signals" GNews feed full of
the day's newest generic headlines (local jobs lists, politics, "pilots switch phones off"
syndicated ×6) that had nothing to do with their topic. Cause: subjects were sent to GNews
unquoted and `searchNews` sorted by `publishedAt`, so loose full-body keyword matches
returned the freshest off-topic stories. Relevance sort + phrase + title/description
matching keeps it on-topic.

**How to apply:** The competitor-monitoring path (`fetchCompetitorNews`) deliberately keeps
the recency default (`publishedAt`, no `in`) — `searchNews` opts are optional and only the
ideation scan passes them. Don't flip the competitor path to relevance. Accept that strict
quoted-phrase matching may return zero headlines for a subject; empty is better than junk
and the callers already handle empty gracefully.
