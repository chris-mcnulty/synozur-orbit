import { storage } from "../storage";

interface BlogPost {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

interface BlogFeedResult {
  success: boolean;
  posts: BlogPost[];
  feedType: "rss" | "atom" | "html" | "unknown";
  error?: string;
}

export async function fetchBlogFeed(blogUrl: string): Promise<BlogFeedResult> {
  try {
    const response = await fetch(blogUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OrbitBot/1.0; +https://orbit.synozur.com)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { success: false, posts: [], feedType: "unknown", error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    const content = await response.text();

    if (contentType.includes("xml") || content.trim().startsWith("<?xml") || content.includes("<rss") || content.includes("<feed")) {
      return parseXmlFeed(content);
    }

    return parseHtmlBlog(content, blogUrl);
  } catch (error: any) {
    console.error("RSS fetch error:", error);
    return { success: false, posts: [], feedType: "unknown", error: error.message };
  }
}

function parseXmlFeed(content: string): BlogFeedResult {
  const posts: BlogPost[] = [];
  
  const isAtom = content.includes("<feed") && content.includes("xmlns=\"http://www.w3.org/2005/Atom\"");
  
  if (isAtom) {
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = entryRegex.exec(content)) !== null && posts.length < 20) {
      const entry = match[1];
      const title = extractTag(entry, "title");
      const link = extractAtomLink(entry);
      const pubDate = extractTag(entry, "published") || extractTag(entry, "updated");
      const description = extractTag(entry, "summary") || extractTag(entry, "content");
      
      if (title) {
        posts.push({ title, link, pubDate, description: cleanHtml(description) });
      }
    }
    return { success: true, posts, feedType: "atom" };
  }
  
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(content)) !== null && posts.length < 20) {
    const item = match[1];
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const pubDate = extractTag(item, "pubDate") || extractTag(item, "dc:date");
    const description = extractTag(item, "description") || extractTag(item, "content:encoded");
    
    if (title) {
      posts.push({ title, link, pubDate, description: cleanHtml(description) });
    }
  }
  
  return { success: posts.length > 0, posts, feedType: "rss" };
}

function parseHtmlBlog(content: string, baseUrl: string): BlogFeedResult {
  const posts: BlogPost[] = [];
  
  const rssLinkMatch = content.match(/<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i);
  if (rssLinkMatch) {
    return { success: false, posts: [], feedType: "html", error: `RSS feed found at: ${rssLinkMatch[2]}` };
  }
  
  const articlePatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class="[^"]*(?:post|entry|blog-item|article)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  for (const pattern of articlePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null && posts.length < 20) {
      const article = match[1];
      
      const titleMatch = article.match(/<h[1-3][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
                         article.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      
      if (titleMatch) {
        const title = cleanHtml(titleMatch[2] || titleMatch[1]);
        const link = titleMatch[1]?.startsWith("http") ? titleMatch[1] : undefined;
        
        const dateMatch = article.match(/<time[^>]*datetime=["']([^"']+)["']/i) ||
                         article.match(/<span[^>]*class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const pubDate = dateMatch?.[1];
        
        if (title && title.length > 10) {
          posts.push({ title: title.slice(0, 200), link, pubDate });
        }
      }
    }
    if (posts.length > 0) break;
  }
  
  return { success: posts.length > 0, posts, feedType: "html" };
}

function extractTag(content: string, tagName: string): string | undefined {
  const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, "i");
  const cdataMatch = content.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = content.match(regex);
  return match ? cleanHtml(match[1].trim()) : undefined;
}

function extractAtomLink(entry: string): string | undefined {
  const linkMatch = entry.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ||
                   entry.match(/<link[^>]*href=["']([^"']+)["']/i);
  return linkMatch?.[1];
}

function cleanHtml(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function monitorBlogForCompetitor(
  competitorId: string,
  blogUrl: string,
  competitorName: string,
  userId: string,
  tenantDomain: string,
  marketId?: string | null
): Promise<{ success: boolean; newPosts: number; error?: string }> {
  const result = await fetchBlogFeed(blogUrl);
  
  if (!result.success) {
    return { success: false, newPosts: 0, error: result.error };
  }
  
  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    return { success: false, newPosts: 0, error: "Competitor not found" };
  }
  
  const previousSnapshot = competitor.blogSnapshot as any;
  const previousTitles = previousSnapshot?.latestTitles || [];
  
  const currentTitles = result.posts.slice(0, 10).map(p => p.title);
  const newTitles = currentTitles.filter(t => !previousTitles.includes(t));
  
  // Get full post details for new posts (not just titles)
  const newPostsWithDetails = result.posts
    .filter(p => newTitles.includes(p.title))
    .slice(0, 5)
    .map(p => ({
      title: p.title,
      link: p.link || null,
      excerpt: p.description?.slice(0, 200) || null,
      pubDate: p.pubDate || null,
    }));
  
  const newSnapshot = {
    postCount: result.posts.length,
    latestTitles: currentTitles,
    latestPosts: result.posts.slice(0, 5).map(p => ({
      title: p.title,
      link: p.link || null,
      excerpt: p.description?.slice(0, 200) || null,
      pubDate: p.pubDate || null,
    })),
    feedType: result.feedType,
    capturedAt: new Date().toISOString(),
    blogUrl,
  };
  
  await storage.updateCompetitor(competitorId, {
    blogSnapshot: newSnapshot,
  });
  
  if (newTitles.length > 0 && previousTitles.length > 0) {
    await storage.createActivity({
      type: "blog_post",
      sourceType: "competitor",
      competitorId,
      competitorName,
      description: `Published ${newTitles.length} new blog post${newTitles.length > 1 ? "s" : ""}: "${newTitles[0]}"${newTitles.length > 1 ? " and more" : ""}`,
      details: { 
        newPosts: newPostsWithDetails,
        feedType: result.feedType,
        blogUrl,
      },
      date: new Date().toISOString(),
      impact: newTitles.length >= 3 ? "high" : "medium",
      userId,
      tenantDomain,
      marketId: marketId || null,
    });
  }
  
  return { success: true, newPosts: newTitles.length };
}

export async function testBlogUrl(blogUrl: string): Promise<{ 
  valid: boolean; 
  feedType: string; 
  postCount: number; 
  sampleTitles: string[];
  error?: string;
}> {
  const result = await fetchBlogFeed(blogUrl);
  
  return {
    valid: result.success,
    feedType: result.feedType,
    postCount: result.posts.length,
    sampleTitles: result.posts.slice(0, 3).map(p => p.title),
    error: result.error,
  };
}
