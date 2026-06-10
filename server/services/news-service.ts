import type { Competitor, CompanyProfile } from "@shared/schema";

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
  matchedEntity: string;
}

export interface NewsResult {
  articles: NewsArticle[];
  entityName: string;
  totalFound: number;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const GNEWS_BASE_URL = "https://gnews.io/api/v4";
const MAX_ARTICLES_PER_ENTITY = 5;
const REQUEST_DELAY_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAmbiguousName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length === 1 && name.length <= 8) return true;
  const commonWords = new Set([
    "ninety", "slalom", "box", "zoom", "apple", "oracle", "quest", "point",
    "snap", "hive", "bolt", "spark", "flux", "drift", "beam", "pulse",
    "vibe", "mint", "wave", "nest", "loop", "path", "base", "core",
  ]);
  if (words.length === 1 && commonWords.has(name.toLowerCase())) return true;
  return false;
}

function extractDomainHint(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    return parts[0] || "";
  } catch {
    return "";
  }
}

function buildSearchQuery(name: string, url?: string, industry?: string): string {
  const cleaned = name.replace(/['"]/g, "").trim();

  if (isAmbiguousName(cleaned)) {
    const qualifiers: string[] = [];
    if (industry) {
      qualifiers.push(industry);
    } else {
      qualifiers.push("company");
    }

    if (cleaned.includes(" ")) {
      return `"${cleaned}" ${qualifiers.join(" ")}`;
    }
    return `${cleaned} ${qualifiers.join(" ")}`;
  }

  if (cleaned.includes(" ")) {
    return `"${cleaned}"`;
  }
  return cleaned;
}

async function searchNews(
  query: string,
  maxArticles: number = MAX_ARTICLES_PER_ENTITY,
  fromDate?: string
): Promise<{ articles: any[]; totalArticles: number }> {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    console.warn("[News Service] GNEWS_API_KEY not configured, skipping news fetch");
    return { articles: [], totalArticles: 0 };
  }

  const params = new URLSearchParams({
    q: query,
    token: apiKey,
    lang: "en",
    max: String(maxArticles),
    sortby: "publishedAt",
  });

  if (fromDate) {
    params.set("from", fromDate);
  }

  const url = `${GNEWS_BASE_URL}/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[News Service] GNews API error ${response.status}: ${errorText}`);
      return { articles: [], totalArticles: 0 };
    }

    const data = await response.json();
    return {
      articles: data.articles || [],
      totalArticles: data.totalArticles || 0,
    };
  } catch (error: any) {
    console.error(`[News Service] Failed to fetch news for "${query}":`, error.message);
    return { articles: [], totalArticles: 0 };
  }
}

export interface SubjectNews {
  subject: string;
  headlines: { title: string; source: string; url: string; snippet: string }[];
}

/**
 * Scan news for arbitrary subjects/companies/keywords supplied at call time
 * (not limited to tracked competitors), using the production GNews API. Used by
 * campaign ideation. Best-effort: a missing key or a failed request yields an
 * empty headline list for that subject rather than throwing.
 */
export async function scanNewsForSubjects(
  subjects: string[],
  perSubject: number = 5,
): Promise<SubjectNews[]> {
  const cleaned = Array.from(
    new Set(subjects.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)),
  ).slice(0, 8);

  const out: SubjectNews[] = [];
  for (const subject of cleaned) {
    const { articles } = await searchNews(subject, perSubject);
    out.push({
      subject,
      headlines: (articles || []).slice(0, perSubject).map((a: any) => {
        let source = a?.source?.name || "";
        if (!source && a?.url) {
          try {
            source = new URL(a.url).hostname.replace(/^www\./, "");
          } catch {
            /* leave blank */
          }
        }
        return {
          title: a?.title || "",
          source,
          url: a?.url || "",
          snippet: a?.description || "",
        };
      }),
    });
    // Respect the GNews rate limit between subjects.
    if (cleaned.length > 1) await delay(REQUEST_DELAY_MS);
  }
  return out;
}

export async function fetchCompetitorNews(
  competitors: Competitor[],
  baseline: CompanyProfile | undefined,
  periodDays: number = 7
): Promise<NewsArticle[]> {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    console.log("[News Service] No GNEWS_API_KEY configured, skipping news gathering");
    return [];
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - periodDays);
  const fromDateStr = fromDate.toISOString().split("T")[0] + "T00:00:00Z";

  const allArticles: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  const entities: { name: string; type: "competitor" | "baseline"; url?: string; industry?: string }[] = [];

  if (baseline?.companyName) {
    entities.push({ name: baseline.companyName, type: "baseline", url: baseline.websiteUrl, industry: (baseline as any).industry || undefined });
  }

  for (const comp of competitors) {
    entities.push({ name: comp.name, type: "competitor", url: comp.url, industry: (comp as any).industry || undefined });
  }

  for (const entity of entities) {
    const query = buildSearchQuery(entity.name, entity.url, entity.industry);
    console.log(`[News Service] Searching for "${entity.name}" with query: ${query}`);
    const result = await searchNews(query, MAX_ARTICLES_PER_ENTITY, fromDateStr);

    for (const article of result.articles) {
      if (seenUrls.has(article.url)) continue;
      seenUrls.add(article.url);

      const articleUrl = article.url || "";
      if (!isValidUrl(articleUrl)) continue;

      allArticles.push({
        title: article.title || "",
        description: article.description || "",
        url: articleUrl,
        source: article.source?.name || "Unknown",
        publishedAt: article.publishedAt || "",
        imageUrl: article.image || undefined,
        matchedEntity: entity.name,
      });
    }

    if (entities.indexOf(entity) < entities.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  allArticles.sort((a, b) =>
    new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return allArticles;
}

export function buildNewsSummary(articles: NewsArticle[]): string {
  if (articles.length === 0) return "";

  const byEntity: Record<string, NewsArticle[]> = {};
  for (const article of articles) {
    if (!byEntity[article.matchedEntity]) byEntity[article.matchedEntity] = [];
    byEntity[article.matchedEntity].push(article);
  }

  const lines: string[] = [
    `\n## NEWS & PRESS COVERAGE (${articles.length} articles found):`,
  ];

  for (const [entity, entityArticles] of Object.entries(byEntity)) {
    lines.push(`\n### ${entity} (${entityArticles.length} article${entityArticles.length > 1 ? "s" : ""})`);
    for (const article of entityArticles) {
      const date = new Date(article.publishedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      lines.push(`- [${date}] **${article.title}** (${article.source})`);
      if (article.description) {
        lines.push(`  ${article.description.substring(0, 200)}`);
      }
    }
  }

  return lines.join("\n");
}
