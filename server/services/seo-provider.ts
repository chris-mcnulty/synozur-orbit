/**
 * SEO / SERP Provider Service
 *
 * Wraps a third-party SERP data provider behind a small interface so we can
 * swap providers later without touching the routes or scheduled job.
 *
 * Configuration:
 * - Set SERP_API_KEY via Replit Secrets to enable live SerpAPI lookups
 *   (https://serpapi.com/). The provider is called once per (keyword,country)
 *   and the rank for every tracked domain in the tenant is read from the
 *   organic_results array of the response.
 * - When SERP_API_KEY is not set, a deterministic mock provider is used so
 *   the feature continues to work in local/dev environments. The mock derives
 *   stable rankings from a hash of (keyword, domain) so trends are
 *   reproducible across runs.
 *
 * The shape returned by `runSerpQuery` is the same regardless of provider:
 * a map of normalized-domain → { rank, estimatedTraffic } where rank is null
 * for domains that did not appear in the SERP.
 */

export interface SerpQueryEntity {
  /** Stable id used by the caller (competitorId or companyProfileId). */
  id: string;
  /** Display name (used for diagnostics / mock seeding). */
  name: string;
  /** A URL or domain identifying the entity in search results. */
  url: string;
}

export interface SerpRankResult {
  entityId: string;
  entityName: string;
  entityDomain: string | null;
  /** 1-based SERP position. null when the domain was not found in results. */
  rank: number | null;
  /** Rough estimated weekly visits. 0 when not ranking. */
  estimatedTraffic: number;
}

export interface SerpQueryRequest {
  keyword: string;
  country: string;
  locale: string;
  entities: SerpQueryEntity[];
}

export interface SerpProvider {
  readonly name: string;
  runQuery(req: SerpQueryRequest): Promise<SerpRankResult[]>;
}

/**
 * Extract a normalized hostname (lower-case, no www, no path) from a URL or
 * raw domain string.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return trimmed.replace(/^www\./i, "").toLowerCase().split("/")[0];
  }
}

/**
 * Deterministic 32-bit hash used by the mock provider so rankings are stable
 * across runs and easy to reason about during local development.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TRAFFIC_BY_RANK: number[] = [
  // Approximate weekly clicks for organic positions 1..10, then long tail.
  3500, 1800, 1100, 750, 520, 380, 280, 210, 160, 120,
  90, 70, 55, 45, 40, 35, 30, 26, 22, 20,
];

function trafficForRank(rank: number | null): number {
  if (rank === null) return 0;
  if (rank <= 0) return 0;
  if (rank <= TRAFFIC_BY_RANK.length) return TRAFFIC_BY_RANK[rank - 1];
  // Long-tail decay for ranks beyond the table.
  return Math.max(5, Math.round(20 / Math.log2(rank)));
}

class MockSerpProvider implements SerpProvider {
  readonly name = "mock";

  async runQuery(req: SerpQueryRequest): Promise<SerpRankResult[]> {
    // Build a deterministic ranking by hashing (keyword,country,domain) and
    // sorting; assign the lowest hashes to the best ranks. About 1 in 6
    // entities will fall outside the top 30 and be reported as "not ranking".
    const ranked = req.entities
      .map((entity) => {
        const domain = normalizeDomain(entity.url) ?? entity.id;
        const score = hash(`${req.keyword.toLowerCase()}|${req.country}|${domain}`);
        return { entity, domain, score };
      })
      .sort((a, b) => a.score - b.score);

    return ranked.map(({ entity, domain, score }, idx) => {
      // Some entities won't rank at all; deterministic but realistic.
      const drop = (score % 6) === 0;
      const rank = drop ? null : idx + 1;
      return {
        entityId: entity.id,
        entityName: entity.name,
        entityDomain: domain,
        rank,
        estimatedTraffic: trafficForRank(rank),
      };
    });
  }
}

interface SerpApiOrganicResult {
  position?: number;
  link?: string;
  displayed_link?: string;
  source?: string;
}

/**
 * Global daily SERP query budget. Acts as a circuit breaker so a misbehaving
 * sweep can't burn through the entire SerpAPI plan in one go. Tracked
 * in-memory; resets every UTC day.
 *
 * Configure via SERP_DAILY_QUERY_BUDGET (default 5000, matching SerpAPI's
 * Production plan). Set to 0 to disable.
 */
const DEFAULT_DAILY_QUERY_BUDGET = 5000;
let dailyQueryCount = 0;
let dailyQueryDate = "";

function getDailyBudget(): number {
  const raw = process.env.SERP_DAILY_QUERY_BUDGET;
  if (raw === undefined) return DEFAULT_DAILY_QUERY_BUDGET;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAILY_QUERY_BUDGET;
  return parsed;
}

