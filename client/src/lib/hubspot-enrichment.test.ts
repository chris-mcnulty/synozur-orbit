import { describe, expect, it } from "vitest";
import { getHubspotEnrichmentHistorySummary } from "./hubspot-enrichment";

describe("getHubspotEnrichmentHistorySummary", () => {
  it("shows a successful zero-match sweep as completed rather than failed", () => {
    expect(getHubspotEnrichmentHistorySummary({
      enrichment: {
        status: "completed",
        completedAt: "2026-08-20T12:00:00.000Z",
        examined: 0,
        matched: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        rateLimited: 0,
      },
    })).toEqual({
      status: "completed",
      headline: "Contact enrichment completed",
      details: "Examined 0 · Matched 0 · Updated 0 · Skipped 0 · Failed 0",
      completedAt: "2026-08-20T12:00:00.000Z",
    });
  });

  it("shows completed contact counts and rate-limit deferrals", () => {
    expect(getHubspotEnrichmentHistorySummary({
      enrichment: {
        status: "completed",
        completedAt: "2026-08-20T12:00:00.000Z",
        examined: 10,
        matched: 7,
        updated: 7,
        skipped: 3,
        failed: 0,
        rateLimited: 2,
      },
    })).toMatchObject({
      status: "completed",
      details: "Examined 10 · Matched 7 · Updated 7 · Skipped 3 · Failed 0 · 2 rate-limited",
    });
  });

  it("shows a partial contact failure independently from an otherwise completed job", () => {
    expect(getHubspotEnrichmentHistorySummary({
      enrichment: {
        status: "completed",
        examined: 4,
        matched: 3,
        updated: 2,
        skipped: 1,
        failed: 1,
      },
    })).toMatchObject({
      status: "partial",
      headline: "Contact enrichment completed with 1 contact failure",
      details: "Examined 4 · Matched 3 · Updated 2 · Skipped 1 · Failed 1",
    });
  });

  it("shows a failed sweep and its error independently from outer job status", () => {
    expect(getHubspotEnrichmentHistorySummary({
      enrichment: {
        status: "failed",
        completedAt: "2026-08-20T12:00:00.000Z",
        error: "HubSpot search unavailable",
      },
    })).toEqual({
      status: "failed",
      headline: "Contact enrichment failed",
      details: "HubSpot search unavailable",
      completedAt: "2026-08-20T12:00:00.000Z",
    });
  });

  it("ignores other scheduled job result shapes", () => {
    expect(getHubspotEnrichmentHistorySummary({ status: "completed" })).toBeNull();
    expect(getHubspotEnrichmentHistorySummary(null)).toBeNull();
  });
});