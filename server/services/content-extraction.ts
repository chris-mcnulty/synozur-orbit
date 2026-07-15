import * as cheerio from "cheerio";
import { completeForFeature } from "./ai-provider";
import { validateUrlWithDnsCheck } from "../utils/url-validator";
import { db } from "../db";
import { groundingDocuments, globalGroundingDocuments } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { fetchPageHeadless, isHeadlessAvailable } from "./headless-crawler";

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

/**
 * Returns true when the plain-fetch HTML looks like a generic SPA shell
 * (homepage OG tags) rather than the specific page requested.
 *
 * Signals checked:
 *  1. The requested URL has a non-root path, but og:url resolves to "/".
 *  2. The extracted title or description is empty / very short.
 *  3. The visible text content is suspiciously thin (< 100 chars).
 */
function looksLikeSpaShell(
  $: cheerio.CheerioAPI,
  requestedUrl: string,
  title: string,
  description: string,
  content: string,
): boolean {
  let requestedPath = "/";
  try {
    requestedPath = new URL(requestedUrl).pathname;
  } catch {
    return false;
  }

  // Root-path URLs have no SPA-shell problem — nothing to fall back on.
  if (requestedPath === "/" || requestedPath === "") return false;

  // Signal 1: og:url points to the site root while we asked for a sub-page.
  const ogUrl = extractMeta($, "og:url");
  if (ogUrl) {
    try {
      const ogPath = new URL(ogUrl, requestedUrl).pathname;
      if (ogPath === "/" || ogPath === "") return true;
    } catch {
      // ignore
    }
  }

  // Signal 2: metadata is absent or trivially short.
  if (!title || title.length < 10) return true;
  if (!description || description.length < 10) return true;

  // Signal 3: virtually no visible text — classic empty SPA shell.
  if (!content || content.trim().length < 100) return true;

  return false;
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

  // For Synozur's own website, append Orbit/1.0 so we can identify crawl
  // traffic in server logs while troubleshooting partial-page responses.
  const baseUA = getRandomUA();
  let hostname = "";
  try { hostname = new URL(safeUrl).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  const userAgent = hostname === "synozur.com" ? `${baseUA} Orbit/1.0` : baseUA;

  try {
    const response = await fetch(safeUrl, {
      headers: {
        "User-Agent": userAgent,
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
    let $ = cheerio.load(html);
    let title = extractTitle($);
    let description = extractDescription($);
    let content = extractVisibleText(html);
    let leadImageUrl = extractLeadImage($, url);
    let siteName = extractMeta($, "og:site_name");

    // ── Headless fallback for JS-rendered SPAs ────────────────────────────────
    // If the plain fetch returned what looks like a generic homepage shell
    // (og:url points to "/", metadata is absent, or body is nearly empty) AND
    // the headless crawler is available, re-fetch the page with a real browser
    // so JS runs and the correct page-specific OG tags are populated.
    //
    // Strategy for slow SPAs:
    //   1. First attempt waits for "meta[property='og:title']" (up to 10 s in
    //      the crawler) plus a 2 s trailing delay.  This covers most lazy-loaded
    //      OG tags without adding latency on fast pages.
    //   2. If the result is still thin (OG title absent), a second attempt fires
    //      with a longer 5 s trailing delay so heavier bundles have more time to
    //      settle.  Both attempts degrade gracefully if Chromium is unavailable.
    if (looksLikeSpaShell($, safeUrl, title, description, content) && isHeadlessAvailable()) {
      console.log(`[ContentExtraction] headless fallback triggered for ${safeUrl}`);

      const applyHeadlessResult = (headlessResult: { html: string; renderedContent: string } | null) => {
        if (!headlessResult?.html) return false;
        const h$ = cheerio.load(headlessResult.html);
        const hTitle = extractTitle(h$);
        const hDescription = extractDescription(h$);
        const hContent = headlessResult.renderedContent || extractVisibleText(headlessResult.html);
        const hLeadImageUrl = extractLeadImage(h$, safeUrl);
        const hSiteName = extractMeta(h$, "og:site_name");

        const headlessIsBetter =
          (hTitle && hTitle.length > (title?.length ?? 0)) ||
          (hDescription && hDescription.length > (description?.length ?? 0)) ||
          (hContent && hContent.trim().length > (content?.trim().length ?? 0));

        if (headlessIsBetter) {
          $ = h$;
          title = hTitle || title;
          description = hDescription || description;
          content = hContent || content;
          leadImageUrl = hLeadImageUrl || leadImageUrl;
          siteName = hSiteName || siteName;
          return true;
        }
        return false;
      };

      const isHeadlessThin = (headlessResult: { html: string } | null): boolean => {
        if (!headlessResult?.html) return true;
        const h$ = cheerio.load(headlessResult.html);
        return !extractTitle(h$);
      };

      try {
        // Attempt 1: wait for the OG title tag to appear (handled inside the
        // crawler with a 10 s selector timeout), then a short trailing delay.
        const headlessResult = await fetchPageHeadless(safeUrl, {
          waitForSelector: "meta[property='og:title']",
          waitTime: 2000,
          timeout: 30000,
        });

        const applied = applyHeadlessResult(headlessResult);

        // Attempt 2: fire a slower retry when the first pass is still thin
        // (OG title never appeared).  The extra trailing delay gives heavy JS
        // bundles more time to render before we snapshot.
        if (!applied && isHeadlessThin(headlessResult)) {
          console.log(`[ContentExtraction] headless result thin for ${safeUrl}, retrying with longer wait`);
          const retryResult = await fetchPageHeadless(safeUrl, {
            waitForSelector: "meta[property='og:title']",
            waitTime: 5000,
            timeout: 45000,
          });
          applyHeadlessResult(retryResult);
        }
      } catch (err: any) {
        console.warn(`[ContentExtraction] headless fallback failed for ${safeUrl}: ${err.message}`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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
