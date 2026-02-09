import Anthropic from "@anthropic-ai/sdk";

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
  
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + " news")}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      console.log(`[News] Search returned status ${response.status}`);
      return results;
    }

    const html = await response.text();
    
    const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    
    const titles: Array<{ href: string; title: string }> = [];
    let match;
    while ((match = titleRegex.exec(html)) !== null) {
      const rawHref = match[1];
      let url = rawHref;
      if (rawHref.includes("uddg=")) {
        try {
          url = decodeURIComponent(rawHref.replace(/.*uddg=/, "").split("&")[0]);
        } catch {
          url = rawHref.replace(/.*uddg=/, "").split("&")[0];
        }
      }
      titles.push({ href: url, title: stripHtml(match[2]) });
    }
    
    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(stripHtml(match[1]));
    }
    
    for (let i = 0; i < titles.length && results.length < 10; i++) {
      const { href, title } = titles[i];
      const snippet = snippets[i] || "";
      
      if (title && href && href.startsWith("http") && !href.includes("duckduckgo.com")) {
        results.push({ title, link: href, snippet });
      }
    }
    
    console.log(`[News] Found ${results.length} results for query: "${query}"`);
  } catch (error) {
    console.error("[News] Error searching:", error);
  }
  
  return results;
}

async function analyzeSentiment(
  mentions: Array<{ title: string; snippet: string }>
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
  companyWebsite?: string
): Promise<NewsMonitoringResult> {
  const fetchedAt = new Date().toISOString();
  
  try {
    const domain = companyWebsite ? new URL(companyWebsite).hostname.replace("www.", "") : "";
    const searchQuery = domain ? `"${competitorName}" OR site:${domain}` : `"${competitorName}"`;
    
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
      searchResults.map(r => ({ title: r.title, snippet: r.snippet }))
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
  competitors: Array<{ id: string; name: string; websiteUrl?: string }>
): Promise<NewsMonitoringResult[]> {
  const results: NewsMonitoringResult[] = [];
  
  for (const competitor of competitors) {
    const result = await monitorCompetitorNews(
      competitor.id,
      competitor.name,
      competitor.websiteUrl
    );
    results.push(result);
    
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  return results;
}
