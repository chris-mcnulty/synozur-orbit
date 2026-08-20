export interface HubspotContactEnrichmentSummary {
  status?: "completed" | "failed";
  completedAt?: string;
  examined?: number;
  matched?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  rateLimited?: number;
  error?: string;
}

export interface HubspotEnrichmentHistorySummary {
  status: "completed" | "partial" | "failed";
  headline: string;
  details: string;
  completedAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Extract the contact-enrichment result embedded in a scheduled HubSpot job.
 * Other scheduled job result shapes safely return null.
 */
export function getHubspotEnrichmentHistorySummary(result: unknown): HubspotEnrichmentHistorySummary | null {
  const resultRecord = asRecord(result);
  const enrichment = asRecord(resultRecord?.enrichment);
  if (!enrichment) return null;

  const completedAt = typeof enrichment.completedAt === "string" ? enrichment.completedAt : null;
  const examined = count(enrichment.examined);
  const matched = count(enrichment.matched);
  const updated = count(enrichment.updated);
  const skipped = count(enrichment.skipped);
  const failed = count(enrichment.failed);
  const rateLimited = count(enrichment.rateLimited);
  const counts = `Examined ${examined} · Matched ${matched} · Updated ${updated} · Skipped ${skipped} · Failed ${failed}${rateLimited > 0 ? ` · ${rateLimited} rate-limited` : ""}`;

  if (enrichment.status === "failed") {
    const error = typeof enrichment.error === "string" && enrichment.error.trim()
      ? enrichment.error.trim()
      : "The enrichment sweep could not complete.";
    return {
      status: "failed",
      headline: "Contact enrichment failed",
      details: error,
      completedAt,
    };
  }

  if (failed > 0) {
    return {
      status: "partial",
      headline: `Contact enrichment completed with ${failed} contact failure${failed === 1 ? "" : "s"}`,
      details: counts,
      completedAt,
    };
  }

  return {
    status: "completed",
    headline: "Contact enrichment completed",
    details: counts,
    completedAt,
  };
}