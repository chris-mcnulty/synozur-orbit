/**
 * Pure URL-parsing helpers for the campaign detail page.
 *
 * These are extracted from campaign-detail.tsx so they can be unit-tested
 * without DOM globals. The page calls them with `window.location.hash` and
 * `window.location.search` — tests can call them with any string.
 */

export const CAMPAIGN_TABS = ["plan", "posts", "review", "assets", "accounts", "links", "children", "hub"] as const;
export type CampaignTab = typeof CAMPAIGN_TABS[number];

/**
 * Read the active tab from a URL hash fragment.
 * `hash` should be the raw `window.location.hash` value (including the `#`),
 * or just the fragment name. Falls back to "plan" for unknown values.
 */
export function tabFromHash(hash: string): CampaignTab {
  const fragment = hash.replace(/^#/, "");
  return (CAMPAIGN_TABS as readonly string[]).includes(fragment)
    ? (fragment as CampaignTab)
    : "plan";
}

/**
 * Read the posts-tab pre-filter from a URL search string.
 * `search` should be the raw `window.location.search` value.
 * Returns the filter value, or null if absent / blank.
 */
export function filterFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("filter");
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}
