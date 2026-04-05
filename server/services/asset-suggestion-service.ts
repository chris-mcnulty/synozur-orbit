import { db } from "../db";
import { suggestedContentAssets, contentAssets } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

interface CrawlPage {
  url: string;
  pageType: string;
  title: string;
  content: string;
  wordCount: number;
}

interface CrawlSummary {
  baseUrl: string;
  pages: CrawlPage[];
  blogSnapshot?: {
    postCount: number;
    latestTitles: string[];
  };
}

const ASSET_WORTHY_PATTERNS: { pattern: RegExp; category: string; reason: string }[] = [
  { pattern: /\/blog\//i, category: "Blog Posts", reason: "Blog post — good for social media repurposing and SEO" },
  { pattern: /\/case.stud/i, category: "Case Studies", reason: "Case study — ideal for nurture campaigns and social proof" },
  { pattern: /\/success.stor/i, category: "Case Studies", reason: "Success story — strong social proof for campaigns" },
  { pattern: /\/customer.stor/i, category: "Case Studies", reason: "Customer story — ideal for social proof content" },
  { pattern: /\/whitepaper/i, category: "Whitepapers", reason: "Whitepaper — high-value gated content for lead generation" },
  { pattern: /\/ebook/i, category: "eBooks", reason: "eBook — premium content for lead gen campaigns" },
  { pattern: /\/webinar/i, category: "Webinars", reason: "Webinar — repurposable for clips, social posts, and follow-up campaigns" },
  { pattern: /\/event/i, category: "Events", reason: "Event page — useful for event marketing campaigns" },
  { pattern: /\/resource/i, category: "Resources", reason: "Resource page — potential gated content for lead generation" },
  { pattern: /\/guide/i, category: "Guides", reason: "Guide — educational content suitable for nurture sequences" },
  { pattern: /\/news\//i, category: "News & Press", reason: "News item — can be amplified through social channels" },
  { pattern: /\/press/i, category: "News & Press", reason: "Press release — good for credibility and social sharing" },
  { pattern: /\/infographic/i, category: "Infographics", reason: "Infographic — highly shareable visual content" },
  { pattern: /\/video/i, category: "Video", reason: "Video content — high engagement for social and email campaigns" },
  { pattern: /\/podcast/i, category: "Podcasts", reason: "Podcast — repurposable into clips and social posts" },
  { pattern: /\/testimonial/i, category: "Testimonials", reason: "Testimonial page — valuable for trust-building campaigns" },
  { pattern: /\/insight/i, category: "Insights", reason: "Thought leadership content — ideal for positioning campaigns" },
  { pattern: /\/article/i, category: "Articles", reason: "Article — content suitable for social distribution and newsletters" },
  { pattern: /\/recipe/i, category: "Recipes", reason: "Recipe — engaging consumer content for social and email" },
  { pattern: /\/menu/i, category: "Menus", reason: "Menu page — useful for promotional and seasonal campaigns" },
  { pattern: /\/tasting/i, category: "Experiences", reason: "Tasting/experience page — great for event and local marketing" },
  { pattern: /\/tour/i, category: "Experiences", reason: "Tour/experience — ideal for experiential marketing campaigns" },
  { pattern: /\/offer/i, category: "Promotions", reason: "Offer or promotion page — ready-made campaign material" },
  { pattern: /\/special/i, category: "Promotions", reason: "Special offer — direct campaign material" },
];

const EXCLUDED_PATTERNS = [
  /\/privacy/i, /\/terms/i, /\/cookie/i, /\/legal/i, /\/sitemap/i,
  /\/contact/i, /\/login/i, /\/signup/i, /\/register/i, /\/cart/i,
  /\/checkout/i, /\/account/i, /\/admin/i, /\/careers/i, /\/jobs/i,
  /\.(pdf|jpg|png|gif|svg|css|js)$/i,
];

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim().toLowerCase());
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function isAssetCandidate(page: CrawlPage): { isCandidate: boolean; category?: string; reason?: string } {
  if (page.wordCount < 100) return { isCandidate: false };

  if (EXCLUDED_PATTERNS.some(p => p.test(page.url))) return { isCandidate: false };

  for (const { pattern, category, reason } of ASSET_WORTHY_PATTERNS) {
    if (pattern.test(page.url)) {
      return { isCandidate: true, category, reason };
    }
  }

  if (page.pageType === "blog" && page.wordCount >= 200) {
    return { isCandidate: true, category: "Blog Posts", reason: "Blog content — suitable for social media and newsletter distribution" };
  }

  if (page.wordCount >= 500 && page.pageType === "other") {
    const title = page.title.toLowerCase();
    const contentLower = page.content.substring(0, 500).toLowerCase();
    if (
      /case study|success story|customer story|whitepaper|ebook|guide|how to|tutorial|report|analysis/i.test(title) ||
      /case study|success story|whitepaper|download now|read more|learn how/i.test(contentLower)
    ) {
      return { isCandidate: true, category: "Resources", reason: "Content-rich page with marketing potential" };
    }
  }

  return { isCandidate: false };
}

export async function identifySuggestedAssets(
  crawlResult: CrawlSummary,
  companyProfileId: string,
  tenantDomain: string,
  marketId?: string,
): Promise<number> {
  const candidates = crawlResult.pages
    .map(page => {
      const { isCandidate, category, reason } = isAssetCandidate(page);
      if (!isCandidate) return null;
      return {
        url: page.url,
        title: page.title || page.url,
        pageType: page.pageType,
        category: category || "Other",
        reason: reason || "Potential marketing content",
      };
    })
    .filter(Boolean) as Array<{ url: string; title: string; pageType: string; category: string; reason: string }>;

  if (candidates.length === 0) return 0;

  const existingAssets = await db.select({ url: contentAssets.url })
    .from(contentAssets)
    .where(and(
      eq(contentAssets.tenantDomain, tenantDomain),
      marketId ? eq(contentAssets.marketId, marketId) : undefined as any,
      eq(contentAssets.status, "active"),
    ));

  const existingSuggestions = await db.select({ url: suggestedContentAssets.url })
    .from(suggestedContentAssets)
    .where(and(
      eq(suggestedContentAssets.tenantDomain, tenantDomain),
      eq(suggestedContentAssets.companyProfileId, companyProfileId),
    ));

  const existingUrls = new Set([
    ...existingAssets.map(a => a.url ? normalizeUrl(a.url) : ""),
    ...existingSuggestions.map(s => normalizeUrl(s.url)),
  ].filter(Boolean));

  const newCandidates = candidates.filter(c => !existingUrls.has(normalizeUrl(c.url)));

  if (newCandidates.length === 0) return 0;

  const toInsert = newCandidates.slice(0, 25).map(c => ({
    tenantDomain,
    marketId: marketId || null,
    companyProfileId,
    url: c.url,
    title: c.title,
    pageType: c.pageType,
    reason: c.reason,
    suggestedCategory: c.category,
    status: "pending" as const,
  }));

  await db.insert(suggestedContentAssets).values(toInsert);

  console.log(`[Asset Suggestions] Found ${toInsert.length} new content asset candidates for ${tenantDomain}`);

  return toInsert.length;
}
