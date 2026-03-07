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

function buildSearchQuery(name: string): string {
  const cleaned = name.replace(/['"]/g, "").trim();
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

  const entities: { name: string; type: "competitor" | "baseline" }[] = [];

  if (baseline?.companyName) {
    entities.push({ name: baseline.companyName, type: "baseline" });
  }

  for (const comp of competitors) {
    entities.push({ name: comp.name, type: "competitor" });
  }

  for (const entity of entities) {
    const query = buildSearchQuery(entity.name);
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
