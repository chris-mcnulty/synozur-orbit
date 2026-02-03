import { fetchPageHeadless, isHeadlessAvailable } from "./headless-crawler";

interface CrawlResult {
  url: string;
  pageType: "homepage" | "about" | "services" | "products" | "blog" | "other";
  title: string;
  content: string;
  wordCount: number;
  crawledAt: string;
  crawlMethod?: "headless" | "http";
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
  crawlMethod?: "headless" | "http" | "mixed";
}

// Consolidated blog/content section URL slugs - used consistently throughout crawler
const BLOG_SLUGS = ["blog", "blogs", "news", "insights", "insight", "articles", "article", "resources", "updates", "press", "media"];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getBrowserHeaders(userAgent: string): Record<string, string> {
  const isChrome = userAgent.includes("Chrome");
  const isFirefox = userAgent.includes("Firefox");
  
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
  
  if (isChrome) {
    headers["Sec-Ch-Ua"] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = '"Windows"';
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
  } else if (isFirefox) {
    headers["DNT"] = "1";
  }
  
  return headers;
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPageHttp(url: string, retries = 2): Promise<{ html: string; finalUrl: string } | null> {
  const userAgent = getRandomUserAgent();
  const headers = getBrowserHeaders(userAgent);
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        await delay(1000 + Math.random() * 2000);
      }
      
      const response = await fetch(url, {
        headers,
        redirect: "follow",
      });
      
      if (response.status === 403 || response.status === 429) {
        console.warn(`Blocked (${response.status}) fetching ${url}, attempt ${attempt + 1}/${retries + 1}`);
        if (attempt < retries) continue;
        return null;
      }
      
      if (!response.ok) return null;
      const html = await response.text();
      return { html, finalUrl: response.url };
    } catch (error) {
      console.error(`Failed to fetch ${url} (attempt ${attempt + 1}):`, error);
      if (attempt < retries) continue;
      return null;
    }
  }
  return null;
}

interface FetchResult {
  html: string;
  finalUrl: string;
  method: "headless" | "http";
  renderedContent?: string;
}

