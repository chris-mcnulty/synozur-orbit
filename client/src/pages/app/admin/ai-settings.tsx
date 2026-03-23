import React, { useState, useEffect } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Brain, Settings, Cpu, BarChart3, Bell, CheckCircle2, XCircle, Loader2, Save, RotateCcw, Zap, DollarSign, Activity, TrendingUp } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";

const CHART_COLORS = ['#810FFB', '#E60CB3', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];

interface ProviderStatus {
  key: string;
  name: string;
  label: string;
  available: boolean;
  models: string[];
  aoaiAvailable?: boolean;
  inferenceAvailable?: boolean;
}

interface ModelInfo {
  name: string;
  description: string;
  costTier: string;
  providers: string[];
  contextWindow: number;
  costPer1kPrompt: number;
  costPer1kCompletion: number;
  endpointType?: 'aoai' | 'inference';
}

interface FeatureAssignment {
  id: string;
  feature: string;
  provider: string;
  model: string;
  maxTokens: number | null;
  updatedAt: string;
}

interface AIConfig {
  id: string;
  defaultProvider: string;
  defaultModel: string;
  maxTokensPerRequest: number | null;
  monthlyTokenBudget: number | null;
  alertThresholds: number[] | null;
  alertEnabled: boolean | null;
}

interface AIOptions {
  providers: ProviderStatus[];
  models: Record<string, ModelInfo>;
  features: { key: string; label: string }[];
  modelsByProvider: Record<string, string[]>;
}

function costTierBadge(tier: string) {
  const colors: Record<string, string> = {
    free: "bg-green-500/10 text-green-500 border-green-500/20",
    low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    high: "bg-red-500/10 text-red-500 border-red-500/20",
  };
  return <Badge variant="outline" className={colors[tier] || ""}>{tier}</Badge>;
}

