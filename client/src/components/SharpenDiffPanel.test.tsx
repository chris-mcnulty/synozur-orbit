// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { groupParagraphOps } from "./SharpenDiffPanel";
import { SharpenDiffPanel } from "./SharpenDiffPanel";

// ── groupParagraphOps unit tests ──────────────────────────────────────────────

describe("groupParagraphOps", () => {
  it("returns empty array for empty input", () => {
    expect(groupParagraphOps([])).toEqual([]);
  });

  it("groups all-equal ops into one equal segment", () => {
    const ops = [
      { type: "equal" as const, value: "line 1" },
      { type: "equal" as const, value: "line 2" },
    ];
    const segs = groupParagraphOps(ops);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("equal");
  });

  it("groups mixed remove+insert run into a replaced segment", () => {
    const ops = [
      { type: "remove" as const, value: "old line 1" },
      { type: "remove" as const, value: "old line 2" },
      { type: "insert" as const, value: "new line 1" },
      { type: "insert" as const, value: "new line 2" },
    ];
    const segs = groupParagraphOps(ops);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("replaced");
    if (segs[0].type === "replaced") {
      expect(segs[0].removes).toHaveLength(2);
      expect(segs[0].inserts).toHaveLength(2);
    }
  });

  it("keeps pure-remove run as pure_change (not replaced)", () => {
    const ops = [
      { type: "remove" as const, value: "deleted line 1" },
      { type: "remove" as const, value: "deleted line 2" },
      { type: "remove" as const, value: "deleted line 3" },
    ];
    const segs = groupParagraphOps(ops);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("pure_change");
    if (segs[0].type === "pure_change") {
      expect(segs[0].removes).toHaveLength(3);
      expect(segs[0].inserts).toHaveLength(0);
    }
  });

  it("keeps pure-insert run as pure_change (not replaced)", () => {
    const ops = [
      { type: "insert" as const, value: "new line 1" },
      { type: "insert" as const, value: "new line 2" },
      { type: "insert" as const, value: "new line 3" },
    ];
    const segs = groupParagraphOps(ops);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("pure_change");
    if (segs[0].type === "pure_change") {
      expect(segs[0].removes).toHaveLength(0);
      expect(segs[0].inserts).toHaveLength(3);
    }
  });

  it("handles mixed equal + replaced + pure_change sequence", () => {
    const ops = [
      { type: "equal" as const, value: "header" },
      { type: "remove" as const, value: "old body line" },
      { type: "insert" as const, value: "new body line" },
      { type: "equal" as const, value: "footer" },
      { type: "insert" as const, value: "appended line" },
    ];
    const segs = groupParagraphOps(ops);
    expect(segs).toHaveLength(4);
    expect(segs[0].type).toBe("equal");
    expect(segs[1].type).toBe("replaced");
    expect(segs[2].type).toBe("equal");
    expect(segs[3].type).toBe("pure_change");
  });
});

// ── SharpenDiffPanel render tests ─────────────────────────────────────────────

// Helper: generate N non-empty unique lines for large-doc tests
function makeLines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");
}

// Large strings that force paragraph mode (> WORD_DIFF_THRESHOLD = 2000 words).
// Each line is ~4 words; 350 lines × 4 words × 2 sides = 2800 words > 2000.
const LARGE_BEFORE = makeLines("old paragraph line", 350);
const LARGE_AFTER = makeLines("new paragraph line", 350);

describe("SharpenDiffPanel rendering", () => {
  afterEach(cleanup);
  it("shows collapse toggle when a replaced block has >2 non-empty lines", () => {
    render(
      <SharpenDiffPanel before={LARGE_BEFORE} after={LARGE_AFTER} />,
    );
    // There should be at least one "replaced" toggle button
    const toggles = screen.getAllByTestId(/^sharpen-replaced-toggle-/);
    expect(toggles.length).toBeGreaterThan(0);
    // The toggle button text includes "lines replaced"
    expect(toggles[0].textContent).toMatch(/lines replaced/);
  });

  it("expand toggle shows the replaced content panel", () => {
    render(
      <SharpenDiffPanel before={LARGE_BEFORE} after={LARGE_AFTER} />,
    );
    const toggle = screen.getAllByTestId(/^sharpen-replaced-toggle-/)[0];
    // Content panel should not exist before expanding
    const idx = toggle.getAttribute("data-testid")!.replace("sharpen-replaced-toggle-", "");
    expect(screen.queryByTestId(`sharpen-replaced-content-${idx}`)).toBeNull();
    // Click to expand
    fireEvent.click(toggle);
    expect(screen.getByTestId(`sharpen-replaced-content-${idx}`)).toBeTruthy();
  });

  it("does not show a toggle for a pure-addition block", () => {
    // Create a before string with a shared section + pure additions in "after".
    // Use 5-word prefixes so total words exceed 2000 without hitting MAX_PARAGRAPHS
    // (500 lines): 250 shared (5w) + 200 extra (5w) = 450 total lines; words =
    // 250×5 + 450×5 = 1250 + 2250 = 3500 > 2000.
    const sharedLines = makeLines("shared base content paragraph line", 250);
    const extraLines = makeLines("added extra content paragraph line", 200);
    const before = sharedLines;
    const after = sharedLines + "\n" + extraLines;

    render(<SharpenDiffPanel before={before} after={after} />);

    // If there's no replaced block (only equal + pure insert), there should be
    // no toggle button at all
    const toggles = screen.queryAllByTestId(/^sharpen-replaced-toggle-/);
    expect(toggles).toHaveLength(0);
  });

  it("renders inline (no toggle) when a replaced block has ≤2 non-empty lines", () => {
    // Construct a paragraph-mode diff with exactly one small replaced run
    // by using large equal sections around a single-line swap.
    // Use enough lines to force paragraph mode (> 2000 words total).
    const equalLines = makeLines("common line", 350);
    const before = equalLines + "\nonly old line";
    const after = equalLines + "\nonly new line";

    render(<SharpenDiffPanel before={before} after={after} />);

    // No toggle button — the 1-line replacement renders inline
    const toggles = screen.queryAllByTestId(/^sharpen-replaced-toggle-/);
    expect(toggles).toHaveLength(0);
    // The paragraph container is present
    expect(screen.getByTestId("sharpen-paragraph")).toBeTruthy();
  });
});
