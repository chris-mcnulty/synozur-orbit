import * as cheerio from "cheerio";
import { completeForFeature } from "./ai-provider";
import { validateUrlWithDnsCheck } from "../utils/url-validator";
import { db } from "../db";
import { groundingDocuments, globalGroundingDocuments } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

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

function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg, head").remove();

  $(
    "nav, header, footer, " +
    "[role='navigation'], [role='banner'], [role='contentinfo'], " +
    ".nav, .navbar, .sidebar, .menu, .breadcrumb, .cookie-banner, " +
    ".site-header, .site-footer, .site-nav"
  ).remove();

  const semanticSelectors = [
    "article",
    "main",
    "[role='main']",
    ".post-content",
    ".entry-content",
    ".page-content",
  ];

  for (const selector of semanticSelectors) {
    const el = $(selector);
    if (el.length) {
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 100) {
        return text.substring(0, 3000);
      }
    }
  }

  const paragraphs = $("p")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t: string) => t.length > 30);

  if (paragraphs.length > 0) {
    const combined = paragraphs.join("\n\n");
    return combined.substring(0, 3000);
  }

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  return bodyText.substring(0, 3000);
}

function extractMeta($: cheerio.CheerioAPI, property: string): string | null {
  const selectors = [
    `meta[property='${property}']`,
    `meta[name='${property}']`,
  ];
  for (const sel of selectors) {
    const content = $(sel).attr("content");
    if (content?.trim()) return content.trim();
  }
  return null;
}

function extractTitle($: cheerio.CheerioAPI): string {
  const ogTitle = extractMeta($, "og:title");
  if (ogTitle) return ogTitle;

  const titleText = $("title").first().text().trim();
  if (titleText) return titleText;

  return "";
}

function extractDescription($: cheerio.CheerioAPI): string {
  const metaDesc = extractMeta($, "description");
  if (metaDesc) return metaDesc;

  const ogDesc = extractMeta($, "og:description");
  if (ogDesc) return ogDesc;

  return "";
}

function extractLeadImage($: cheerio.CheerioAPI, baseUrl: string): string | null {
  const ogImage = extractMeta($, "og:image");
  if (ogImage) {
    try {
      return new URL(ogImage, baseUrl).href;
    } catch {
      return ogImage;
    }
  }

  const twitterImage = extractMeta($, "twitter:image");
  if (twitterImage) {
    try {
      return new URL(twitterImage, baseUrl).href;
    } catch {
      return twitterImage;
    }
  }

  const heroImg = $("img.hero, img#hero, img[class*='hero']").first().attr("src");
  if (heroImg) {
    try {
      return new URL(heroImg, baseUrl).href;
    } catch {
      return heroImg;
    }
  }

  return null;
}

async function loadGroundingContext(tenantDomain: string, marketId?: string): Promise<string> {
  const tiers: string[] = [];

  const globalDocs = await db.select().from(globalGroundingDocuments)
    .where(and(
      eq(globalGroundingDocuments.isActive, true),
      sql`${globalGroundingDocuments.extractedText} IS NOT NULL AND ${globalGroundingDocuments.extractedText} != ''`,
    ));
  if (globalDocs.length > 0) {
    const systemContext = globalDocs
      .map(d => `[${d.name}]\n${d.extractedText}`)
      .join("\n\n");
    tiers.push(`## System Guidelines\n${systemContext}`);
  }

  const tenantDocs = await db.select().from(groundingDocuments)
    .where(and(
      eq(groundingDocuments.tenantDomain, tenantDomain),
      sql`(${groundingDocuments.contexts} IS NULL OR ${groundingDocuments.contexts} @> '["marketing_content"]'::jsonb)`,
      sql`${groundingDocuments.extractedText} IS NOT NULL AND ${groundingDocuments.extractedText} != ''`,
    ));

  const tenantOnlyDocs = tenantDocs.filter(d => !d.marketId);
  if (tenantOnlyDocs.length > 0) {
    const tenantContext = tenantOnlyDocs
      .map(d => `[${d.name}]\n${d.extractedText}`)
      .join("\n\n");
    tiers.push(`## Tenant Guidelines\n${tenantContext}`);
  }

  if (marketId) {
    const marketDocs = tenantDocs.filter(d => d.marketId === marketId);
    if (marketDocs.length > 0) {
      const marketContext = marketDocs
        .map(d => `[${d.name}]\n${d.extractedText}`)
        .join("\n\n");
      tiers.push(`## Market-Specific Guidelines\n${marketContext}`);
    }
  }

  return tiers.join("\n\n");
}

export async function extractContentFromUrl(url: string, groundingContext?: string): Promise<ExtractionResult> {
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
    const $ = cheerio.load(html);
    const title = extractTitle($);
    const description = extractDescription($);
    const content = extractVisibleText(html);
    const leadImageUrl = extractLeadImage($, url);
    const siteName = extractMeta($, "og:site_name");

    let aiSummary: string | null = null;
    try {
      aiSummary = await generateContentSummary(title, description, content, url, groundingContext);
    } catch (err: any) {
      console.error("[ContentExtraction] AI summary generation failed:", err.message);
    }

    return {
      title: title || url,
      description,
      content,
      leadImageUrl,
      aiSummary,
      siteName,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateContentSummary(
  title: string,
  description: string,
  content: string,
  url: string,
  groundingContext?: string,
): Promise<string> {
  const contentPreview = content.length > 3000 ? content.substring(0, 3000) + "..." : content;

  const hasSubstantiveContent = contentPreview && contentPreview.trim().length > 100;

  const systemParts = [
    `You are a social media marketing expert who writes engaging post captions for B2B brands.`,
  ];

  if (groundingContext) {
    systemParts.push(`\n## Brand & Marketing Context\n${groundingContext}`);
  }

  const systemMessage = systemParts.join("\n");

  const prompt = `${systemMessage}

## Source
Title: ${title}
URL: ${url}
${description ? `Meta Description: ${description}` : ""}

${hasSubstantiveContent ? `## Page Content\n${contentPreview}` : "## Note\nNo full page content is available. Generate the best summary you can from the title and meta description above."}

Write a concise, engaging social media caption (3-5 sentences, 150-250 words) that reads as a standalone social post. Follow these rules strictly:

1. Open with a strong hook — a surprising stat, bold claim, or thought-provoking question that stops the scroll
2. Focus on the value, key takeaway, or transformation the content delivers — not a description of the article itself
3. The caption must be fully readable and valuable on its own without clicking through to the source
4. Strip and ignore all non-editorial material: navigation text, cookie banners, headers/footers, download prompts, breadcrumbs, sidebar content
5. Do NOT include hashtags
6. Do NOT lead with the company or brand name
7. Use an active, conversational tone — write like you're sharing an insight with a peer
8. Use line breaks between distinct thoughts for readability

Return ONLY the caption text, nothing else.`;

  const result = await completeForFeature("marketing_tasks", prompt);
  return result.text.trim();
}

export { loadGroundingContext };
