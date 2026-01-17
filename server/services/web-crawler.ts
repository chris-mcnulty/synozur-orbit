import pLimit from "p-limit";

interface CrawlResult {
  url: string;
  pageType: "homepage" | "about" | "services" | "products" | "blog" | "other";
  title: string;
  content: string;
  wordCount: number;
  crawledAt: string;
}

interface CrawlSummary {
  baseUrl: string;
  pages: CrawlResult[];
  totalWordCount: number;
  crawledAt: string;
  socialLinks: {
    linkedIn?: string;
    instagram?: string;
    twitter?: string;
    facebook?: string;
  };
  blogSnapshot?: {
    postCount: number;
    latestTitles: string[];
  };
}

const USER_AGENT = "Mozilla/5.0 (compatible; OrbitBot/1.0; +https://orbit.synozur.com)";

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const html = await response.text();
    return { html, finalUrl: response.url };
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return null;
  }
}

function extractTextContent(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  
  return "Untitled Page";
}

function extractSocialLinks(html: string): CrawlSummary["socialLinks"] {
  const links: CrawlSummary["socialLinks"] = {};
  
  const linkedInMatch = html.match(/href=["'](https?:\/\/(www\.)?linkedin\.com\/company\/[^"']+)["']/i);
  if (linkedInMatch) links.linkedIn = linkedInMatch[1];
  
  const instagramMatch = html.match(/href=["'](https?:\/\/(www\.)?instagram\.com\/[^"']+)["']/i);
  if (instagramMatch) links.instagram = instagramMatch[1];
  
  const twitterMatch = html.match(/href=["'](https?:\/\/(www\.)?(?:twitter|x)\.com\/[^"']+)["']/i);
  if (twitterMatch) links.twitter = twitterMatch[1];
  
  const facebookMatch = html.match(/href=["'](https?:\/\/(www\.)?facebook\.com\/[^"']+)["']/i);
  if (facebookMatch) links.facebook = facebookMatch[1];
  
  return links;
}

function extractBlogInfo(html: string): CrawlSummary["blogSnapshot"] | undefined {
  const blogTitles: string[] = [];
  
  const articleRegex = /<article[^>]*>[\s\S]*?<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi;
  let articleMatch;
  while ((articleMatch = articleRegex.exec(html)) !== null) {
    if (articleMatch[1] && articleMatch[1].trim().length > 10) {
      blogTitles.push(articleMatch[1].trim().substring(0, 100));
    }
  }
  
  const blogLinkRegex = /href=["'][^"']*\/blog\/[^"']*["'][^>]*>([^<]+)</gi;
  let blogMatch;
  while ((blogMatch = blogLinkRegex.exec(html)) !== null) {
    if (blogMatch[1] && blogMatch[1].trim().length > 10 && !blogTitles.includes(blogMatch[1].trim())) {
      blogTitles.push(blogMatch[1].trim().substring(0, 100));
    }
  }
  
  if (blogTitles.length === 0) return undefined;
  
  return {
    postCount: blogTitles.length,
    latestTitles: blogTitles.slice(0, 5),
  };
}

function findInternalLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const base = new URL(baseUrl);
  
  const linkRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      
      const url = new URL(href, baseUrl);
      if (url.hostname === base.hostname && !links.includes(url.href)) {
        links.push(url.href);
      }
    } catch {
      // Invalid URL, skip
    }
  }
  
  return links;
}

function classifyPageType(url: string, html: string): CrawlResult["pageType"] {
  const urlLower = url.toLowerCase();
  const htmlLower = html.toLowerCase();
  
  if (urlLower.includes("/about") || urlLower.includes("/who-we-are") || urlLower.includes("/our-story")) {
    return "about";
  }
  if (urlLower.includes("/service") || urlLower.includes("/solution") || urlLower.includes("/what-we-do")) {
    return "services";
  }
  if (urlLower.includes("/product") || urlLower.includes("/pricing")) {
    return "products";
  }
  if (urlLower.includes("/blog") || urlLower.includes("/news") || urlLower.includes("/article")) {
    return "blog";
  }
  
  if (htmlLower.includes("about us") && htmlLower.includes("our mission")) {
    return "about";
  }
  if (htmlLower.includes("our services") || htmlLower.includes("solutions")) {
    return "services";
  }
  
  const path = new URL(url).pathname;
  if (path === "/" || path === "") {
    return "homepage";
  }
  
  return "other";
}

