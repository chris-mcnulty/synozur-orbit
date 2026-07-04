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
 *
 * Dismiss behaviour: users can dismiss individual action rows (campaign page) or
 * whole campaigns (hub) to clear false positives. Dismissals are stored in
 * localStorage keyed by pending-count so they clear automatically when new
 * work arrives.
 */

import { useState, useCallback } from "react";
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
  X,
  Eye,
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

// ── Dismiss helpers ──────────────────────────────────────────────────────────

/**
 * Dismissals are stored as `pendingCount` per key. A dismissal expires
 * automatically when the pending count changes — so if the campaign picks up
 * new work, or if you fix something and the count drops, it reappears.
 */
const HUB_DISMISS_KEY = "orbit-hub-next-actions-dismissed";
const CAMPAIGN_DISMISS_KEY = "orbit-campaign-next-actions-dismissed";

type DismissedMap = Record<string, number>;

function loadDismissed(key: string): DismissedMap {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

function saveDismissed(key: string, map: DismissedMap): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

function useDismiss(storageKey: string) {
  const [dismissed, setDismissed] = useState<DismissedMap>(() => loadDismissed(storageKey));

  const dismiss = useCallback((id: string, pendingCount: number) => {
    setDismissed((prev) => {
      const next = { ...prev, [id]: pendingCount };
      saveDismissed(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const restore = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = { ...prev };
      delete next[id];
      saveDismissed(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const restoreAll = useCallback(() => {
    setDismissed({});
    saveDismissed(storageKey, {});
  }, [storageKey]);

  /** True when this id is dismissed AND its stored pending count still matches. */
  const isDismissed = useCallback((id: string, currentPending: number): boolean => {
    return id in dismissed && dismissed[id] === currentPending;
  }, [dismissed]);

  return { dismiss, restore, restoreAll, isDismissed };
}

// ── Group row ────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  campaignId,
  onAction,
  href,
  onDismiss,
}: {
  group: ActionGroup;
  campaignId: string;
  onAction?: (tab: string, filter?: string) => void;
  href?: string;
  onDismiss?: () => void;
}) {
  const Icon = ACTION_ICON[group.headlineAction];
  const tab = actionTab(group);
  const filter = actionFilter(group);
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
      <div className="min-w-0 flex-1">
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
      <div className="flex items-center gap-1 shrink-0">
        {linkHref ? (
          <Button size="sm" variant="outline" className="gap-1.5" asChild data-testid={`next-action-${group.key}`}>
            <Link href={linkHref}>
              <Icon className="w-3.5 h-3.5" />
              {ACTION_LABELS[group.headlineAction]}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        ) : (
          button
        )}
        {onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
            title="Dismiss this action (reappears if new work is added)"
            data-testid={`dismiss-action-${group.key}`}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── CampaignNextActions (single campaign) ────────────────────────────────────

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

  const { dismiss, restore, isDismissed } = useDismiss(`${CAMPAIGN_DISMISS_KEY}-${campaignId}`);

  const allPending = (data?.groups ?? []).filter((g) => g.pending > 0);
  const visible = allPending.filter((g) => !isDismissed(g.key, g.pending));
  const hiddenCount = allPending.length - visible.length;

  if (allPending.length === 0) return null;

  return (
    <Card data-testid="campaign-next-actions">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" /> Next actions
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {visible.length > 0 ? (
          <div className="divide-y">
            {visible.map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                campaignId={campaignId}
                onAction={onNavigate}
                onDismiss={() => dismiss(g.key, g.pending)}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">All actions dismissed.</p>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => allPending.forEach((g) => restore(g.key))}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="campaign-next-actions-show-dismissed"
          >
            <Eye className="w-3 h-3" />
            {hiddenCount} dismissed — show
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ── MarketingHubNextActions (cross-campaign) ─────────────────────────────────

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

  const { dismiss, restoreAll, isDismissed } = useDismiss(HUB_DISMISS_KEY);
  const [showDismissed, setShowDismissed] = useState(false);

  const allCampaigns = data?.campaigns ?? [];
  const visible = allCampaigns.filter((c) => showDismissed || !isDismissed(c.campaignId, c.pending));
  const hiddenCount = allCampaigns.filter((c) => isDismissed(c.campaignId, c.pending)).length;

  if (allCampaigns.length === 0) return null;

  return (
    <Card data-testid="hub-next-actions">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" /> What needs action next
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {visible.length > 0 ? (
          visible.map((c) => {
            const dismissed = isDismissed(c.campaignId, c.pending);
            return (
              <div key={c.campaignId} className={dismissed ? "opacity-50" : undefined}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Link
                    href={`/app/marketing/campaigns/${c.campaignId}`}
                    className="text-sm font-semibold hover:underline truncate"
                    data-testid={`hub-next-campaign-${c.campaignId}`}
                  >
                    {c.campaignName}
                  </Link>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{c.pending} pending</Badge>
                    {!dismissed && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => dismiss(c.campaignId, c.pending)}
                        title="Dismiss — reappears automatically if new work is added"
                        data-testid={`dismiss-campaign-${c.campaignId}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="divide-y border-l-2 border-muted pl-3">
                  {c.groups.map((g) => (
                    <GroupRow key={g.key} group={g} campaignId={c.campaignId} href={groupHref(c.campaignId, g)} />
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-muted-foreground py-1">All caught up — no pending actions.</p>
        )}
        {hiddenCount > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <button
              type="button"
              onClick={() => {
                if (showDismissed) {
                  setShowDismissed(false);
                } else {
                  setShowDismissed(true);
                }
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="hub-next-actions-show-dismissed"
            >
              <Eye className="w-3 h-3" />
              {showDismissed ? "Hide dismissed" : `${hiddenCount} dismissed — show`}
            </button>
            {showDismissed && (
              <button
                type="button"
                onClick={() => { restoreAll(); setShowDismissed(false); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                data-testid="hub-next-actions-restore-all"
              >
                Restore all
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