function ModelConfigTab({ config, options, onSave }: { config: AIConfig; options: AIOptions; onSave: (data: Partial<AIConfig>) => void }) {
  const [provider, setProvider] = useState(config.defaultProvider);
  const [model, setModel] = useState(config.defaultModel);
  const [maxTokens, setMaxTokens] = useState(config.maxTokensPerRequest?.toString() || "8192");

  const availableModels = options.modelsByProvider[provider] || [];

  useEffect(() => {
    if (!availableModels.includes(model) && availableModels.length > 0) {
      setModel(availableModels[0]);
    }
  }, [provider]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-default-model-config">Default Model Configuration</CardTitle>
          <CardDescription>Set the default AI provider and model used when no feature-specific assignment is configured.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Default Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger data-testid="select-default-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.providers.map(p => (
                    <SelectItem key={p.key} value={p.key} disabled={!p.available}>
                      <div className="flex items-center gap-2">
                        {p.available ? <CheckCircle2 size={14} className="text-green-500" /> : <XCircle size={14} className="text-muted-foreground" />}
                        {p.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger data-testid="select-default-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map(m => {
                    const info = options.models[m];
                    return (
                      <SelectItem key={m} value={m}>
                        <div className="flex items-center gap-2">
                          {info?.name || m}
                          {info && costTierBadge(info.costTier)}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {options.models[model] && (
                <p className="text-xs text-muted-foreground">{options.models[model].description}</p>
              )}
            </div>
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>Max Tokens Per Request</Label>
            <Input
              type="number"
              value={maxTokens}
              onChange={e => setMaxTokens(e.target.value)}
              data-testid="input-max-tokens"
            />
          </div>
          <Button
            onClick={() => onSave({ defaultProvider: provider, defaultModel: model, maxTokensPerRequest: parseInt(maxTokens) || 8192 })}
            data-testid="button-save-model-config"
          >
            <Save size={16} className="mr-2" />
            Save Default Configuration
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Available Models</CardTitle>
          <CardDescription>All models available across configured providers.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider(s)</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Cost Tier</TableHead>
                <TableHead>Context Window</TableHead>
                <TableHead>Cost / 1K tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(options.models).map(([key, info]) => (
                <TableRow key={key} data-testid={`row-model-${key}`}>
                  <TableCell>
                    <div>
                      <span className="font-medium">{info.name}</span>
                      <p className="text-xs text-muted-foreground">{info.description}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {info.providers.map(pk => {
                        const prov = options.providers.find(p => p.key === pk);
                        return <Badge key={pk} variant="secondary" className="text-xs">{prov?.label || pk}</Badge>;
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    {info.endpointType ? (
                      <Badge
                        variant="outline"
                        className={info.endpointType === 'aoai'
                          ? "text-xs bg-blue-500/10 text-blue-500 border-blue-500/20"
                          : "text-xs bg-purple-500/10 text-purple-500 border-purple-500/20"
                        }
                        data-testid={`badge-endpoint-${key}`}
                      >
                        {info.endpointType === 'aoai' ? 'AOAI' : 'Inference'}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{costTierBadge(info.costTier)}</TableCell>
                  <TableCell>{(info.contextWindow / 1000).toFixed(0)}K</TableCell>
                  <TableCell>
                    <span className="text-xs">In: ${info.costPer1kPrompt.toFixed(4)} / Out: ${info.costPer1kCompletion.toFixed(4)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureAssignmentsTab({ assignments, options, config, onSave }: {
  assignments: FeatureAssignment[];
  options: AIOptions;
  config: AIConfig;
  onSave: (assignments: Array<{ feature: string; provider: string; model: string }>) => void;
}) {
  const [localAssignments, setLocalAssignments] = useState<Record<string, { provider: string; model: string }>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const map: Record<string, { provider: string; model: string }> = {};
    for (const a of assignments) {
      map[a.feature] = { provider: a.provider, model: a.model };
    }
    setLocalAssignments(map);
    setDirty(false);
  }, [assignments]);

  const updateAssignment = (feature: string, field: "provider" | "model", value: string) => {
    setLocalAssignments(prev => {
      const current = prev[feature] || { provider: config.defaultProvider, model: config.defaultModel };
      const updated = { ...current, [field]: value };
      if (field === "provider") {
        const models = options.modelsByProvider[value] || [];
        if (!models.includes(updated.model) && models.length > 0) {
          updated.model = models[0];
        }
      }
      return { ...prev, [feature]: updated };
    });
    setDirty(true);
  };

  const clearAssignment = (feature: string) => {
    setLocalAssignments(prev => {
      const next = { ...prev };
      delete next[feature];
      return next;
    });
    setDirty(true);
  };

  const handleSave = () => {
    const toSave = Object.entries(localAssignments).map(([feature, { provider, model }]) => ({
      feature, provider, model,
    }));
    onSave(toSave);
    setDirty(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-feature-assignments">Per-Feature Model Assignments</CardTitle>
          <CardDescription>
            Assign a specific provider and model to each AI feature. Features without an assignment use the default ({options.providers.find(p => p.key === config.defaultProvider)?.label} / {options.models[config.defaultModel]?.name || config.defaultModel}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">Feature</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {options.features.map(f => {
                const assignment = localAssignments[f.key];
                const isDefault = !assignment;
                const currentProvider = assignment?.provider || config.defaultProvider;
                const currentModel = assignment?.model || config.defaultModel;
                const availableModels = options.modelsByProvider[currentProvider] || [];

                return (
                  <TableRow key={f.key} data-testid={`row-feature-${f.key}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{f.label}</span>
                        {isDefault && <Badge variant="outline" className="text-xs opacity-60">Default</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={currentProvider}
                        onValueChange={v => updateAssignment(f.key, "provider", v)}
                      >
                        <SelectTrigger className="w-[200px]" data-testid={`select-provider-${f.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.providers.map(p => (
                            <SelectItem key={p.key} value={p.key} disabled={!p.available}>
                              <div className="flex items-center gap-2">
                                {p.available ? <CheckCircle2 size={12} className="text-green-500" /> : <XCircle size={12} className="text-muted-foreground" />}
                                <span className="text-sm">{p.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={currentModel}
                        onValueChange={v => updateAssignment(f.key, "model", v)}
                      >
                        <SelectTrigger className="w-[180px]" data-testid={`select-model-${f.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableModels.map(m => {
                            const info = options.models[m];
                            return (
                              <SelectItem key={m} value={m}>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{info?.name || m}</span>
                                  {info && costTierBadge(info.costTier)}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => clearAssignment(f.key)}
                          data-testid={`button-reset-${f.key}`}
                        >
                          <RotateCcw size={14} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {dirty && (
            <div className="flex justify-end mt-4">
              <Button onClick={handleSave} data-testid="button-save-feature-assignments">
                <Save size={16} className="mr-2" />
                Save Feature Assignments
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderStatusTab({ options }: { options: AIOptions }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {options.providers.map(p => (
        <Card key={p.key} data-testid={`card-provider-${p.key}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{p.label}</CardTitle>
              {p.available ? (
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20" variant="outline">
                  <CheckCircle2 size={12} className="mr-1" /> Connected
                </Badge>
              ) : (
                <Badge className="bg-red-500/10 text-red-500 border-red-500/20" variant="outline">
                  <XCircle size={12} className="mr-1" /> Not Configured
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Available Models</p>
                <div className="flex flex-wrap gap-2">
                  {p.models.map(m => {
                    const info = options.models[m];
                    return (
                      <Badge key={m} variant="secondary" className="text-xs">
                        {info?.name || m}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              {p.key === "azure_foundry" && (
                <div className="space-y-2 mt-3">
                  <div className="flex items-center gap-2">
                    {p.aoaiAvailable ? (
                      <CheckCircle2 size={12} className="text-green-500" />
                    ) : (
                      <XCircle size={12} className="text-muted-foreground" />
                    )}
                    <span className="text-xs text-muted-foreground">AOAI Endpoint (OpenAI models)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.inferenceAvailable ? (
                      <CheckCircle2 size={12} className="text-green-500" />
                    ) : (
                      <XCircle size={12} className="text-muted-foreground" />
                    )}
                    <span className="text-xs text-muted-foreground">Project Endpoint (Inference models)</span>
                  </div>
                  {!p.available && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Configure AZURE_FOUNDRY_OPENAI_ENDPOINT, AZURE_FOUNDRY_PROJECT_ENDPOINT, and AZURE_FOUNDRY_API_KEY environment variables to enable this provider.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function UsageStatsTab() {
  const [days, setDays] = useState(30);
  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/admin/ai-usage/stats", days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/ai-usage/stats?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin mr-2" /> Loading usage data...</div>;
  }

  if (!stats) return null;

  const totals = stats.totals;
  const totalCost = parseFloat(totals.total_cost || "0");

  const dailyData = (stats.dailyTrend || []).map((d: any) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    calls: parseInt(d.calls),
    tokens: parseInt(d.tokens),
    cost: parseFloat(d.cost || "0"),
  }));

  const byFeatureData = (stats.byFeature || []).map((f: any, i: number) => ({
    name: f.operation,
    calls: parseInt(f.calls),
    cost: parseFloat(f.cost || "0"),
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const byProviderData = (stats.byProvider || []).map((p: any, i: number) => ({
    name: p.provider,
    calls: parseInt(p.calls),
    tokens: parseInt(p.tokens),
    cost: parseFloat(p.cost || "0"),
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[7, 14, 30, 90].map(d => (
            <Button key={d} variant={days === d ? "default" : "outline"} size="sm" onClick={() => setDays(d)} data-testid={`button-period-${d}`}>
              {d}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap size={20} className="text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-calls">{parseInt(totals.total_calls || "0").toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total API Calls</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Activity size={20} className="text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{parseInt(totals.total_tokens || "0").toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Tokens</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <DollarSign size={20} className="text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-cost">${totalCost < 1 ? totalCost.toFixed(4) : totalCost.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Estimated Cost</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <XCircle size={20} className="text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{parseInt(totals.total_errors || "0")}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily API Calls</CardTitle>
          </CardHeader>
          <CardContent>
            {dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--card-foreground))" }} />
                  <Bar dataKey="calls" fill="#810FFB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No usage data for this period</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage by Provider</CardTitle>
          </CardHeader>
          <CardContent>
            {byProviderData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={byProviderData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="calls"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {byProviderData.map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--card-foreground))" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No usage data</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by Feature</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Avg Duration</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(stats.byFeature || []).map((f: any) => (
                <TableRow key={f.operation}>
                  <TableCell className="font-medium text-sm">{f.operation}</TableCell>
                  <TableCell className="text-right">{parseInt(f.calls).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{parseInt(f.tokens || "0").toLocaleString()}</TableCell>
                  <TableCell className="text-right">{f.avg_duration_ms ? `${Math.round(parseFloat(f.avg_duration_ms))}ms` : "—"}</TableCell>
                  <TableCell className="text-right">${parseFloat(f.cost || "0").toFixed(4)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by Model</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(stats.byModel || []).map((m: any, i: number) => (
                <TableRow key={`${m.model}-${m.provider}`}>
                  <TableCell className="font-medium text-sm">{m.model}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{m.provider}</Badge></TableCell>
                  <TableCell className="text-right">{parseInt(m.calls).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{parseInt(m.tokens || "0").toLocaleString()}</TableCell>
                  <TableCell className="text-right">${parseFloat(m.cost || "0").toFixed(4)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function BudgetAlertsTab({ config, onSave }: { config: AIConfig; onSave: (data: Partial<AIConfig>) => void }) {
  const [budget, setBudget] = useState(config.monthlyTokenBudget?.toString() || "");
  const [alertEnabled, setAlertEnabled] = useState(config.alertEnabled ?? true);
  const [thresholds, setThresholds] = useState((config.alertThresholds || [75, 90, 100]).join(", "));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-budget-alerts">Budget & Alert Configuration</CardTitle>
          <CardDescription>Set monthly token budgets and alert thresholds to monitor AI spending.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Monthly Token Budget</Label>
              <Input
                type="number"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                placeholder="e.g., 1000000 (leave empty for unlimited)"
                data-testid="input-monthly-budget"
              />
              <p className="text-xs text-muted-foreground">Total tokens allowed per calendar month. Leave empty for unlimited.</p>
            </div>
            <div className="space-y-2">
              <Label>Alert Thresholds (%)</Label>
              <Input
                value={thresholds}
                onChange={e => setThresholds(e.target.value)}
                placeholder="75, 90, 100"
                data-testid="input-alert-thresholds"
              />
              <p className="text-xs text-muted-foreground">Comma-separated percentages. Alerts fire when usage reaches each threshold.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={alertEnabled}
              onCheckedChange={setAlertEnabled}
              data-testid="switch-alerts-enabled"
            />
            <Label>Enable budget alerts</Label>
          </div>
          <Button
            onClick={() => {
              const parsed = thresholds.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
              onSave({
                monthlyTokenBudget: budget ? parseInt(budget) : null,
                alertEnabled,
                alertThresholds: parsed.length > 0 ? parsed : [75, 90, 100],
              });
            }}
            data-testid="button-save-budget"
          >
            <Save size={16} className="mr-2" />
            Save Budget Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AISettingsPage() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading } = useQuery<AIConfig>({
    queryKey: ["/api/admin/ai-config"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai-config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
  });

  const { data: options, isLoading: optionsLoading } = useQuery<AIOptions>({
    queryKey: ["/api/admin/ai-config/options"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai-config/options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load options");
      return res.json();
    },
  });

  const { data: assignments = [] } = useQuery<FeatureAssignment[]>({
    queryKey: ["/api/admin/ai-config/feature-assignments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai-config/feature-assignments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load assignments");
      return res.json();
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (data: Partial<AIConfig>) => {
      const res = await fetch("/api/admin/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-config"] });
    },
  });

  const saveAssignmentsMutation = useMutation({
    mutationFn: async (data: Array<{ feature: string; provider: string; model: string }>) => {
      const res = await fetch("/api/admin/ai-config/feature-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ assignments: data }),
      });
      if (!res.ok) throw new Error("Failed to save assignments");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-config/feature-assignments"] });
    },
  });

  if (user?.role !== "Global Admin") {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Access denied — Global Admin only</p>
        </div>
      </AppLayout>
    );
  }

  if (configLoading || optionsLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="animate-spin mr-2" /> Loading AI settings...
        </div>
      </AppLayout>
    );
  }

  if (!config || !options) return null;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="page-header-gradient-bar rounded-t-lg px-6 py-5 bg-card mb-6">
            <div className="flex items-center gap-3 mb-1">
              <Brain size={24} className="text-primary" />
              <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Model Management</h1>
            </div>
            <p className="text-sm text-muted-foreground">Configure AI providers, assign models to features, and monitor usage across the platform.</p>
          </div>

          <Tabs defaultValue="model-config">
            <TabsList className="mb-6 grid grid-cols-5 w-full max-w-3xl" data-testid="tabs-ai-settings">
              <TabsTrigger value="model-config" data-testid="tab-model-config">
                <Settings size={14} className="mr-1.5" /> Model Config
              </TabsTrigger>
              <TabsTrigger value="feature-assignments" data-testid="tab-feature-assignments">
                <Cpu size={14} className="mr-1.5" /> Features
              </TabsTrigger>
              <TabsTrigger value="provider-status" data-testid="tab-provider-status">
                <Zap size={14} className="mr-1.5" /> Providers
              </TabsTrigger>
              <TabsTrigger value="usage" data-testid="tab-usage">
                <BarChart3 size={14} className="mr-1.5" /> Usage
              </TabsTrigger>
              <TabsTrigger value="budget" data-testid="tab-budget">
                <Bell size={14} className="mr-1.5" /> Budget
              </TabsTrigger>
            </TabsList>

            <TabsContent value="model-config">
              <ModelConfigTab config={config} options={options} onSave={(data) => saveConfigMutation.mutate(data)} />
            </TabsContent>

            <TabsContent value="feature-assignments">
              <FeatureAssignmentsTab
                assignments={assignments}
                options={options}
                config={config}
                onSave={(data) => saveAssignmentsMutation.mutate(data)}
              />
            </TabsContent>

            <TabsContent value="provider-status">
              <ProviderStatusTab options={options} />
            </TabsContent>

            <TabsContent value="usage">
              <UsageStatsTab />
            </TabsContent>

            <TabsContent value="budget">
              <BudgetAlertsTab config={config} onSave={(data) => saveConfigMutation.mutate(data)} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
