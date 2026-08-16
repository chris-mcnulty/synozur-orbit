import { describe, it, expect } from "vitest";
import {
  emptyNeedsMap,
  emptyMoneyRange,
  clampPriorityScore,
  isValidMoneyRange,
  DEFAULT_CURRENCY,
} from "./market-intelligence";

describe("market-intelligence constructors", () => {
  it("emptyNeedsMap has all four fields as empty arrays", () => {
    expect(emptyNeedsMap()).toEqual({ pains: [], triggers: [], barriers: [], buyingCriteria: [] });
  });

  it("emptyMoneyRange defaults to USD and zeroes", () => {
    expect(emptyMoneyRange()).toEqual({ low: 0, mid: 0, high: 0, currency: DEFAULT_CURRENCY });
    expect(emptyMoneyRange("EUR").currency).toBe("EUR");
  });
});

describe("clampPriorityScore", () => {
  it("clamps and rounds into 1..10", () => {
    expect(clampPriorityScore(0)).toBe(1);
    expect(clampPriorityScore(11)).toBe(10);
    expect(clampPriorityScore(7.4)).toBe(7);
    expect(clampPriorityScore(7.6)).toBe(8);
  });
  it("falls back to 1 on non-finite input (NaN and Infinity alike)", () => {
    expect(clampPriorityScore(NaN)).toBe(1);
    expect(clampPriorityScore(Infinity)).toBe(1);
    expect(clampPriorityScore(-Infinity)).toBe(1);
  });
});

describe("isValidMoneyRange", () => {
  it("accepts a well-ordered non-negative range", () => {
    expect(isValidMoneyRange({ low: 10, mid: 20, high: 30, currency: "USD" })).toBe(true);
    expect(isValidMoneyRange({ low: 5, mid: 5, high: 5, currency: "USD" })).toBe(true);
  });
  it("rejects mis-ordered, negative, or missing ranges", () => {
    expect(isValidMoneyRange({ low: 30, mid: 20, high: 10, currency: "USD" })).toBe(false);
    expect(isValidMoneyRange({ low: -1, mid: 0, high: 1, currency: "USD" })).toBe(false);
    expect(isValidMoneyRange(null)).toBe(false);
    expect(isValidMoneyRange(undefined)).toBe(false);
  });
});
