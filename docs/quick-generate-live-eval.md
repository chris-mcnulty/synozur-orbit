# Quick Generate live grounding evaluation

Quick Generate's fast unit tests prove that prompts are constructed correctly.
This optional evaluation adds a second check: it sends three deliberately
sparse fixture prompts to a live AI provider and inspects every social post,
newsletter, and blog draft for likely fabricated names, collections, and
statistics.

## Run it manually

The check is deliberately excluded from normal tests because it consumes AI
quota and model output is nondeterministic:

```sh
npm run test:quick-generate-live-eval
```

The default is the configured Replit Anthropic provider and
`claude-sonnet-4-5`. To evaluate another configured combination, set both
values:

```sh
QUICK_GENERATE_EVAL_PROVIDER=azure_foundry \
QUICK_GENERATE_EVAL_MODEL=claude-sonnet-4-6 \
npm run test:quick-generate-live-eval
```

The test uses the production Quick Generate service functions, so it covers
the real social, newsletter, and prompt-grounded blog construction and
parsing paths. It bypasses route authentication and persistence, and calls the
selected provider directly so tenant AI configuration and response caching
cannot hide a live provider regression.

## Read the result

For each fixture the test prints a JSON report containing all three generated
deliverables and any flags. A failure means that the high-recall scanner found
something to review, not necessarily that the model invented a fact. Check the
printed output against that fixture's prompt:

- **possible_named_entity** — a quoted, title-cased, or all-caps name that
  does not appear in the prompt.
- **possible_collection** — a collection/series/product-line term missing
  from the prompt.
- **possible_statistic** — an unmatched numeric value, number word, or
  statistic-like claim.

Treat confirmed fabrications as a prompt-regression bug. False positives should
be reviewed before changing the scanner; keeping it high-recall is intentional.

## Optional CI

Normal CI must not run this test. A scheduled or manually triggered CI job may
run `npm run test:quick-generate-live-eval` only when AI credentials, the
desired provider/model, and an accepted quota budget are present. The test is
gated by `RUN_QUICK_GENERATE_LIVE_EVAL=1`, which the npm script sets.