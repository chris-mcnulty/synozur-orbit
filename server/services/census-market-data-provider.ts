/**
 * Census Market Data Provider — Strategic Intelligence Stack (Task #543, Phase 1)
 *
 * The free, authoritative backbone for BOTTOM-UP TAM/SAM. Queries the U.S.
 * Census Bureau (Dept. of Commerce) County Business Patterns (CBP) API for the
 * number of business establishments — plus employment and payroll — by NAICS
 * industry, geography, and employment size class. Combined with the segment's
 * ACV (from pricing-intelligence) this yields a defensible, citable bottom-up
 * market size that cross-checks the top-down published figures we get via
 * completeWithWebSearch.
 *
 * Design notes:
 *  - CBP is a live JSON API and requires a FREE api key (process.env.CENSUS_API_KEY).
 *    Get one at https://api.census.gov/data/key_signup.html.
 *  - CBP responses are arrays-of-arrays (row 0 = headers); we parse to objects.
 *  - This provider degrades gracefully: if no key is configured, callers should
 *    fall back to Apollo counts + web-search only. Nothing here throws on a
 *    missing key except the direct network calls (guarded by isCensusAvailable).
 *  - US-only. International segments need Eurostat/ONS/etc. providers (future).
 *  - SUSB receipts (revenue by enterprise size) is a bulk-CSV dataset, not a
 *    live API — see getReceiptsByIndustry (documented stub for a later phase).
 *
 * Docs: https://www.census.gov/data/developers/data-sets/cbp-zbp/cbp-api.html
 */

// Type-only (erased at runtime) so this provider's runtime import graph stays
// free of the db-backed AI layer — keeps buildCbpQueryUrl et al. unit-testable.
import type { NaicsMatch } from "./naics-crosswalk";

// Most recent CBP vintage. CBP lags ~2 years; bump as new years publish. The
// NAICS predicate is NAICS2017 for the 2022 vintage.
const CBP_DEFAULT_YEAR = 2022;
const CBP_BASE = "https://api.census.gov/data";
const CBP_VARIABLES = ["NAICS2017", "NAICS2017_LABEL", "ESTAB", "EMP", "PAYANN"] as const;

export interface CensusIndustryStats {
  naics: string;
  naicsLabel: string;
  /** Number of business establishments. */
  establishments: number;
  /** Paid employment (week of March 12). */
  employment: number;
  /** Annual payroll, in whole USD (CBP reports thousands; we scale up). */
  annualPayroll: number;
  year: number;
  /** Census geography spec used, e.g. "us:*" or "state:06". */
  geography: string;
}

export interface BusinessCountsParams {
  /** A single NAICS-2017 code, 2–6 digits or a sector range like "31-33". */
  naicsCode: string;
  /** Census `for` predicate. Defaults to national ("us:*"). */
  geographyFor?: string;
  /** Optional EMPSZES employment-size-class code (see EMPSZES note below). */
  empSizeClass?: string;
  year?: number;
}

/**
 * EMPSZES (employment size class) reference codes.
 *
 * ⚠️ These vary by CBP vintage — VERIFY against the live variables endpoint
 * before relying on size-filtered queries in production:
 *   https://api.census.gov/data/2022/cbp/variables/EMPSZES.json
 * v1 sizing deliberately queries ALL establishments (no size filter) so an
 * unverified code can never silently skew a market estimate. Kept here so the
 * size-band enhancement is a one-line change once codes are confirmed.
 */
export const EMPSZES_ALL = "001";

export function isCensusAvailable(): boolean {
  return !!process.env.CENSUS_API_KEY?.trim();
}

export function censusReason(): string {
  return isCensusAvailable()
    ? "Census CBP configured"
    : "CENSUS_API_KEY not set — get a free key at https://api.census.gov/data/key_signup.html";
}

/**
 * Build a CBP API query URL. Pure and exported so it can be unit-tested without
 * a network call. `apiKey` is appended last; pass "" in tests.
 */
