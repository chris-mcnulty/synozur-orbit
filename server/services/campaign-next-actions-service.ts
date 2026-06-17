/**
 * Campaign next-actions service.
 *
 * Assembles the "what needs to happen next" rollup for marketing campaigns from
 * three content sources (generated social posts, content briefs, generated
 * emails), then groups them with the pure `campaign-next-actions` core. Social
 * posts carry their batch identity (generation run / repurpose set / conference)
 * so the UI can show one row per batch; briefs and emails bucket by type.
 *
 * Two entry points share the assembly: one campaign (campaign page) and all
 * active campaigns (marketing hub). Grouping is `batch` today; the core also
 * supports `account` for a future ABM view, so account keys are passed through.
 */

import { db } from "../db";
import {
  generatedPosts,
  contentBriefs,
  generatedEmails,
  conferences,
  campaigns,
} from "@shared/schema";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { batchSourceOf } from "@shared/social-rollup";
import {
  groupNextActions,
  socialPostAction,
  briefAction,
  emailAction,
  type ActionableItem,
  type ActionGroup,
} from "@shared/campaign-next-actions";

const HIDDEN_POST_STATUSES = ["deleted", "archived", "rejected"];

/** Resolve a human label for a social post's batch. */
function batchLabel(
  post: { conferenceId: string | null; generationJobId: string | null; variantGroup: string | null },
  key: string,
  conferenceNames: Map<string, string>,
): string {
  if (post.conferenceId && key === post.conferenceId) {
    return `Conference: ${conferenceNames.get(post.conferenceId) ?? "event"}`;
  }
  if (post.generationJobId && key === post.generationJobId) return "Generation run";
  if (post.variantGroup && key === post.variantGroup) return "Repurpose set";
  return "Batch";
}

interface CampaignContent {
  posts: typeof generatedPosts.$inferSelect[];
  briefs: typeof contentBriefs.$inferSelect[];
  emails: typeof generatedEmails.$inferSelect[];
}

/** Map a campaign's content rows into actionable items for the grouping core. */
function toActionItems(
  content: CampaignContent,
  conferenceNames: Map<string, string>,
  accountKey: string | null,
  accountLabel: string | null,
): ActionableItem[] {
  const items: ActionableItem[] = [];

  for (const p of content.posts) {
    const key = batchSourceOf(p);
    items.push({
      id: p.id,
      itemType: "social",
      status: p.status,
      action: socialPostAction({
        status: p.status,
        scheduledDate: p.scheduledDate ? p.scheduledDate.toISOString() : null,
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
        publishError: p.publishError,
      }),
      batchKey: key,
      batchLabel: key ? batchLabel(p, key, conferenceNames) : null,
      accountKey,
      accountLabel,
    });
  }

  for (const b of content.briefs) {
    items.push({
      id: b.id,
      itemType: "brief",
      status: b.status,
      action: briefAction(b.status),
      accountKey,
      accountLabel,
    });
  }

  for (const e of content.emails) {
    items.push({
      id: e.id,
      itemType: "email",
      status: e.status,
      action: emailAction(e.status),
      accountKey,
      accountLabel,
    });
  }

  return items;
}

/** Tenant-wide conference id → name lookup (for batch labels). */
async function loadConferenceNames(tenantDomain: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: conferences.id, name: conferences.name })
    .from(conferences)
    .where(eq(conferences.tenantDomain, tenantDomain));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadCampaignContent(
  tenantDomain: string,
  campaignIds: string[],
): Promise<Map<string, CampaignContent>> {
  const byCampaign = new Map<string, CampaignContent>();
  for (const id of campaignIds) byCampaign.set(id, { posts: [], briefs: [], emails: [] });
  if (campaignIds.length === 0) return byCampaign;

  // Scope every read to the tenant as well as the campaign ids — defense in
  // depth, so this helper can't leak cross-tenant rows if reused without an
  // upstream campaign-ownership check.
  const [posts, briefs, emails] = await Promise.all([
    db
      .select()
      .from(generatedPosts)
      .where(and(
        eq(generatedPosts.tenantDomain, tenantDomain),
        inArray(generatedPosts.campaignId, campaignIds),
        notInArray(generatedPosts.status, HIDDEN_POST_STATUSES),
      )),
    db
      .select()
      .from(contentBriefs)
      .where(and(
        eq(contentBriefs.tenantDomain, tenantDomain),
        inArray(contentBriefs.campaignId, campaignIds),
        notInArray(contentBriefs.status, ["removed"]),
      )),
    db
      .select()
      .from(generatedEmails)
      .where(and(
        eq(generatedEmails.tenantDomain, tenantDomain),
        inArray(generatedEmails.campaignId, campaignIds),
      )),
  ]);

  for (const p of posts) if (p.campaignId) byCampaign.get(p.campaignId)?.posts.push(p);
  for (const b of briefs) if (b.campaignId) byCampaign.get(b.campaignId)?.briefs.push(b);
  for (const e of emails) if (e.campaignId) byCampaign.get(e.campaignId)?.emails.push(e);
  return byCampaign;
}

/** Next-action groups for a single campaign (the campaign page rollup). */
export async function getCampaignNextActions(
  tenantDomain: string,
  campaignId: string,
): Promise<ActionGroup[]> {
  const [content, conferenceNames] = await Promise.all([
    loadCampaignContent(tenantDomain, [campaignId]),
    loadConferenceNames(tenantDomain),
  ]);
  const items = toActionItems(content.get(campaignId)!, conferenceNames, null, null);
  return groupNextActions(items, "batch");
}

export interface CampaignActionSummary {
  campaignId: string;
  campaignName: string;
  status: string;
  pending: number;
  groups: ActionGroup[];
}

/**
 * Next-action groups across all active campaigns (the marketing hub rollup).
 * Only campaigns with at least one pending action are returned, most-pending
 * first.
 */
export async function getCrossCampaignNextActions(
  tenantDomain: string,
): Promise<CampaignActionSummary[]> {
  const active = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.tenantDomain, tenantDomain), eq(campaigns.status, "active")));
  if (active.length === 0) return [];

  const [content, conferenceNames] = await Promise.all([
    loadCampaignContent(tenantDomain, active.map((c) => c.id)),
    loadConferenceNames(tenantDomain),
  ]);

  const summaries: CampaignActionSummary[] = [];
  for (const c of active) {
    const items = toActionItems(content.get(c.id)!, conferenceNames, null, null);
    const groups = groupNextActions(items, "batch").filter((g) => g.pending > 0);
    const pending = groups.reduce((sum, g) => sum + g.pending, 0);
    if (pending > 0) {
      summaries.push({ campaignId: c.id, campaignName: c.name, status: c.status, pending, groups });
    }
  }
  summaries.sort((a, b) => b.pending - a.pending);
  return summaries;
}