function findKeyPages(html: string, baseUrl: string): { about?: string; services?: string; products?: string; blog?: string } {
  const pages: { about?: string; services?: string; products?: string; blog?: string } = {};
  const base = new URL(baseUrl);
  
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  const searchArea = navMatch ? navMatch[1] : html;
  
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)</gi;
  let match;
  while ((match = linkRegex.exec(searchArea)) !== null) {
    try {
      const href = match[1];
      const text = match[2].toLowerCase().trim();
      const url = new URL(href, baseUrl);
      
      if (url.hostname !== base.hostname) continue;
      
      if (!pages.about && (text.includes("about") || href.toLowerCase().includes("/about"))) {
        pages.about = url.href;
      }
      if (!pages.services && (text.includes("service") || text.includes("solution") || href.toLowerCase().includes("/service"))) {
        pages.services = url.href;
      }
      if (!pages.products && (text.includes("product") || text.includes("pricing") || href.toLowerCase().includes("/product"))) {
        pages.products = url.href;
      }
      if (!pages.blog && (text.includes("blog") || text.includes("news") || href.toLowerCase().includes("/blog"))) {
        pages.blog = url.href;
      }
    } catch {
      // Invalid URL, skip
    }
  }
  
  return pages;
}

export async function crawlCompetitorWebsite(url: string): Promise<CrawlSummary> {
  const limit = pLimit(3);
  const crawledAt = new Date().toISOString();
  const pages: CrawlResult[] = [];
  let socialLinks: CrawlSummary["socialLinks"] = {};
  let blogSnapshot: CrawlSummary["blogSnapshot"] | undefined;
  
  const homepage = await fetchPage(url);
  if (!homepage) {
    return {
      baseUrl: url,
      pages: [],
      totalWordCount: 0,
      crawledAt,
      socialLinks: {},
    };
  }
  
  const homepageContent = extractTextContent(homepage.html);
  pages.push({
    url: homepage.finalUrl,
    pageType: "homepage",
    title: extractTitle(homepage.html),
    content: homepageContent.substring(0, 50000),
    wordCount: homepageContent.split(/\s+/).length,
    crawledAt,
  });
  
  socialLinks = extractSocialLinks(homepage.html);
  blogSnapshot = extractBlogInfo(homepage.html);
  
  const keyPages = findKeyPages(homepage.html, homepage.finalUrl);
  
  const pagesToCrawl: { url: string; type: CrawlResult["pageType"] }[] = [];
  if (keyPages.about) pagesToCrawl.push({ url: keyPages.about, type: "about" });
  if (keyPages.services) pagesToCrawl.push({ url: keyPages.services, type: "services" });
  if (keyPages.products) pagesToCrawl.push({ url: keyPages.products, type: "products" });
  if (keyPages.blog) pagesToCrawl.push({ url: keyPages.blog, type: "blog" });
  
  const additionalPages = await Promise.all(
    pagesToCrawl.map(({ url: pageUrl, type }) =>
      limit(async () => {
        const page = await fetchPage(pageUrl);
        if (!page) return null;
        
        const content = extractTextContent(page.html);
        
        if (type === "blog" && !blogSnapshot) {
          blogSnapshot = extractBlogInfo(page.html);
        }
        
        const pageSocialLinks = extractSocialLinks(page.html);
        if (!socialLinks.linkedIn && pageSocialLinks.linkedIn) socialLinks.linkedIn = pageSocialLinks.linkedIn;
        if (!socialLinks.instagram && pageSocialLinks.instagram) socialLinks.instagram = pageSocialLinks.instagram;
        if (!socialLinks.twitter && pageSocialLinks.twitter) socialLinks.twitter = pageSocialLinks.twitter;
        if (!socialLinks.facebook && pageSocialLinks.facebook) socialLinks.facebook = pageSocialLinks.facebook;
        
        return {
          url: page.finalUrl,
          pageType: type,
          title: extractTitle(page.html),
          content: content.substring(0, 30000),
          wordCount: content.split(/\s+/).length,
          crawledAt,
        };
      })
    )
  );
  
  for (const page of additionalPages) {
    if (page) pages.push(page);
  }
  
  const totalWordCount = pages.reduce((sum, p) => sum + p.wordCount, 0);
  
  return {
    baseUrl: url,
    pages,
    totalWordCount,
    crawledAt,
    socialLinks,
    blogSnapshot,
  };
}

export function getCombinedContent(summary: CrawlSummary): string {
  return summary.pages
    .map((p) => `[${p.pageType.toUpperCase()}] ${p.title}\n${p.content}`)
    .join("\n\n---\n\n");
}