function checkAndIncrementDailyBudget(): { allowed: boolean; used: number; budget: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyQueryDate !== today) {
    dailyQueryDate = today;
    dailyQueryCount = 0;
  }
  const budget = getDailyBudget();
  if (budget === 0) {
    dailyQueryCount += 1;
    return { allowed: true, used: dailyQueryCount, budget: 0 };
  }
  if (dailyQueryCount >= budget) {
    return { allowed: false, used: dailyQueryCount, budget };
  }
  dailyQueryCount += 1;
  return { allowed: true, used: dailyQueryCount, budget };
}

export function getSerpDailyUsage(): { used: number; budget: number; date: string } {
  return { used: dailyQueryCount, budget: getDailyBudget(), date: dailyQueryDate };
}

class SerpApiProvider implements SerpProvider {
  readonly name = "serpapi";

  constructor(private readonly apiKey: string) {}

  async runQuery(req: SerpQueryRequest): Promise<SerpRankResult[]> {
    const budgetCheck = checkAndIncrementDailyBudget();
    if (!budgetCheck.allowed) {
      console.warn(
        `[SEO Provider] Daily SERP budget exhausted (${budgetCheck.used}/${budgetCheck.budget}); ` +
        `skipping query for "${req.keyword}". Raise SERP_DAILY_QUERY_BUDGET to allow more.`,
      );
      return req.entities.map((entity) => ({
        entityId: entity.id,
        entityName: entity.name,
        entityDomain: normalizeDomain(entity.url),
        rank: null,
        estimatedTraffic: 0,
      }));
    }

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", req.keyword);
    url.searchParams.set("gl", req.country);
    url.searchParams.set("hl", req.locale);
    url.searchParams.set("num", "100");
    url.searchParams.set("api_key", this.apiKey);

    let organic: SerpApiOrganicResult[] = [];
    try {
      const resp = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) {
        throw new Error(`SerpAPI returned HTTP ${resp.status}`);
      }
      const body = await resp.json() as { organic_results?: SerpApiOrganicResult[]; error?: string };
      if (body.error) {
        throw new Error(`SerpAPI error: ${body.error}`);
      }
      organic = body.organic_results || [];
    } catch (err: any) {
      console.error(`[SEO Provider] SerpAPI request failed for "${req.keyword}":`, err.message);
      // Return empty rankings rather than throwing so the scheduled job can
      // continue with the next keyword and store "not ranked" results.
      return req.entities.map((entity) => ({
        entityId: entity.id,
        entityName: entity.name,
        entityDomain: normalizeDomain(entity.url),
        rank: null,
        estimatedTraffic: 0,
      }));
    }

    // Build a domain → first-seen-position map from the organic results.
    const positionByDomain = new Map<string, number>();
    for (const result of organic) {
      const link = result.link || result.displayed_link || result.source;
      const domain = normalizeDomain(link);
      if (!domain) continue;
      const pos = result.position ?? positionByDomain.size + 1;
      if (!positionByDomain.has(domain)) {
        positionByDomain.set(domain, pos);
      }
    }

    return req.entities.map((entity) => {
      const domain = normalizeDomain(entity.url);
      const rank = domain ? positionByDomain.get(domain) ?? null : null;
      return {
        entityId: entity.id,
        entityName: entity.name,
        entityDomain: domain,
        rank,
        estimatedTraffic: trafficForRank(rank),
      };
    });
  }
}

let warnedAboutMock = false;

export function getSeoProvider(): SerpProvider {
  const apiKey = process.env.SERP_API_KEY?.trim();
  if (apiKey) {
    return new SerpApiProvider(apiKey);
  }
  if (!warnedAboutMock) {
    console.warn(
      "[SEO Provider] SERP_API_KEY is not set — using deterministic mock rankings. " +
      "Set SERP_API_KEY in Secrets to use live SerpAPI data.",
    );
    warnedAboutMock = true;
  }
  return new MockSerpProvider();
}

/**
 * Convenience wrapper used by both the routes and the scheduled job.
 * Computes share-of-voice (basis points 0..10000) for each entity by
 * normalizing estimated traffic across all entities in the same query.
 */
export interface SerpRankResultWithSov extends SerpRankResult {
  shareOfVoice: number;
}

export async function runSerpQuery(req: SerpQueryRequest): Promise<SerpRankResultWithSov[]> {
  const provider = getSeoProvider();
  const results = await provider.runQuery(req);
  const totalTraffic = results.reduce((sum, r) => sum + r.estimatedTraffic, 0);
  return results.map((r) => ({
    ...r,
    shareOfVoice: totalTraffic > 0
      ? Math.round((r.estimatedTraffic / totalTraffic) * 10000)
      : 0,
  }));
}
