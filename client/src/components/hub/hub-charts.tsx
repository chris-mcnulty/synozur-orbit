import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { cn } from "@/lib/utils";

/**
 * Shared chart components for the area hub pages (Home, Marketing, Sales).
 * The configs mirror the proven ones on the Research dashboard so the hubs
 * carry the same graphical richness the mockups promised, without coupling
 * to the dashboard page itself.
 */

export interface PositioningPoint {
  x: number; // innovation score (0–100)
  y: number; // market presence score (0–100)
  name: string;
  type: "us" | "competitor";
  id: string;
}

function PositioningTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as PositioningPoint | undefined;
  if (!p) return null;
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium">{p.name}</div>
      <div className="text-muted-foreground">
        Innovation {Math.round(p.x)}% · Presence {Math.round(p.y)}%
      </div>
    </div>
  );
}

export function PositioningScatter({
  data,
  onSelect,
  height = 240,
}: {
  data: PositioningPoint[];
  onSelect?: (point: PositioningPoint) => void;
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full" data-testid="hub-positioning-scatter">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            type="number"
            dataKey="x"
            name="Innovation"
            unit="%"
            domain={[0, 100]}
            label={{ value: "Innovation", position: "insideBottom", offset: -12, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Market Presence"
            unit="%"
            domain={[0, 100]}
            label={{ value: "Presence", angle: -90, position: "insideLeft", offset: 12, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip content={<PositioningTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter
            name="Competitors"
            data={data}
            shape={(props: any) => {
              const { cx, cy, payload } = props;
              const isUs = payload?.type === "us";
              const interactive = !!onSelect && !!payload;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isUs ? 11 : 7}
                  fill={isUs ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                  opacity={isUs ? 1 : 0.6}
                  style={{ cursor: interactive ? "pointer" : "default" }}
                  data-testid={`hub-scatter-point-${payload?.id}`}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-label={
                    interactive
                      ? `${payload.name}: innovation ${Math.round(payload.x)} percent, market presence ${Math.round(payload.y)} percent`
                      : undefined
                  }
                  onClick={() => interactive && onSelect!(payload)}
                  onKeyDown={(e) => {
                    if (interactive && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect!(payload);
                    }
                  }}
                />
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface ScorePoint {
  period: string;
  score: number;
}

export function ScoreTrend({ data, height = 200 }: { data: ScorePoint[]; height?: number }) {
  return (
    <div style={{ height }} className="w-full" data-testid="hub-score-trend">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="hubScoreGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(val: string) => {
              if (!val) return val;
              if (val.includes("W")) return val.replace(/^\d{4}-/, "");
              return val?.slice(-5) || val;
            }}
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={28} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number) => [value?.toFixed(0), "Orbit Score"]}
          />
          <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#hubScoreGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface StageSegment {
  label: string;
  value: number;
  /** Tailwind bg-* class for the segment + its legend dot. */
  className: string;
}

/**
 * A compact segmented horizontal bar with a legend — the "at a glance"
 * breakdown from the Marketing hub mockup, reused for any count-by-bucket
 * summary. Zero-value segments are dropped from the bar but kept in the
 * legend so the full set of states stays visible.
 */
export function StageBar({ segments }: { segments: StageSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div data-testid="hub-stage-bar">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {total === 0 ? (
          <div className="h-full w-full bg-muted" />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.label}
                className={cn("h-full", s.className)}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", s.className)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
