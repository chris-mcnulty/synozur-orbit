# Ask Orbit: first release

Ask Orbit is an authenticated **Enterprise/Unlimited**, read-only evidence workspace at
`/app/ask-orbit` (Home → Ask Orbit). It never edits intelligence, sends messages,
creates tasks, crawls, or performs live research. Standard User, Analyst, Domain Admin,
Consultant and Global Admin may use it within their existing authorized context.
Consultants do not gain access to a tenant without their existing active grant.
Partner API bearer tokens are not accepted by these endpoints.

## Configuration and accounting

`server/config/ask-orbit.ts` explicitly sets **200 attempts per tenant per UTC calendar
month**, shared across all users and markets, including the Unlimited plan. Change
`monthlyAllowance` there and restart to configure a different finite allowance.
Missing, zero, negative, non-integer or excessive settings fail closed with HTTP 503;
there is no implicit unlimited mode. The `askOrbit` plan feature can disable access,
but cannot enable non-Enterprise plans.

The server reserves one attempt atomically with inserting the question, using a
tenant advisory lock and monthly usage row in the same transaction. Invalid requests,
unauthorized records, simultaneous questions in a conversation and quota denials do
not consume an attempt. Once reserved, **success, no evidence, invalid AI output,
provider failures, timeout, cancellation, disconnect and worker interruption all
consume that attempt**. Deleting a conversation never refunds it.

Request IDs are idempotency keys, globally unique, bound to one conversation and
one exact question. Replaying a stored request never invokes AI or reserves again.
Only an explicit new question/retry with a new ID consumes another attempt. The AI
SDK has automatic retries disabled. Each attempted provider invocation logs `ask_orbit`
AI usage with its attempt ID, outcome, available token counts and incomplete-token
flag on failures. The durable turn records provider start even if a worker dies
before normal token logging; accurate final tokens are not always available after
provider/network interruption. Empty-source attempts have no provider charge and
are still recorded in the quota ledger. Interrupted processing becomes failed after
150 seconds, without a replacement call. Each conversation allows 100 turns; each
owner has at most 100 conversations per tenant/market.

## Evidence boundary

- Every conversation operation matches **tenant + market + owner**; administrators
  have no special access to another owner's conversations.
- Sources use tenant-domain AND active-market predicates. Legacy null-market
  records are included only in the default market; null-tenant data is excluded.
- Source feature gates are checked before reading material. Client-project
  records and non-baseline product roadmaps are excluded in this release.
- Bounded candidates: 50 competitor profiles, 80 changes, 12 briefings, 6 of
  each baseline GTM/messaging plan, 12 marketing plans with up to 20 tasks each,
  and 50 roadmap items. At most 24 ranked records, 4,000 characters each,
  enter a prompt. This is not exhaustive semantic search.
- Follow-ups receive at most six completed prior questions/selected excerpts
  for reference resolution, never as authoritative current evidence.
- Sources and conversation are explicitly untrusted data in a separate system
  instruction. No tools or write capabilities are supplied to the model.
- This release deliberately uses **extractive answers**: the model selects up to
  six exact source quotations, rather than writing new factual claims. The server
  checks every source ID and contiguous quotation before releasing the answer,
  and supplies titles, dates and links itself. Invalid output fails the turn;
  it is not repaired with another paid generation.
- Plans describe intentions; briefings contain prior AI analysis. Citation proves
  what a stored record said, not independent real-world truth or relevance.
  Old (over 30 days) or undated evidence is flagged. Missing evidence cannot prove
  absence. Competitor freshness is last full crawl; strategy freshness is the source
  data timestamp, not the date an editor last touched the plan.

## Streaming and privacy

SSE sends loading/progress updates while the provider streams internally. Model
output is buffered until all citations validate; only validated answer text is
streamed to the browser. This intentionally trades token-by-token preview for
verifiable citations and no partial ungrounded output.

Stopping persists cancellation before aborting the provider. Other server instances
observe cancellation through polling; final persistence conditionally updates only
processing turns, so late completions cannot resurrect stopped/deleted answers.
Closing the stream aborts work. Context switches dispatch a tab-context event, clear
the view, stop/abort the old request with its captured original headers, and ignore
late callbacks. Context identity includes user, tenant and market. History endpoints
use no-store responses. React renders text, not source HTML or model-authored links.

Tests use isolated PostgreSQL schemas and mocked provider results: they make no
paid AI calls and do not modify production intelligence. Visual inspection without
a signed-in browser can verify only the authentication boundary; it cannot verify
the authenticated page itself.