async function fetchPage(url: string, useHeadless = true, retries = 2): Promise<FetchResult | null> {
  if (useHeadless && isHeadlessAvailable()) {
    console.log(`[Headless] Attempting to crawl: ${url}`);
    const headlessResult = await fetchPageHeadless(url, { retries, timeout: 30000 });
    
    if (headlessResult) {
      console.log(`[Headless] Successfully crawled: ${url}`);
      return {
        html: headlessResult.html,
        finalUrl: headlessResult.finalUrl,
        method: "headless",
        renderedContent: headlessResult.renderedContent,
      };
    }
    
    console.log(`[Headless] Failed, falling back to HTTP for: ${url}`);
  }
  
  const httpResult = await fetchPageHttp(url, retries);
  if (httpResult) {
    console.log(`[HTTP] Successfully crawled: ${url}`);
    return {
      html: httpResult.html,
      finalUrl: httpResult.finalUrl,
      method: "http",
    };
  }
  
  return null;
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
  
  // Look for article tags with headings (common blog structure)
  const articleRegex = /<article[^>]*>[\s\S]*?<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi;
  let articleMatch;
  while ((articleMatch = articleRegex.exec(html)) !== null) {
    if (articleMatch[1] && articleMatch[1].trim().length > 10) {
      blogTitles.push(articleMatch[1].trim().substring(0, 100));
    }
  }
  
  // Look for links in blog/insights/news/articles sections using consolidated slugs
  const slugPattern = BLOG_SLUGS.join("|");
  const blogLinkRegex = new RegExp(`href=["'][^"']*\\/(${slugPattern})\\/[^"']*["'][^>]*>([^<]+)`, "gi");
  let blogMatch;
  while ((blogMatch = blogLinkRegex.exec(html)) !== null) {
    const title = blogMatch[2];
    if (title && title.trim().length > 10 && !blogTitles.includes(title.trim())) {
      blogTitles.push(title.trim().substring(0, 100));
    }
  }
  
  // Also look for common blog listing patterns (div with class containing 'post', 'article', 'blog-item')
  const postTitleRegex = /<(?:div|li)[^>]*class=["'][^"']*(?:post|article|blog-item|insight)[^"']*["'][^>]*>[\s\S]*?<(?:h[1-4]|a)[^>]*>([^<]{15,100})</gi;
  let postMatch;
  while ((postMatch = postTitleRegex.exec(html)) !== null) {
    const title = postMatch[1].trim();
    if (title.length > 10 && !blogTitles.includes(title)) {
      blogTitles.push(title.substring(0, 100));
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
  if (urlLower.includes("/service") || urlLower.includes("/solution") || urlLower.includes("/what-we-do") || 
      urlLower.includes("/expertise") || urlLower.includes("/capabilit")) {
    return "services";
  }
  if (urlLower.includes("/product") || urlLower.includes("/pricing")) {
    return "products";
  }
  if (BLOG_SLUGS.some(slug => urlLower.includes(`/${slug}`))) {
    return "blog";
  }
  if (urlLower.includes("/case") || urlLower.includes("/success") || urlLower.includes("/customer-stor")) {
    return "other"; // case studies
  }
  if (urlLower.includes("/resource") || urlLower.includes("/whitepaper") || urlLower.includes("/download")) {
    return "other"; // resources
  }
  if (urlLower.includes("/industr") || urlLower.includes("/sector")) {
    return "other"; // industries
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

interface KeyPages {
  about?: string;
  services?: string;
  products?: string;
  blog?: string;
  caseStudies?: string;
  resources?: string;
  solutions?: string;
  industries?: string;
  expertise?: string;
}

function findKeyPages(html: string, baseUrl: string): KeyPages {
  const pages: KeyPages = {};
  const base = new URL(baseUrl);
  
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  const searchArea = navMatch ? navMatch[1] : html;
  
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)</gi;
  let match;
  while ((match = linkRegex.exec(searchArea)) !== null) {
    try {
      const href = match[1];
      const text = match[2].toLowerCase().trim();
      const hrefLower = href.toLowerCase();
      const url = new URL(href, baseUrl);
      
      if (url.hostname !== base.hostname) continue;
      
      if (!pages.about && (text.includes("about") || hrefLower.includes("/about"))) {
        pages.about = url.href;
      }
      if (!pages.services && (text.includes("service") || hrefLower.includes("/service"))) {
        pages.services = url.href;
      }
      if (!pages.solutions && (text.includes("solution") || hrefLower.includes("/solution"))) {
        pages.solutions = url.href;
      }
      if (!pages.products && (text.includes("product") || text.includes("pricing") || hrefLower.includes("/product"))) {
        pages.products = url.href;
      }
      if (!pages.blog && (BLOG_SLUGS.some(slug => text.includes(slug)) || BLOG_SLUGS.some(slug => hrefLower.includes(`/${slug}`)))) {
        pages.blog = url.href;
      }
      if (!pages.caseStudies && (text.includes("case stud") || text.includes("success stor") || hrefLower.includes("/case") || hrefLower.includes("/success"))) {
        pages.caseStudies = url.href;
      }
      if (!pages.resources && (text.includes("resource") || text.includes("whitepaper") || text.includes("download") || hrefLower.includes("/resource"))) {
        pages.resources = url.href;
      }
      if (!pages.industries && (text.includes("industr") || text.includes("sector") || hrefLower.includes("/industr"))) {
        pages.industries = url.href;
      }
      if (!pages.expertise && (text.includes("expertise") || text.includes("capabilit") || text.includes("what we do") || hrefLower.includes("/expertise") || hrefLower.includes("/capabilit"))) {
        pages.expertise = url.href;
      }
    } catch {
      // Invalid URL, skip
    }
  }
  
  return pages;
}

// Simple concurrency limiter that works in CJS bundle
function createConcurrencyLimit(maxConcurrent: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          running--;
          if (queue.length > 0) {
            const next = queue.shift();
            next?.();
          }
        }
      };
      
      if (running < maxConcurrent) {
        execute();
      } else {
        queue.push(execute);
      }
    });
  };
}

