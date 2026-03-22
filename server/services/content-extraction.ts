import { completeForFeature } from "./ai-provider";
import { validateUrlWithDnsCheck } from "../utils/url-validator";

interface ExtractionResult {
  title: string;
  description: string;
  content: string;
  leadImageUrl: string | null;
  aiSummary: string | null;
  siteName: string | null;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

function extractTitle(html: string): string {
  const ogTitle = extractMeta(html, "og:title");
  if (ogTitle) return ogTitle;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) return decodeHtmlEntities(titleMatch[1].trim());

  return "";
}

function extractDescription(html: string): string {
  const metaDesc = extractMeta(html, "description");
  if (metaDesc) return metaDesc;

  const ogDesc = extractMeta(html, "og:description");
  if (ogDesc) return ogDesc;

  return "";
}

function extractLeadImage(html: string, baseUrl: string): string | null {
  const ogImage = extractMeta(html, "og:image");
  if (ogImage) {
    try {
      return new URL(ogImage, baseUrl).href;
    } catch {
      return ogImage;
    }
  }

  const twitterImage = extractMeta(html, "twitter:image");
  if (twitterImage) {
    try {
      return new URL(twitterImage, baseUrl).href;
    } catch {
      return twitterImage;
    }
  }

  const heroMatch = html.match(/<(?:img|source)[^>]*src=["']([^"']+)["'][^>]*(?:class=["'][^"']*hero[^"']*["']|id=["'][^"']*hero[^"']*["'])/i) ||
    html.match(/<(?:img|source)[^>]*(?:class=["'][^"']*hero[^"']*["']|id=["'][^"']*hero[^"']*["'])[^>]*src=["']([^"']+)["']/i);
  if (heroMatch) {
    const src = heroMatch[1] || heroMatch[2];
    if (src) {
      try {
        return new URL(src, baseUrl).href;
      } catch {
        return src;
      }
    }
  }

  return null;
}

function stripHtmlToText(html: string): string {
  let text = html;

  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "• ");
  text = text.replace(/<\/tr>/gi, "\n");

  text = text.replace(/<[^>]+>/g, "");

  text = decodeHtmlEntities(text);

  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  text = text.split("\n").map(line => line.trim()).join("\n");
  text = text.trim();

  return text;
}

function extractArticleContent(html: string): string {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return stripHtmlToText(articleMatch[1]);

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return stripHtmlToText(mainMatch[1]);

  const roleMain = html.match(/<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (roleMain) return stripHtmlToText(roleMain[1]);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return stripHtmlToText(bodyMatch[1]);

  return stripHtmlToText(html);
}

export async function extractContentFromUrl(url: string): Promise<ExtractionResult> {
  const validation = await validateUrlWithDnsCheck(url);
  if (!validation.isValid) {
    throw new Error(validation.error || "URL validation failed");
  }

  const safeUrl = validation.normalizedUrl || url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(safeUrl, {
      headers: {
        "User-Agent": getRandomUA(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (response.url !== safeUrl) {
      const redirectValidation = await validateUrlWithDnsCheck(response.url);
      if (!redirectValidation.isValid) {
        throw new Error("Redirect target is not allowed");
      }
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const title = extractTitle(html);
    const description = extractDescription(html);
    const content = extractArticleContent(html);
    const leadImageUrl = extractLeadImage(html, url);
    const siteName = extractMeta(html, "og:site_name");

    const truncatedContent = content.length > 15000 ? content.substring(0, 15000) + "..." : content;

    let aiSummary: string | null = null;
    try {
      aiSummary = await generateContentSummary(title, description, truncatedContent, url);
    } catch (err: any) {
      console.error("[ContentExtraction] AI summary generation failed:", err.message);
    }

    return {
      title: title || url,
      description,
      content: truncatedContent,
      leadImageUrl,
      aiSummary,
      siteName,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateContentSummary(
  title: string,
  description: string,
  content: string,
  url: string,
): Promise<string> {
  const contentPreview = content.length > 8000 ? content.substring(0, 8000) + "..." : content;

  const prompt = `You are a marketing content analyst. Analyze the following web page content and produce a concise, actionable summary that will be useful for creating social media posts and marketing emails.

## Source
Title: ${title}
URL: ${url}
${description ? `Description: ${description}` : ""}

## Page Content
${contentPreview}

Write a 2-4 paragraph summary that captures:
1. The key message or value proposition
2. The target audience and what problem it addresses
3. Notable quotes, statistics, or proof points worth highlighting
4. Suggested angles for social media and email marketing

Keep the tone professional and factual. Focus on elements that would resonate in B2B marketing.`;

  const result = await completeForFeature("marketing_tasks", prompt);
  return result.text.trim();
}
