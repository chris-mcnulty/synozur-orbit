import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label as RechartsLabel } from "recharts";
import { Map, Wand2, Save, Loader2 } from "lucide-react";

const AXIS_OPTIONS = [
  "Market Presence",
  "Innovation",
  "Price",
  "Feature Breadth",
  "Brand Awareness",
  "Customer Focus",
];

interface PositionEntry {
  competitorId?: string;
  companyProfileId?: string;
  label: string;
  xAxis: string;
  yAxis: string;
  xValue: number;
  yValue: number;
}

function autoPosition(entries: PositionEntry[]): PositionEntry[] {
  // Simple auto-position: spread entries evenly with some randomness
  return entries.map((entry, i) => ({
    ...entry,
    xValue: Math.round(20 + (i * 60) / Math.max(entries.length - 1, 1) + (Math.random() * 15 - 7.5)),
    yValue: Math.round(20 + Math.random() * 60),
  }));
}

// Custom tooltip for the scatter chart
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold">{data.label}</p>
      <p className="text-muted-foreground">
        X: {data.xValue} / Y: {data.yValue}
      </p>
    </div>
  );
}

// Custom dot to show labels on chart
function CustomDot(props: any) {
  const { cx, cy, payload } = props;
  const isBaseline = !!payload.companyProfileId;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={isBaseline ? 8 : 6}
        fill={isBaseline ? "hsl(var(--primary))" : "hsl(var(--destructive))"}
        opacity={0.85}
        stroke="hsl(var(--background))"
        strokeWidth={2}
      />
      <text
        x={cx}
        y={cy - 12}
        textAnchor="middle"
        className="text-[10px] fill-foreground font-medium"
      >
        {payload.label?.length > 14 ? payload.label.slice(0, 12) + "..." : payload.label}
      </text>
    </g>
  );
}

export default function PositioningMapPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [xAxis, setXAxis] = useState("Market Presence");
  const [yAxis, setYAxis] = useState("Innovation");
  const [localPositions, setLocalPositions] = useState<PositionEntry[]>([]);
  const [dirty, setDirty] = useState(false);

  // Fetch saved positions
  const { data: posData, isLoading: posLoading } = useQuery({
    queryKey: ["/api/positioning-map"],
    queryFn: async () => {
      const res = await fetch("/api/positioning-map", { credentials: "include" });
      if (!res.ok) return { positions: [] };
      return res.json();
    },
  });

  // Fetch competitors + baseline for initial seeding
  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Initialize local positions from API data or seed from competitors
  useEffect(() => {
    if (posData?.positions?.length > 0) {
      setLocalPositions(
        posData.positions.map((p: any) => ({
          competitorId: p.competitorId,
          companyProfileId: p.companyProfileId,
          label: p.label,
          xAxis: p.xAxis,
          yAxis: p.yAxis,
          xValue: p.xValue,
          yValue: p.yValue,
        }))
      );
      if (posData.positions[0]?.xAxis) setXAxis(posData.positions[0].xAxis);
      if (posData.positions[0]?.yAxis) setYAxis(posData.positions[0].yAxis);
    } else if (competitors.length > 0 || companyProfile) {
      const seed: PositionEntry[] = [];
      if (companyProfile) {
        seed.push({
          companyProfileId: companyProfile.id,
          label: companyProfile.name || "Our Company",
          xAxis,
          yAxis,
          xValue: 50,
          yValue: 50,
        });
      }
      competitors.forEach((c: any) => {
        seed.push({
          competitorId: c.id,
          label: c.name,
          xAxis,
          yAxis,
          xValue: 30 + Math.round(Math.random() * 40),
          yValue: 30 + Math.round(Math.random() * 40),
        });
      });
      setLocalPositions(seed);
    }
  }, [posData, competitors, companyProfile]);

  const saveMutation = useMutation({
    mutationFn: async (positions: PositionEntry[]) => {
      const res = await fetch("/api/positioning-map", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions }),
      });
      if (!res.ok) throw new Error("Failed to save positions");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/positioning-map"] });
      setDirty(false);
      toast({ title: "Positions saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleAxisChange = (axis: "x" | "y", value: string) => {
    const updated = localPositions.map((p) => ({
      ...p,
      ...(axis === "x" ? { xAxis: value } : { yAxis: value }),
    }));
    setLocalPositions(updated);
    setDirty(true);
    if (axis === "x") setXAxis(value);
    else setYAxis(value);
  };

  const handleValueChange = (index: number, field: "xValue" | "yValue", value: number) => {
    const updated = [...localPositions];
    updated[index] = { ...updated[index], [field]: Math.max(0, Math.min(100, value)) };
    setLocalPositions(updated);
    setDirty(true);
  };

  const handleAutoPosition = () => {
    setLocalPositions((prev) => autoPosition(prev));
    setDirty(true);
  };

  const handleSave = () => {
    saveMutation.mutate(localPositions);
  };

  const chartData = localPositions.map((p) => ({
    ...p,
    x: p.xValue,
    y: p.yValue,
  }));

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Map className="w-6 h-6 text-primary" />
              Competitive Positioning Map
            </h1>
            <p className="text-muted-foreground mt-1">
              Visualize where you and your competitors stand across key dimensions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleAutoPosition}>
              <Wand2 className="w-4 h-4 mr-1.5" />
              Auto-position
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>

        {/* Axis selectors */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chart Axes</CardTitle>
            <CardDescription>Choose which dimensions to compare</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">X Axis</Label>
                <Select value={xAxis} onValueChange={(v) => handleAxisChange("x", v)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AXIS_OPTIONS.filter((o) => o !== yAxis).map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Y Axis</Label>
                <Select value={yAxis} onValueChange={(v) => handleAxisChange("y", v)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AXIS_OPTIONS.filter((o) => o !== xAxis).map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chart */}
        <Card>
          <CardContent className="pt-6">
            {posLoading ? (
              <div className="h-[450px] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-[450px] flex items-center justify-center text-muted-foreground">
                Add competitors to get started
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={450}>
                <ScatterChart margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" dataKey="x" domain={[0, 100]} tickCount={6}>
                    <RechartsLabel value={xAxis} offset={-15} position="insideBottom" />
                  </XAxis>
                  <YAxis type="number" dataKey="y" domain={[0, 100]} tickCount={6}>
                    <RechartsLabel value={yAxis} angle={-90} position="insideLeft" offset={10} />
                  </YAxis>
                  <Tooltip content={<CustomTooltip />} />
                  <Scatter
                    data={chartData}
                    shape={<CustomDot />}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Editable table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Position Values</CardTitle>
            <CardDescription>
              Adjust positions (0–100) for each entity. Higher = further right / top.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_100px_100px] gap-3 text-xs font-medium text-muted-foreground px-1">
                <span>Entity</span>
                <span>{xAxis}</span>
                <span>{yAxis}</span>
              </div>
              {localPositions.map((p, i) => (
                <div
                  key={p.competitorId || p.companyProfileId || i}
                  className="grid grid-cols-[1fr_100px_100px] gap-3 items-center"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{
                        backgroundColor: p.companyProfileId
                          ? "hsl(var(--primary))"
                          : "hsl(var(--destructive))",
                      }}
                    />
                    <span className="text-sm font-medium truncate">{p.label}</span>
                    {p.companyProfileId && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1">Baseline</Badge>
                    )}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={p.xValue}
                    onChange={(e) => handleValueChange(i, "xValue", parseInt(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={p.yValue}
                    onChange={(e) => handleValueChange(i, "yValue", parseInt(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
              ))}
              {localPositions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No competitors tracked yet. Add competitors from the Competitors page first.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
