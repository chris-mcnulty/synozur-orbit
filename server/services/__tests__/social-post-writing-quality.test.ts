import { describe, expect, it } from "vitest";
import {
  findSocialPostSlopViolations,
  SOCIAL_POST_NO_SLOP_RULES,
} from "../social-post-writing-quality";

describe("social post writing quality", () => {
  it.each([
    ["Hot take: every team needs a new dashboard.", "hot-take opener"],
    ["What if your weekly planning meeting had one clear decision?", "what-if opener"],
    ["Did you know most launch plans fail before launch day?", "rhetorical setup"],
    ["Here's the thing: distribution needs an owner.", "faux-insight opener"],
    ["In today's fast-moving landscape, every team needs a strategy.", "throat-clearing opener"],
    ["This is not just a reporting change, but also a workflow change.", "binary contrast"],
    ["At the end of the day, the real win is alignment.", "fake-profound kicker"],
    ["This isn't a model problem. It's an evaluation problem.", "binary reframe"],
    ["It’s not a dashboard. It’s a decision.", "binary reframe"],
    ["The question isn’t the model, it’s the eval.", "binary reframe"],
    ["This is not reporting; it is planning.", "binary reframe"],
    ["Not a dashboard. Not a report. A decision.", "negative listing"],
    ["The team shipped it. What if this is really a workflow problem?", "what-if reframe"],
    ["The team shipped it. What if I told you the dashboard was optional?", "what-if reframe"],
    ["The result? Teams finally aligned.", "self-answered dramatic question"],
  ])("flags %s", (content, expectedViolation) => {
    expect(findSocialPostSlopViolations(content)).toContain(expectedViolation);
  });

  it("allows a specific, grounded opening", () => {
    expect(
      findSocialPostSlopViolations(
        "Three approval steps delayed the release by nine days. The team removed one handoff and shipped the following week.",
      ),
    ).toEqual([]);
  });

  it("makes prohibited opening styles explicit in the shared prompt rules", () => {
    expect(SOCIAL_POST_NO_SLOP_RULES).toContain("hot take");
    expect(SOCIAL_POST_NO_SLOP_RULES).toContain("what if");
    expect(SOCIAL_POST_NO_SLOP_RULES).toContain("rhetorical setup");
  });

  it.each([
    'The article criticizes “This isn’t X. It’s Y.” as a writing pattern.',
    '> This isn’t a model problem. It’s an evaluation problem.\nThe author uses this as an example.',
    "Use a robust estimator for these measurements. Ecosystem is the product name.",
    "The migration is not complete. It needs another review.",
    "What if the database fails during migration is a real recovery question.",
    "This release has three fixes: retries, logging, and validation.",
    "The team asked what if the backup failed before testing recovery.",
  ])("preserves legitimate language: %s", (content) => {
    // The pre-existing opening-question rule still disallows a 'What if' hook.
    if (!content.startsWith("What if")) expect(findSocialPostSlopViolations(content)).toEqual([]);
    else expect(findSocialPostSlopViolations(content)).not.toContain("what-if reframe");
  });
});