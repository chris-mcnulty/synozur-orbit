/**
 * Next-actions-by-batch control.
 *
 * Renders the "what needs to happen next" rollup for marketing campaigns, one
 * row per batch (generation run / repurpose set / conference) or content type,
 * each with its headline action and a button that jumps to the right place.
 *
 * Two entry points share the row renderer: `CampaignNextActions` (scoped to one
 * campaign, switches tabs in place) and `MarketingHubNextActions` (cross-campaign
 * on the marketing hub, links into each campaign). The lifecycle → action
 * mapping lives in the shared `campaign-next-actions` core; this is presentation.
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  PenLine,
  CheckCircle,
  CalendarClock,
  Send,
  AlertTriangle,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ACTION_LABELS,
  singleItemHref,
  actionTab,
  actionFilter,
  groupHref,
  type ActionGroup,
  type NextAction,
} from "@shared/campaign-next-actions";

interface CampaignActionSummary {
  campaignId: string;
  campaignName: string;
  status: string;
  pending: number;
  groups: ActionGroup[];
}

const ACTION_ICON: Record<NextAction, typeof Sparkles> = {
  generate: Sparkles,
  draft: PenLine,
  approve: CheckCircle,
  schedule: CalendarClock,
  post: Send,
  fix: AlertTriangle,
  done: CheckCircle,
};

const ACTION_TONE: Record<NextAction, string> = {
  fix: "text-red-600 border-red-300 dark:text-red-400",
  generate: "text-violet-600 border-violet-300 dark:text-violet-400",
  draft: "text-violet-600 border-violet-300 dark:text-violet-400",
  approve: "text-amber-600 border-amber-300 dark:text-amber-400",
  schedule: "text-blue-600 border-blue-300 dark:text-blue-400",
  post: "text-emerald-600 border-emerald-300 dark:text-emerald-400",
  done: "text-muted-foreground border-muted-foreground/40",
};

/** Compact "12 approve · 6 schedule" breakdown of the remaining work. */
function breakdown(group: ActionGroup): string {
  return (Object.entries(group.actionCounts) as [NextAction, number][])
    .filter(([a, n]) => a !== "done" && n > 0)
    .map(([a, n]) => `${n} ${ACTION_LABELS[a].toLowerCase()}`)
    .join(" · ");
}

function GroupRow({
  group,
  campaignId,
  onAction,
  href,
}: {
  group: ActionGroup;
  campaignId: string;
  onAction?: (tab: string, filter?: string) => void;
  href?: string;
}) {
  const Icon = ACTION_ICON[group.headlineAction];
  const tab = actionTab(group);
  const filter = actionFilter(group);
  // A single-item group always deep-links to the exact item (even in the
  // in-page campaign rollup); only multi-item groups fall back to the tab.
  const linkHref = singleItemHref(campaignId, group) ?? href;
  const button = (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0 gap-1.5"
      onClick={onAction ? () => onAction(tab, filter) : undefined}
      data-testid={`next-action-${group.key}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {ACTION_LABELS[group.headlineAction]}
      <ArrowRight className="w-3 h-3" />
    </Button>
  );

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{group.label}</span>
          <Badge variant="outline" className={`text-[10px] gap-1 ${ACTION_TONE[group.headlineAction]}`}>
            {ACTION_LABELS[group.headlineAction]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {group.pending} of {group.total} pending{breakdown(group) ? ` — ${breakdown(group)}` : ""}
        </p>
      </div>
      {linkHref ? (
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" asChild data-testid={`next-action-${group.key}`}>
          <Link href={linkHref}>
            <Icon className="w-3.5 h-3.5" />
            {ACTION_LABELS[group.headlineAction]}
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
      ) : (
        button
      )}
    </div>
  );
}

/** Scoped to one campaign; `onNavigate(tab, filter?)` switches the campaign's tab. */
export function CampaignNextActions({
  campaignId,
  onNavigate,
}: {
  campaignId: string;
  onNavigate?: (tab: string, filter?: string) => void;
}) {
  const { data } = useQuery<{ groups: ActionGroup[] }>({
    queryKey: ["/api/marketing/campaigns", campaignId, "next-actions"],
    queryFn: async () => {
      const r = await fetch(`/api/marketing/campaigns/${campaignId}/next-actions`, { credentials: "include" });
      if (!r.ok) return { groups: [] };
      return r.json();
    },
  });

  const pending = (data?.groups ?? []).filter((g) => g.pending > 0);
  if (pending.length === 0) return null;

  return (
    <Card data-testid="campaign-next-actions">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" /> Next actions
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y pt-0">
        {pending.map((g) => (
          <GroupRow key={g.key} group={g} campaignId={campaignId} onAction={onNavigate} />
        ))}
      </CardContent>
    </Card>
  );
}

/** Cross-campaign rollup for the marketing hub; links into each campaign. */
export function MarketingHubNextActions() {
  const { data } = useQuery<{ campaigns: CampaignActionSummary[] }>({
    queryKey: ["/api/marketing/next-actions"],
    queryFn: async () => {
      const r = await fetch("/api/marketing/next-actions", { credentials: "include" });
      if (!r.ok) return { campaigns: [] };
      return r.json();
    },
  });

  const campaigns = data?.campaigns ?? [];
  if (campaigns.length === 0) return null;

  return (
    <Card data-testid="hub-next-actions">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" /> What needs action next
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {campaigns.map((c) => (
          <div key={c.campaignId}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <Link
                href={`/app/marketing/campaigns/${c.campaignId}`}
                className="text-sm font-semibold hover:underline truncate"
                data-testid={`hub-next-campaign-${c.campaignId}`}
              >
                {c.campaignName}
              </Link>
              <Badge variant="secondary" className="text-[10px] shrink-0">{c.pending} pending</Badge>
            </div>
            <div className="divide-y border-l-2 border-muted pl-3">
              {c.groups.map((g) => (
                <GroupRow key={g.key} group={g} campaignId={c.campaignId} href={groupHref(c.campaignId, g)} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
