import React, { useState, useEffect } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
  ReferenceLine,
} from "recharts";
import { Map, Save, Shuffle, Loader2 } from "lucide-react";

const AXIS_OPTIONS = [
  "Market Presence",
  "Innovation",
  "Price",
  "Feature Breadth",
  "Brand Awareness",
  "Customer Focus",
];

interface PositionEntry {
  id?: string;
  entityId: string;
  entityType: "competitor" | "baseline";
  entityName: string;
  x: number;
  y: number;
  xAxisLabel: string;
  yAxisLabel: string;
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: PositionEntry;
}

const CustomDot = ({ cx = 0, cy = 0, payload }: CustomDotProps) => {
  const isBaseline = payload?.entityType === "baseline";
  const fill = isBaseline ? "#7c3aed" : "#f59e0b";
  const stroke = isBaseline ? "#5b21b6" : "#d97706";
  const name = payload?.entityName ?? "";
  return (
    <g>
      <circle cx={cx} cy={cy} r={10} fill={fill} stroke={stroke} strokeWidth={2} />
      <text
        x={cx}
        y={cy - 15}
        textAnchor="middle"
        fontSize={11}
        fill="#374151"
        fontWeight={isBaseline ? 700 : 500}
      >
        {name.length > 16 ? name.slice(0, 14) + "…" : name}
      </text>
    </g>
  );
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as PositionEntry;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-sm">
      <p className="font-semibold text-gray-900">{d.entityName}</p>
      <p className="text-gray-500 capitalize">{d.entityType}</p>
      <p className="text-gray-700">
        {d.xAxisLabel}: <span className="font-medium">{Math.round(d.x)}</span>
      </p>
      <p className="text-gray-700">
        {d.yAxisLabel}: <span className="font-medium">{Math.round(d.y)}</span>
      </p>
    </div>
  );
};

