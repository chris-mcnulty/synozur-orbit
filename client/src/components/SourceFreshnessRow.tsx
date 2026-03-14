import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Globe,
  Eye,
  Users,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Lock,
} from "lucide-react";
import {
  calculateStaleness,
  getStalenessInfo,
  getTimeAgo,
  type StalenessLevel,
} from "@/lib/staleness";

export interface SourceFreshnessItem {
  id: string;
  name: string;
  lastCrawl: string | null;
  lastWebsiteMonitor: string | null;
  lastSocialMonitor: string | null;
}

export interface SourceFreshnessData {
  competitors: SourceFreshnessItem[];
  baseline: SourceFreshnessItem | null;
  overallStaleness: StalenessLevel;
}

function FreshnessDot({ level }: { level: StalenessLevel }) {
  const info = getStalenessInfo(level);
  return <span className={`inline-block w-2 h-2 rounded-full ${info.dotColor}`} />;
}

interface SourceFreshnessRowProps {
  item: SourceFreshnessItem;
  prefix: string;
  selections: Record<string, boolean>;
  onToggle: (key: string) => void;
  onRefresh?: (sourceType: "crawl" | "monitor" | "social", itemId: string) => Promise<void>;
  refreshingKeys?: Set<string>;
  autoRefreshAllowed?: boolean;
  testIdPrefix?: string;
}

export default function SourceFreshnessRow({
  item,
  prefix,
  selections,
  onToggle,
  onRefresh,
  refreshingKeys,
  autoRefreshAllowed,
  testIdPrefix = "source-freshness",
}: SourceFreshnessRowProps) {
  const sources = [
    { key: `${prefix}:${item.id}:crawl`, label: "Website Crawl", icon: <Globe className="w-3.5 h-3.5" />, ts: item.lastCrawl, type: "crawl" as const },
    { key: `${prefix}:${item.id}:monitor`, label: "Change Monitor", icon: <Eye className="w-3.5 h-3.5" />, ts: item.lastWebsiteMonitor, type: "monitor" as const },
    { key: `${prefix}:${item.id}:social`, label: "Social", icon: <Users className="w-3.5 h-3.5" />, ts: item.lastSocialMonitor, type: "social" as const },
  ];

  const worstLevel = sources.reduce<StalenessLevel>((worst, s) => {
    const level = calculateStaleness(s.ts);
    const order: StalenessLevel[] = ["fresh", "aging", "stale", "never"];
    return order.indexOf(level) > order.indexOf(worst) ? level : worst;
  }, "fresh");

  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid={`${testIdPrefix}-${item.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FreshnessDot level={worstLevel} />
          <span className="text-sm font-medium truncate">{item.name}</span>
        </div>
        {onRefresh && worstLevel !== "fresh" && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 h-6 text-xs px-2 shrink-0"
            onClick={async () => {
              // Refresh all stale sources for this item
              for (const s of sources) {
                const level = calculateStaleness(s.ts);
                if (level !== "fresh") {
                  await onRefresh(s.type, item.id);
                }
              }
            }}
            disabled={refreshingKeys?.has(item.id)}
            data-testid={`${testIdPrefix}-refresh-${item.id}`}
          >
            {refreshingKeys?.has(item.id) ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Refresh
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {sources.map((s) => {
          const level = calculateStaleness(s.ts);
          const info = getStalenessInfo(level);
          const isStale = level !== "fresh";
          const isRefreshing = refreshingKeys?.has(s.key);

          return (
            <div key={s.key} className="flex items-center gap-1.5">
              {isStale ? (
                <Checkbox
                  checked={!!selections[s.key]}
                  onCheckedChange={() => onToggle(s.key)}
                  className="h-3.5 w-3.5"
                  data-testid={`checkbox-${s.key}`}
                />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {s.icon}
                  <span className="truncate">{s.label}</span>
                  {isStale && onRefresh && (
                    <button
                      onClick={() => onRefresh(s.type, item.id)}
                      disabled={isRefreshing}
                      className="ml-auto text-primary hover:text-primary/80 shrink-0"
                      title={`Refresh ${s.label}`}
                      data-testid={`refresh-${s.key}`}
                    >
                      {isRefreshing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
                <div className={`text-[10px] ${info.color}`}>{getTimeAgo(s.ts)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