export async function crawlCompetitorWebsite(url: string, options: { useHeadless?: boolean } = {}): Promise<CrawlSummary> {
  const { useHeadless = true } = options;
  const limit = createConcurrencyLimit(3);
  const crawledAt = new Date().toISOString();
  const pages: CrawlResult[] = [];
  let socialLinks: CrawlSummary["socialLinks"] = {};
  let blogSnapshot: CrawlSummary["blogSnapshot"] | undefined;
  let crawlMethod: "headless" | "http" = "http";
  
  console.log(`[Web Crawler] Starting crawl of ${url} (headless: ${useHeadless})`);
  
  const homepage = await fetchPage(url, useHeadless);
  if (!homepage) {
    console.log(`[Web Crawler] Failed to fetch homepage for ${url}`);
    return {
      baseUrl: url,
      pages: [],
      totalWordCount: 0,
      crawledAt,
      socialLinks: {},
      crawlMethod: "http",
    };
  }
  
  crawlMethod = homepage.method;
  
  const homepageContent = homepage.renderedContent || extractTextContent(homepage.html);
  pages.push({
    url: homepage.finalUrl,
    pageType: "homepage",
    title: extractTitle(homepage.html),
    content: homepageContent.substring(0, 50000),
    wordCount: homepageContent.split(/\s+/).length,
    crawledAt,
    crawlMethod: homepage.method,
  });
  
  socialLinks = extractSocialLinks(homepage.html);
  blogSnapshot = extractBlogInfo(homepage.html);
  
  const keyPages = findKeyPages(homepage.html, homepage.finalUrl);
  
  // Crawl key pages - expanded to include more page types for comprehensive analysis
  const pagesToCrawl: { url: string; type: CrawlResult["pageType"] }[] = [];
  if (keyPages.about) pagesToCrawl.push({ url: keyPages.about, type: "about" });
  if (keyPages.services) pagesToCrawl.push({ url: keyPages.services, type: "services" });
  if (keyPages.solutions) pagesToCrawl.push({ url: keyPages.solutions, type: "services" });
  if (keyPages.products) pagesToCrawl.push({ url: keyPages.products, type: "products" });
  if (keyPages.blog) pagesToCrawl.push({ url: keyPages.blog, type: "blog" });
  if (keyPages.caseStudies) pagesToCrawl.push({ url: keyPages.caseStudies, type: "other" });
  if (keyPages.resources) pagesToCrawl.push({ url: keyPages.resources, type: "other" });
  if (keyPages.industries) pagesToCrawl.push({ url: keyPages.industries, type: "other" });
  if (keyPages.expertise) pagesToCrawl.push({ url: keyPages.expertise, type: "services" });
  
  // Track crawled URLs to avoid duplicates
  const crawledUrls = new Set<string>([homepage.finalUrl]);
  const subPagesToDiscover: { parentUrl: string; parentType: CrawlResult["pageType"] }[] = [];
  
  const additionalPages = await Promise.all(
    pagesToCrawl.map(({ url: pageUrl, type }) =>
      limit(async () => {
        if (crawledUrls.has(pageUrl)) return null;
        crawledUrls.add(pageUrl);
        
        const page = await fetchPage(pageUrl, useHeadless);
        if (!page) return null;
        
        const content = page.renderedContent || extractTextContent(page.html);
        
        if (type === "blog" && !blogSnapshot) {
          blogSnapshot = extractBlogInfo(page.html);
        }
        
        const pageSocialLinks = extractSocialLinks(page.html);
        if (!socialLinks.linkedIn && pageSocialLinks.linkedIn) socialLinks.linkedIn = pageSocialLinks.linkedIn;
        if (!socialLinks.instagram && pageSocialLinks.instagram) socialLinks.instagram = pageSocialLinks.instagram;
        if (!socialLinks.twitter && pageSocialLinks.twitter) socialLinks.twitter = pageSocialLinks.twitter;
        if (!socialLinks.facebook && pageSocialLinks.facebook) socialLinks.facebook = pageSocialLinks.facebook;
        
        // For services/solutions pages, discover sub-pages
        if (type === "services") {
          subPagesToDiscover.push({ parentUrl: page.finalUrl, parentType: type });
        }
        
        return {
          url: page.finalUrl,
          pageType: type,
          title: extractTitle(page.html),
          content: content.substring(0, 30000),
          wordCount: content.split(/\s+/).length,
          crawledAt,
          crawlMethod: page.method,
          html: page.html, // Keep HTML for sub-page discovery
        };
      })
    )
  );
  
  for (const page of additionalPages) {
    if (page) {
      const { html, ...pageData } = page;
      pages.push(pageData);
    }
  }
  
  // Discover and crawl sub-pages from services/solutions sections (up to 10 sub-pages total)
  const subPageUrls: string[] = [];
  for (const { parentUrl } of subPagesToDiscover) {
    const parentPage = additionalPages.find(p => p?.url === parentUrl);
    if (parentPage && (parentPage as any).html) {
      const subLinks = findInternalLinks((parentPage as any).html, parentUrl);
      for (const subLink of subLinks) {
        if (!crawledUrls.has(subLink) && 
            !subPageUrls.includes(subLink) && 
            subPageUrls.length < 10 &&
            (subLink.includes("/service") || subLink.includes("/solution") || 
             subLink.includes("/capabilit") || subLink.includes("/expertise") ||
             subLink.includes("/technology") || subLink.includes("/what-we"))) {
          subPageUrls.push(subLink);
        }
      }
    }
  }
  
  // Crawl discovered sub-pages
  if (subPageUrls.length > 0) {
    const subPages = await Promise.all(
      subPageUrls.slice(0, 10).map((subUrl) =>
        limit(async () => {
          if (crawledUrls.has(subUrl)) return null;
          crawledUrls.add(subUrl);
          
          const page = await fetchPage(subUrl, useHeadless);
          if (!page) return null;
          
          const content = page.renderedContent || extractTextContent(page.html);
          return {
            url: page.finalUrl,
            pageType: classifyPageType(page.finalUrl, page.html),
            title: extractTitle(page.html),
            content: content.substring(0, 20000),
            wordCount: content.split(/\s+/).length,
            crawledAt,
            crawlMethod: page.method,
          };
        })
      )
    );
    
    for (const page of subPages) {
      if (page) pages.push(page);
    }
  }
  
  const totalWordCount = pages.reduce((sum, p) => sum + p.wordCount, 0);
  
  const headlessCount = pages.filter(p => p.crawlMethod === "headless").length;
  const httpCount = pages.filter(p => p.crawlMethod === "http").length;
  
  let finalCrawlMethod: "headless" | "http" | "mixed";
  if (headlessCount > 0 && httpCount > 0) {
    finalCrawlMethod = "mixed";
  } else if (headlessCount > 0) {
    finalCrawlMethod = "headless";
  } else {
    finalCrawlMethod = "http";
  }
  
  console.log(`[Web Crawler] Completed crawl of ${url}: ${pages.length} pages, ${totalWordCount} words (method: ${finalCrawlMethod}, headless: ${headlessCount}, http: ${httpCount})`);
  
  return {
    baseUrl: url,
    pages,
    totalWordCount,
    crawledAt,
    socialLinks,
    blogSnapshot,
    crawlMethod: finalCrawlMethod,
  };
}

export function getCombinedContent(summary: CrawlSummary): string {
  return summary.pages
    .map((p) => `[${p.pageType.toUpperCase()}] ${p.title}\n${p.content}`)
    .join("\n\n---\n\n");
}
