/**
 * Marketing content deep-links — one place that knows how to jump straight to a
 * single brief / email / social post so an approver lands ready to act instead
 * of on a list to hunt through.
 *
 * Reused by every rollup surface that nudges toward one item: the campaign /
 * hub "Next actions" cards, the Planning Hub item list, and the Master Marketing
 * Calendar's item detail. The target pages honor these query params by scrolling
 * to + highlighting (or auto-opening) the item:
 *   - brief  → editorial calendar (`?brief=`, optional `?calendar=` / `?campaignId=`)
 *   - email  → email newsletters (`?emailId=`)
 *   - social → the campaign's Social Posts tab (`?post=…#posts`) when a campaign
 *              is known, else the Master Social Calendar (`?post=`)
 */

import type { ContentItemType } from "@shared/campaign-next-actions";

export interface ItemDeepLink {
  itemType: ContentItemType;
  itemId: string;
  campaignId?: string | null;
  calendarId?: string | null;
  /** Optional ISO date to land the social calendar on the right month. */
  date?: string | null;
}

/**
 * Deep-link straight to one content item. Returns undefined when the item type
 * has no single-item destination.
 */
export function itemDeepLinkHref(t: ItemDeepLink): string | undefined {
  if (!t.itemId) return undefined;
  const itemId = encodeURIComponent(t.itemId);
  switch (t.itemType) {
    case "brief": {
      const p = new URLSearchParams();
      if (t.calendarId) p.set("calendar", t.calendarId);
      if (t.campaignId) p.set("campaignId", t.campaignId);
      p.set("brief", t.itemId);
      return `/app/marketing/editorial-calendar?${p.toString()}`;
    }
    case "email":
      return `/app/marketing/email-newsletters?emailId=${itemId}`;
    case "social": {
      if (t.campaignId) {
        return `/app/marketing/campaigns/${encodeURIComponent(t.campaignId)}?post=${itemId}#posts`;
      }
      const p = new URLSearchParams();
      p.set("post", t.itemId);
      if (t.date) p.set("date", t.date);
      return `/app/marketing/calendar?${p.toString()}`;
    }
    default:
      return undefined;
  }
}