export function buildCbpQueryUrl(params: BusinessCountsParams & { apiKey: string }): string {
  const year = params.year ?? CBP_DEFAULT_YEAR;
  const qs = new URLSearchParams();
  qs.set("get", CBP_VARIABLES.join(","));
  qs.set("for", params.geographyFor ?? "us:*");
  qs.set("NAICS2017", params.naicsCode);
  if (params.empSizeClass) qs.set("EMPSZES", params.empSizeClass);
  if (params.apiKey) qs.set("key", params.apiKey);
  return `${CBP_BASE}/${year}/cbp?${qs.toString()}`;
}

/**
 * Fetch establishment counts for one NAICS code from CBP. Returns null when the
 * key is missing, the query errors, or Census suppresses the cell (thin
 * industries are withheld for disclosure avoidance).
 */
export async function getBusinessCounts(
  params: BusinessCountsParams,
): Promise<CensusIndustryStats | null> {
  const apiKey = process.env.CENSUS_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[census] getBusinessCounts called without CENSUS_API_KEY — skipping");
    return null;
  }

  const url = buildCbpQueryUrl({ ...params, apiKey });
  const year = params.year ?? CBP_DEFAULT_YEAR;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 204 = valid query, no data for that cell; anything else is a real error.
      if (res.status !== 204) {
        console.warn(`[census] CBP ${params.naicsCode} → HTTP ${res.status}`);
      }
      return null;
    }
    const rows = (await res.json()) as string[][];
    // rows[0] is the header; need at least one data row.
    if (!Array.isArray(rows) || rows.length < 2) return null;

    const header = rows[0];
    const data = rows[1];
    const idx = (col: string) => header.indexOf(col);

    const estab = toNum(data[idx("ESTAB")]);
    return {
      naics: data[idx("NAICS2017")] ?? params.naicsCode,
      naicsLabel: data[idx("NAICS2017_LABEL")] ?? "",
      establishments: estab,
      employment: toNum(data[idx("EMP")]),
      // CBP PAYANN is in $1,000s → scale to whole dollars.
      annualPayroll: toNum(data[idx("PAYANN")]) * 1000,
      year,
      geography: params.geographyFor ?? "us:*",
    };
  } catch (err: any) {
    console.warn(`[census] CBP fetch failed for ${params.naicsCode}: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Convenience: resolve a segment's industry text to NAICS codes, then pull CBP
 * counts for each. Returns the NAICS matches alongside their stats (stats null
 * where Census had no/suppressed data) so the sizing service can show its work.
 *
 * v1 queries ALL establishments nationally; geography + size-class filtering
 * (from the segment's firmographics) is a documented follow-up once EMPSZES
 * codes are verified and a geography crosswalk exists.
 */
export async function getIndustryStatsForSegment(
  industryText: string,
  opts: { tenantDomain?: string; geographyFor?: string } = {},
): Promise<Array<{ naics: NaicsMatch; stats: CensusIndustryStats | null }>> {
  // Lazy import: keeps ai-provider (→ db) out of this module's static graph.
  const { resolveNaicsCodes } = await import("./naics-mapping");
  const codes = await resolveNaicsCodes(industryText, { tenantDomain: opts.tenantDomain });
  if (!codes.length) return [];

  const results = await Promise.all(
    codes.map(async (naics) => ({
      naics,
      stats: isCensusAvailable()
        ? await getBusinessCounts({ naicsCode: naics.code, geographyFor: opts.geographyFor })
        : null,
    })),
  );
  return results;
}

/**
 * SUSB receipts (revenue by enterprise size) — DOCUMENTED STUB.
 *
 * Statistics of U.S. Businesses publishes receipts (revenue) by NAICS and
 * enterprise size, which would give a revenue-based TAM directly (rather than
 * inferring it from establishment counts × ACV). Unlike CBP it is distributed
 * as bulk CSV/XLSX, not a live API, so wiring it up means a periodic ingest job
 * into a lookup table. Deferred to a later phase; the sizing service should use
 * getBusinessCounts × ACV until this lands.
 *
 * Dataset: https://www.census.gov/programs-surveys/susb/data/datasets.html
 */
export async function getReceiptsByIndustry(
  _naicsCode: string,
): Promise<{ receiptsUsd: number; year: number } | null> {
  return null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : 0;
}
