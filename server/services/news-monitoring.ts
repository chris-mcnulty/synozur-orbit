import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "./ai-usage-logger";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface NewsMention {
  id: string;
  title: string;
  source: string;
  url: string;
  snippet: string;
  publishedAt: string;
  sentiment: "positive" | "neutral" | "negative";
  relevanceScore: number;
}

export interface NewsMonitoringResult {
  competitorId: string;
  competitorName: string;
  mentions: NewsMention[];
  totalMentions: number;
  status: "success" | "error" | "rate_limited";
  message?: string;
  fetchedAt: string;
}

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function searchNews(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    console.warn("[News] GNEWS_API_KEY not configured, skipping news fetch");
    return results;
  }

  try {
    // Constrain to recent news so old stories don't surface as "mentions".
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    const fromDateStr = fromDate.toISOString().split("T")[0] + "T00:00:00Z";

    const params = new URLSearchParams({
      q: query,
      token: apiKey,
      lang: "en",
      max: "10",
      sortby: "publishedAt",
      // Require the keywords in the headline/description so an off-topic body
      // mention doesn't pull in unrelated stories.
      in: "title,description",
      from: fromDateStr,
    });

    const searchUrl = `https://gnews.io/api/v4/search?${params.toString()}`;

    const response = await fetch(searchUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.log(`[News] GNews API error ${response.status}: ${errorText}`);
      return results;
    }

    const data = await response.json();
    const articles: any[] = data.articles || [];

    for (const article of articles) {
      if (results.length >= 10) break;
      const link = article?.url || "";
      const title = article?.title || "";
      if (!title || !link.startsWith("http")) continue;
      results.push({
        title,
        link,
        snippet: article?.description || "",
        date: article?.publishedAt || undefined,
      });
    }

    console.log(`[News] Found ${results.length} results for query: "${query}"`);
  } catch (error) {
    console.error("[News] Error searching:", error);
  }

  return results;
}

async function analyzeSentiment(
  mentions: Array<{ title: string; snippet: string }>,
  tenantDomain?: string | null,
  marketId?: string | null,
): Promise<Array<{ sentiment: "positive" | "neutral" | "negative"; relevance: number }>> {
  if (mentions.length === 0) return [];
  
  try {
    const mentionTexts = mentions.map((m, i) => `${i + 1}. Title: "${m.title}" Snippet: "${m.snippet}"`).join("\n");
    
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Analyze these news mentions for sentiment and business relevance. For each, provide:
- sentiment: "positive", "neutral", or "negative" (from a business/PR perspective)
- relevance: 0-100 score (how relevant this is to competitive intelligence)

Mentions:
${mentionTexts}

Respond with ONLY a JSON array like: [{"sentiment": "positive", "relevance": 85}, ...]`
      }]
    });
    
    void logAiUsage({ tenantDomain, marketId }, "analyze_news_sentiment", "anthropic", "claude-sonnet-4-5", response.usage);
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Error analyzing sentiment:", error);
  }
  
  return mentions.map(() => ({ sentiment: "neutral" as const, relevance: 50 }));
}

export async function monitorCompetitorNews(
  competitorId: string,
  competitorName: string,
  companyWebsite?: string,
  tenantDomain?: string | null,
  marketId?: string | null,
): Promise<NewsMonitoringResult> {
  const fetchedAt = new Date().toISOString();
  
  try {
    // GNews doesn't support the `site:` operator, so search on the quoted
    // competitor name (phrase match for multi-word names).
    const cleanedName = competitorName.replace(/"/g, "").trim();
    const searchQuery = cleanedName.includes(" ") ? `"${cleanedName}"` : cleanedName;

    const searchResults = await searchNews(searchQuery);
    
    if (searchResults.length === 0) {
      return {
        competitorId,
        competitorName,
        mentions: [],
        totalMentions: 0,
        status: "success",
        message: "No recent news mentions found",
        fetchedAt,
      };
    }
    
    const sentimentResults = await analyzeSentiment(
      searchResults.map(r => ({ title: r.title, snippet: r.snippet })),
      tenantDomain,
      marketId,
    );
    
    const mentions: NewsMention[] = searchResults.map((result, index) => {
      const sentimentData = sentimentResults[index] || { sentiment: "neutral", relevance: 50 };
      
      let source = "Unknown";
      try {
        source = new URL(result.link).hostname.replace("www.", "");
      } catch {}
      
      return {
        id: `${competitorId}-${Date.now()}-${index}`,
        title: result.title,
        source,
        url: result.link,
        snippet: result.snippet,
        publishedAt: result.date || new Date().toISOString(),
        sentiment: sentimentData.sentiment,
        relevanceScore: sentimentData.relevance,
      };
    });
    
    mentions.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    return {
      competitorId,
      competitorName,
      mentions,
      totalMentions: mentions.length,
      status: "success",
      fetchedAt,
    };
  } catch (error) {
    console.error(`Error monitoring news for ${competitorName}:`, error);
    return {
      competitorId,
      competitorName,
      mentions: [],
      totalMentions: 0,
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
      fetchedAt,
    };
  }
}

export async function monitorMultipleCompetitorsNews(
  competitors: Array<{ id: string; name: string; websiteUrl?: string; tenantDomain?: string | null; marketId?: string | null }>,
  opts?: { concurrency?: number; deadlineMs?: number }
): Promise<NewsMonitoringResult[]> {
  // Scan competitors with a small worker pool so a long list (e.g. 20+)
  // completes well within the HTTP request window instead of running one at a
  // time. A global deadline returns whatever was gathered so far rather than
  // letting the request hang and time out.
  const concurrency = Math.max(1, opts?.concurrency ?? 3);
  const deadline = Date.now() + (opts?.deadlineMs ?? 50_000);

  const results: NewsMonitoringResult[] = [];
  let next = 0;

  async function worker() {
    while (next < competitors.length && Date.now() < deadline) {
      const competitor = competitors[next++];
      const result = await monitorCompetitorNews(
        competitor.id,
        competitor.name,
        competitor.websiteUrl,
        competitor.tenantDomain,
        competitor.marketId,
      );
      results.push(result);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, competitors.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}
