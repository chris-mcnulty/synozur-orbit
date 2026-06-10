/**
 * Founding Signals capture.
 *
 * Freezes the news stories + intelligence action items that informed a campaign
 * at planning time onto the campaign itself, so the basis of the campaign is
 * preserved even as later intelligence briefings regenerate. Two capture paths:
 *  - Ideation: freeze the news scanned during ideation + the briefing's urgent
 *    action items + the adopted idea's cited signals.
 *  - Manual: freeze the latest published briefing's news articles + urgent
 *    action items.
 * Best-effort: if no signals are available, returns an empty snapshot rather
 * than failing.
 */

import { storage } from "../storage";
import type {
  FoundingSignals,
  FoundingSignalNews,
  FoundingSignalActionItem,
} from "@shared/schema";

const URGENT_LEVELS = new Set(["immediate", "this_week", "this_month"]);
const MAX_NEWS = 12;
const MAX_ACTION_ITEMS = 10;
const MAX_IDEA_SIGNALS = 12;

/** Shape passed from the ideation flow (the scanned news + adopted idea). */
export interface IdeationCaptureInput {
  news?: Array<{
    subject?: string;
    headlines?: Array<{ title?: string; source?: string; url?: string; snippet?: string }>;
  }>;
  signals?: string[];
  intelAsOf?: string | null;
}

interface BriefingSignals {
  news: FoundingSignalNews[];
  actionItems: FoundingSignalActionItem[];
  asOf: string | null;
}

/**
 * Reads the latest published intelligence briefing and extracts its news
 * articles + urgent action items. Returns empty arrays when none exist.
 */
async function loadBriefingSignals(
  tenantDomain: string,
  marketId?: string,
): Promise<BriefingSignals> {
  const briefing = await storage.getLatestBriefingForTenant(tenantDomain, marketId);
  if (!briefing || briefing.status !== "published") {
    return { news: [], actionItems: [], asOf: null };
  }

  const data = briefing.briefingData as any;
  if (!data) return { news: [], actionItems: [], asOf: null };

  const news: FoundingSignalNews[] = [];
  if (Array.isArray(data.newsArticles)) {
    for (const a of data.newsArticles) {
      if (!a?.title) continue;
      news.push({
        title: String(a.title),
        source: String(a.source ?? ""),
        url: String(a.url ?? ""),
        publishedAt: String(a.publishedAt ?? ""),
        description: String(a.description ?? ""),
      });
      if (news.length >= MAX_NEWS) break;
    }
  }

  const actionItems: FoundingSignalActionItem[] = [];
  if (Array.isArray(data.actionItems)) {
    for (const item of data.actionItems) {
      if (!item?.title) continue;
      if (!URGENT_LEVELS.has(String(item.urgency ?? ""))) continue;
      actionItems.push({
        title: String(item.title),
        description: String(item.description ?? ""),
        urgency: String(item.urgency ?? "watch"),
        category: item.category ? String(item.category) : undefined,
      });
      if (actionItems.length >= MAX_ACTION_ITEMS) break;
    }
  }

  const asOf =
    data.generatedAt || (briefing.createdAt ? new Date(briefing.createdAt).toISOString() : null);

  return { news, actionItems, asOf };
}

/**
 * Builds the frozen founding-signals snapshot for a campaign being created.
 * Always returns a snapshot object (possibly with empty arrays) — never throws.
 */
export async function captureFoundingSignals(opts: {
  tenantDomain: string;
  marketId?: string;
  ideation?: IdeationCaptureInput | null;
}): Promise<FoundingSignals> {
  const capturedAt = new Date().toISOString();

  let briefing: BriefingSignals = { news: [], actionItems: [], asOf: null };
  try {
    briefing = await loadBriefingSignals(opts.tenantDomain, opts.marketId);
  } catch (err: any) {
    console.error("[Founding Signals] briefing load failed:", err?.message ?? err);
  }

  const ideation = opts.ideation;
  const ideationNews: FoundingSignalNews[] = [];
  if (ideation?.news?.length) {
    for (const subject of ideation.news) {
      for (const h of subject?.headlines ?? []) {
        if (!h?.title) continue;
        ideationNews.push({
          title: String(h.title),
          source: String(h.source ?? ""),
          url: String(h.url ?? ""),
          publishedAt: "",
          description: String(h.snippet ?? ""),
        });
        if (ideationNews.length >= MAX_NEWS) break;
      }
      if (ideationNews.length >= MAX_NEWS) break;
    }
  }
  const ideaSignals = (ideation?.signals ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, MAX_IDEA_SIGNALS);

  // Treat as an ideation-founded campaign when the ideation flow contributed
  // either scanned news or cited signals.
  if (ideation && (ideationNews.length > 0 || ideaSignals.length > 0)) {
    return {
      capturedAt,
      origin: "ideation",
      briefingAsOf: ideation.intelAsOf ?? briefing.asOf ?? null,
      newsArticles: ideationNews,
      actionItems: briefing.actionItems,
      ideaSignals: ideaSignals.length ? ideaSignals : undefined,
    };
  }

  return {
    capturedAt,
    origin: "briefing",
    briefingAsOf: briefing.asOf,
    newsArticles: briefing.news,
    actionItems: briefing.actionItems,
  };
}
