import { describe, it, expect } from "vitest";
import { normalizeTitle, titleSimilarity, filterDuplicateTasks } from "./marketing-task-dedup";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation and filler words", () => {
    expect(normalizeTitle("Launch a LinkedIn Ad Campaign for Q2!")).toBe("launch linkedin ad campaign q2");
  });
});

describe("titleSimilarity", () => {
  it("returns 1 for identical normalized titles", () => {
    expect(titleSimilarity("launch linkedin ads", "launch linkedin ads")).toBe(1);
  });
  it("returns 0 for disjoint titles", () => {
    expect(titleSimilarity("host webinar series", "publish seo blog")).toBe(0);
  });
});

describe("filterDuplicateTasks", () => {
  const existing = [
    { title: "Launch LinkedIn advertising campaign", activityGroup: "digital_marketing" },
    { title: "Host quarterly webinar series", activityGroup: "webinars" },
  ];

  it("filters exact and near-identical suggestions", () => {
    const { unique, duplicates } = filterDuplicateTasks(
      [
        { title: "Launch a LinkedIn Advertising Campaign", activityGroup: "digital_marketing" },
        { title: "Host quarterly webinar series for customers", activityGroup: "webinars" },
        { title: "Publish SEO-optimized blog content", activityGroup: "content_marketing" },
      ],
      existing,
    );
    expect(unique.map(t => t.title)).toEqual(["Publish SEO-optimized blog content"]);
    expect(duplicates).toHaveLength(2);
  });

  it("dedups within the candidate batch itself", () => {
    const { unique } = filterDuplicateTasks(
      [
        { title: "Publish SEO blog content", activityGroup: "content_marketing" },
        { title: "Publish SEO blog content!", activityGroup: "content_marketing" },
      ],
      [],
    );
    expect(unique).toHaveLength(1);
  });

  it("keeps genuinely new tasks against dismissed history", () => {
    const { unique } = filterDuplicateTasks(
      [{ title: "Sponsor an industry trade show booth", activityGroup: "events" }],
      [{ title: "Launch LinkedIn advertising campaign", activityGroup: "digital_marketing" }],
    );
    expect(unique).toHaveLength(1);
  });
});
