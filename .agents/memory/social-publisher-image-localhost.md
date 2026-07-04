---
name: Social publisher image fetch — use localhost
description: Twitter and LinkedIn publishers must rewrite /public-objects/ URLs to localhost before fetching — public-domain self-requests are unreliable in production.
---

## The rule
When a social publisher (Twitter, LinkedIn) fetches a post image server-side before uploading it to the platform's media API, any URL whose path starts with `/public-objects/` must be rewritten to `http://localhost:PORT/public-objects/...` regardless of what host appears in the absolute URL.

**Why:** Object-storage images are served via the `/public-objects/` Express route on the same server. In production the absolute URL is `https://orbit.synozur.com/public-objects/...`. When the publisher fetches that URL it makes an HTTP request from the server to itself through the public domain — a self-request that can fail due to Replit routing/TLS behaviour even though the file is healthy and the route is auth-free. Fetching via `localhost` avoids the round-trip entirely.

**How to apply:**
```typescript
const absoluteUrl = (() => {
  if (imageUrl.startsWith("/")) {
    return `http://localhost:${process.env.PORT ?? 5000}${imageUrl}`;
  }
  try {
    const parsed = new URL(imageUrl);
    if (parsed.pathname.startsWith("/public-objects/")) {
      return `http://localhost:${process.env.PORT ?? 5000}${parsed.pathname}${parsed.search}`;
    }
  } catch { /* not a valid URL — fall through */ }
  return imageUrl;
})();
```

Already applied to: `server/services/social-publishers/twitter.ts` (`uploadMedia`) and `server/services/social-publishers/linkedin.ts` (`uploadImageAsset`).

**NOT applied to Instagram:** Instagram's Graph API fetches the image from its own servers (not Orbit's), so the URL genuinely must be publicly reachable. That publisher is different by design.

**Error messages:** When an image upload fails and the post has an `overrideImageUrl` (Orbit-generated), the error message should say it is a server-side issue and point to the Retry button — NOT tell the user to "fix the image" (which wrongly implies they created a broken URL).