export default function PositioningMapPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [xAxisLabel, setXAxisLabel] = useState("Market Presence");
  const [yAxisLabel, setYAxisLabel] = useState("Innovation");
  const [positions, setPositions] = useState<PositionEntry[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const { data: competitors = [] } = useQuery<any[]>({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch competitors");
      return res.json();
    },
  });

  const { data: companyProfile } = useQuery<any>({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: savedPositions = [], isLoading: loadingPositions } = useQuery<PositionEntry[]>({
    queryKey: ["/api/positioning-map"],
    queryFn: async () => {
      const res = await fetch("/api/positioning-map", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch positioning map");
      return res.json();
    },
  });

  // Merge saved positions with current entities
  useEffect(() => {
    if (!competitors || companyProfile === undefined) return;

    const savedById: Record<string, PositionEntry> = {};
    for (const p of savedPositions) {
      savedById[p.entityId] = p as PositionEntry;
    }

    // Determine axis labels from saved data (use most common)
    if (savedPositions.length > 0) {
      setXAxisLabel(savedPositions[0].xAxisLabel || "Market Presence");
      setYAxisLabel(savedPositions[0].yAxisLabel || "Innovation");
    }

    const entries: PositionEntry[] = [];

    // Baseline entry
    if (companyProfile) {
      const baselineId = companyProfile.id || "baseline";
      const saved = savedById[baselineId];
      entries.push({
        entityId: baselineId,
        entityType: "baseline",
        entityName: companyProfile.companyName || "Your Company",
        x: saved?.x ?? 50,
        y: saved?.y ?? 50,
        xAxisLabel,
        yAxisLabel,
      });
    }

    // Competitor entries
    for (const c of competitors) {
      const saved = savedById[c.id];
      entries.push({
        entityId: c.id,
        entityType: "competitor",
        entityName: c.name,
        x: saved?.x ?? 50,
        y: saved?.y ?? 50,
        xAxisLabel,
        yAxisLabel,
      });
    }

    setPositions(entries);
    setDirty(new Set());
  }, [savedPositions, competitors, companyProfile]);

  const saveMutation = useMutation({
    mutationFn: async (entries: PositionEntry[]) => {
      await Promise.all(
        entries.map(async (entry) => {
          const res = await fetch("/api/positioning-map", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ ...entry, xAxisLabel, yAxisLabel }),
          });
          if (!res.ok) throw new Error("Failed to save position");
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/positioning-map"] });
      setDirty(new Set());
      toast({ title: "Positions saved", description: "Positioning map updated successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const toSave = dirty.size > 0
      ? positions.filter((p) => dirty.has(p.entityId))
      : positions;
    saveMutation.mutate(toSave.map((p) => ({ ...p, xAxisLabel, yAxisLabel })));
  };

  const handleAutoPosition = () => {
    if (positions.length === 0) return;
    const count = positions.length;
    const updated = positions.map((p, i) => {
      const angle = (2 * Math.PI * i) / count;
      const radius = 30 + ((i * 7) % 20);
      const cx = 50 + radius * Math.cos(angle);
      const cy = 50 + radius * Math.sin(angle);
      return { ...p, x: Math.min(95, Math.max(5, Math.round(cx))), y: Math.min(95, Math.max(5, Math.round(cy))) };
    });
    setPositions(updated);
    setDirty(new Set(updated.map((p) => p.entityId)));
  };

  const handleCoordChange = (entityId: string, axis: "x" | "y", value: string) => {
    if (value === "" || value === "-") return;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    const num = Math.min(100, Math.max(0, Math.round(parsed)));
    setPositions((prev) =>
      prev.map((p) => (p.entityId === entityId ? { ...p, [axis]: num } : p))
    );
    setDirty((prev) => new Set(prev).add(entityId));
  };

  const chartData = positions.map((p) => ({ ...p, x: p.x, y: p.y }));
  const baselineData = chartData.filter((p) => p.entityType === "baseline");
  const competitorData = chartData.filter((p) => p.entityType === "competitor");

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 rounded-lg">
              <Map className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Competitive Positioning Map</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Visualize where your company and competitors sit on any two dimensions.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" onClick={handleAutoPosition} disabled={positions.length === 0}>
              <Shuffle className="w-4 h-4 mr-2" />
              Auto-position
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending || positions.length === 0}>
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save positions
            </Button>
          </div>
        </div>

        {/* Axis Selectors */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configure Axes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 w-20">X Axis</span>
                <Select value={xAxisLabel} onValueChange={setXAxisLabel}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AXIS_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 w-20">Y Axis</span>
                <Select value={yAxisLabel} onValueChange={setYAxisLabel}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AXIS_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 ml-auto text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-violet-600 inline-block" />
                  Your Company
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
                  Competitor
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scatter Chart */}
        <Card>
          <CardContent className="pt-6">
            {loadingPositions ? (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                Loading map…
              </div>
            ) : positions.length === 0 ? (
              <div className="flex items-center justify-center h-96 text-gray-400 text-sm">
                No competitors found. Add competitors to populate the map.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={600}>
                <ScatterChart margin={{ top: 30, right: 40, bottom: 50, left: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, 100]}
                    tick={{ fontSize: 12 }}
                    tickCount={6}
                  >
                    <Label value={xAxisLabel} position="insideBottom" offset={-10} fontSize={13} fontWeight={600} fill="#374151" />
                  </XAxis>
                  <YAxis
                    type="number"
                    dataKey="y"
                    domain={[0, 100]}
                    tick={{ fontSize: 12 }}
                    tickCount={6}
                  >
                    <Label value={yAxisLabel} angle={-90} position="insideLeft" offset={15} fontSize={13} fontWeight={600} fill="#374151" />
                  </YAxis>
                  <ReferenceLine x={50} stroke="#e5e7eb" strokeDasharray="4 4" />
                  <ReferenceLine y={50} stroke="#e5e7eb" strokeDasharray="4 4" />
                  <Tooltip content={<CustomTooltip />} />
                  {baselineData.length > 0 && (
                    <Scatter
                      name="Your Company"
                      data={baselineData}
                      fill="#7c3aed"
                      shape={<CustomDot />}
                    />
                  )}
                  {competitorData.length > 0 && (
                    <Scatter
                      name="Competitors"
                      data={competitorData}
                      fill="#f59e0b"
                      shape={<CustomDot />}
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Editable Table */}
        {positions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Edit Positions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="text-left py-2 pr-4 font-medium">Entity</th>
                      <th className="text-left py-2 pr-4 font-medium">Type</th>
                      <th className="text-left py-2 pr-4 font-medium w-32">{xAxisLabel} (X)</th>
                      <th className="text-left py-2 pr-4 font-medium w-32">{yAxisLabel} (Y)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {positions.map((p) => (
                      <tr key={p.entityId} className={dirty.has(p.entityId) ? "bg-amber-50" : ""}>
                        <td className="py-2 pr-4 font-medium text-gray-900">{p.entityName}</td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant="outline"
                            className={
                              p.entityType === "baseline"
                                ? "border-violet-300 text-violet-700"
                                : "border-amber-300 text-amber-700"
                            }
                          >
                            {p.entityType === "baseline" ? "Your Company" : "Competitor"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(p.x)}
                            onChange={(e) => handleCoordChange(p.entityId, "x", e.target.value)}
                            className="w-24 h-8 text-center"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(p.y)}
                            onChange={(e) => handleCoordChange(p.entityId, "y", e.target.value)}
                            className="w-24 h-8 text-center"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dirty.size > 0 && (
                <p className="text-xs text-amber-600 mt-3">
                  {dirty.size} unsaved change{dirty.size !== 1 ? "s" : ""} — click "Save positions" to persist.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
