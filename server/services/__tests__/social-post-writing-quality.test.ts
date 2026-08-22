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
});