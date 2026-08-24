import { describe, expect, it } from "vitest";
import {
  QUICK_GENERATE_EVAL_FIXTURES,
  scanQuickGenerateGrounding,
} from "../quick-generate-grounding-eval";

describe("Quick Generate live-eval grounding scanner", () => {
  const fixture = QUICK_GENERATE_EVAL_FIXTURES[1];

  it("permits names and quantities present in the fixture prompt", () => {
    const flags = scanQuickGenerateGrounding(
      fixture,
      "Northbridge Studio welcomes visitors to its October 14 ceramics workshop at 12 River Lane. Reserve one of 24 seats for $35.",
    );
    expect(flags).toEqual([]);
  });

  it("flags added names, collections, and statistics for human review", () => {
    const flags = scanQuickGenerateGrounding(
      fixture,
      'The award-winning "Autumn Clay Collection" at Cedar Valley Gallery has welcomed 48 guests and grew 40%.',
    );
    expect(flags.map((flag) => [flag.kind, flag.value])).toEqual(
      expect.arrayContaining([
        ["possible_named_entity", "Autumn Clay Collection"],
        ["possible_named_entity", "Cedar Valley Gallery"],
        ["possible_collection", "Collection"],
        ["possible_statistic", "award-winning"],
        ["possible_statistic", "48"],
        ["possible_statistic", "40%"],
      ]),
    );
  });
});