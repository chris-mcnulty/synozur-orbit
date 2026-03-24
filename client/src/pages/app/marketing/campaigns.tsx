import { useState, useMemo, useEffect, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutList, Plus, ArrowRight, Lock, Calendar, ChevronRight, ChevronLeft, Check, Copy, Search, Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useSearch } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Package } from "lucide-react";
import { format, addDays } from "date-fns";

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  numberOfDays?: number;
  includeSaturday?: boolean;
  includeSunday?: boolean;
  productIds?: string[];
  intelligenceBriefingId?: string;
  marketingTaskId?: string;
  createdAt: string;
}

interface IntelligenceBriefingSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  briefingData?: { periodLabel?: string };
  createdAt: string;
}

interface MarketProduct {
  id: string;
  name: string;
  isBaseline: boolean;
}

interface ContentAsset {
  id: string;
  title: string;
  description?: string;
  leadImageUrl?: string;
  categoryId?: string;
  status?: string;
  createdAt?: string;
}

interface ContentCategory {
  id: string;
  name: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  active: "default",
  completed: "outline",
  archived: "destructive",
  deleted: "destructive",
};

const STEPS = ["Details", "Assets", "Accounts", "Schedule"];

function calculateEndDate(startDate: string, numberOfDays: number, includeSat: boolean, includeSun: boolean): Date {
  const start = new Date(startDate);
  let daysAdded = 0;
  let current = new Date(start);
  while (daysAdded < numberOfDays) {
    current = addDays(current, 1);
    const dow = current.getDay();
    if (dow === 0 && !includeSun) continue;
    if (dow === 6 && !includeSat) continue;
    daysAdded++;
  }
  return current;
}

export default function CampaignsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const preselectedAssetId = params.get("preselect");
  const preselectedBriefingId = params.get("briefingId") || "";
  const preselectedTaskId = params.get("taskId") || "";
  const prefilledName = params.get("name") ? decodeURIComponent(params.get("name")!) : "";
  const prefilledDescription = params.get("description") ? decodeURIComponent(params.get("description")!) : "";

  const isInstant = !!preselectedAssetId;
  const [addOpen, setAddOpen] = useState(isInstant || !!(preselectedBriefingId || preselectedTaskId));
  const [step, setStep] = useState(0);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<string>("all");
  const [assetDateRange, setAssetDateRange] = useState<string>("all");
  const [form, setForm] = useState({
    name: prefilledName,
    description: prefilledDescription,
    selectedAssetIds: preselectedAssetId ? [preselectedAssetId] : [] as string[],
    selectedSocialIds: [] as string[],
    selectedProductIds: [] as string[],
    intelligenceBriefingId: preselectedBriefingId,
    marketingTaskId: preselectedTaskId,
    startDate: format(new Date(), "yyyy-MM-dd"),
    numberOfDays: 7,
    includeSaturday: false,
    includeSunday: false,
  });

  const resetForm = () => {
    setForm({
      name: "", description: "",
      selectedAssetIds: preselectedAssetId ? [preselectedAssetId] : [],
      selectedSocialIds: [],
      selectedProductIds: [],
      intelligenceBriefingId: "",
      marketingTaskId: "",
      startDate: format(new Date(), "yyyy-MM-dd"),
      numberOfDays: 7, includeSaturday: false, includeSunday: false,
    });
    setStep(0);
    setAssetSearch("");
    setAssetCategoryFilter("all");
    setAssetDateRange("all");
  };

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.campaigns === true;

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
    queryFn: async () => {
      const r = await fetch("/api/campaigns", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: allAssets = [] } = useQuery<ContentAsset[]>({
    queryKey: ["/api/content-assets"],
    queryFn: async () => {
      const r = await fetch("/api/content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: categories = [] } = useQuery<ContentCategory[]>({
    queryKey: ["/api/content-categories"],
    queryFn: async () => {
      const r = await fetch("/api/content-categories", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const activeAssets = useMemo(() => allAssets.filter(a => a.status !== "archived"), [allAssets]);

  const filteredAssets = useMemo(() => {
    let list = activeAssets;
    if (assetCategoryFilter !== "all") {
      list = list.filter(a => a.categoryId === assetCategoryFilter);
    }
    if (assetDateRange !== "all") {
      const now = new Date();
      const cutoff = new Date(now);
      if (assetDateRange === "7d") cutoff.setDate(now.getDate() - 7);
      else if (assetDateRange === "30d") cutoff.setDate(now.getDate() - 30);
      else if (assetDateRange === "90d") cutoff.setDate(now.getDate() - 90);
      else if (assetDateRange === "1y") cutoff.setFullYear(now.getFullYear() - 1);
      list = list.filter(a => a.createdAt && new Date(a.createdAt) >= cutoff);
    }
    if (assetSearch.trim()) {
      const q = assetSearch.toLowerCase();
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeAssets, assetSearch, assetCategoryFilter, assetDateRange]);

  const categoryName = (id?: string) => categories.find(c => c.id === id)?.name;

  const instantNameSet = useRef(false);
  useEffect(() => {
    if (isInstant && preselectedAssetId && allAssets.length > 0 && !instantNameSet.current) {
      const asset = allAssets.find(a => a.id === preselectedAssetId);
      if (asset) {
        instantNameSet.current = true;
        setForm(f => ({ ...f, name: `Campaign: ${asset.title}` }));
      }
    }
  }, [isInstant, preselectedAssetId, allAssets]);

  const { data: allSocialAccounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: marketProducts = [] } = useQuery<MarketProduct[]>({
    queryKey: ["/api/marketing/products"],
    queryFn: async () => {
      const r = await fetch("/api/marketing/products", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: briefings = [] } = useQuery<IntelligenceBriefingSummary[]>({
    queryKey: ["/api/intelligence-briefings"],
    queryFn: async () => {
      const r = await fetch("/api/intelligence-briefings?limit=20", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const toggleProduct = (id: string) => {
    setForm(f => ({
      ...f,
      selectedProductIds: f.selectedProductIds.includes(id)
        ? f.selectedProductIds.filter(x => x !== id)
        : [...f.selectedProductIds, id],
    }));
  };

  const productName = (id: string) => marketProducts.find(p => p.id === id)?.name;

  const computedEndDate = useMemo(() => {
    if (!form.startDate || !form.numberOfDays) return null;
    return calculateEndDate(form.startDate, form.numberOfDays, form.includeSaturday, form.includeSunday);
  }, [form.startDate, form.numberOfDays, form.includeSaturday, form.includeSunday]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const endDate = computedEndDate ? computedEndDate.toISOString() : undefined;
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
          endDate,
          numberOfDays: form.numberOfDays,
          includeSaturday: form.includeSaturday,
          includeSunday: form.includeSunday,
          assetIds: form.selectedAssetIds,
          socialAccountIds: form.selectedSocialIds,
          productIds: form.selectedProductIds,
          intelligenceBriefingId: form.intelligenceBriefingId || undefined,
          marketingTaskId: form.marketingTaskId || undefined,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        let msg = "Campaign creation failed";
        try { msg = JSON.parse(text).error || msg; } catch { msg = text || msg; }
        throw new Error(msg);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setAddOpen(false);
      resetForm();
      toast({ title: "Campaign created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      const r = await fetch(`/api/campaigns/${campaignId}/duplicate`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign duplicated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleAsset = (id: string) => {
    setForm(f => ({
      ...f,
      selectedAssetIds: f.selectedAssetIds.includes(id)
        ? f.selectedAssetIds.filter(a => a !== id)
        : [...f.selectedAssetIds, id],
    }));
  };

  const toggleSocial = (id: string) => {
    setForm(f => ({
      ...f,
      selectedSocialIds: f.selectedSocialIds.includes(id)
        ? f.selectedSocialIds.filter(a => a !== id)
        : [...f.selectedSocialIds, id],
    }));
  };

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Campaigns</CardTitle>
              <CardDescription>Available on the Enterprise plan. Organize assets and social accounts into campaigns and generate AI-powered posts and emails.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Campaigns">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-campaigns-title">
              <LayoutList className="w-6 h-6" /> Campaigns
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Coordinate assets and social accounts. Generate AI-powered posts and emails per campaign.</p>
          </div>
          <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-campaign"><Plus className="w-4 h-4 mr-2" />{isInstant ? "Instant Campaign" : "New Campaign"}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
              <DialogHeader>
                <DialogTitle>{isInstant ? "Instant Campaign" : "New Campaign"}</DialogTitle>
              </DialogHeader>

              <div className="flex items-center gap-1 mb-4">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex items-center gap-1">
                    <button
                      onClick={() => setStep(i)}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        i === step ? "bg-primary text-primary-foreground" :
                        i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                      data-testid={`step-${s.toLowerCase()}`}
                    >
                      {i < step ? <Check className="w-3 h-3 inline mr-0.5" /> : null}{s}
                    </button>
                    {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  </div>
                ))}
              </div>

              {step === 0 && (
                <div className="space-y-4">
                  <div>
                    <Label>Campaign Name *</Label>
                    <Input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Q2 2026 Product Launch"
                      data-testid="input-campaign-name"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Campaign goals and context..."
                      rows={3}
                      data-testid="input-campaign-description"
                    />
                  </div>
                  <div>
                    <Label>Products</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-campaign-select-products">
                          {form.selectedProductIds.length ? `${form.selectedProductIds.length} selected` : "Select products"}
                          <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                        {marketProducts.length === 0 ? (
                          <div className="px-2 py-1 text-sm text-muted-foreground">No products in this market</div>
                        ) : marketProducts.map(p => (
                          <DropdownMenuCheckboxItem
                            key={p.id}
                            checked={form.selectedProductIds.includes(p.id)}
                            onCheckedChange={() => toggleProduct(p.id)}
                            data-testid={`checkbox-campaign-product-${p.id}`}
                          >
                            {p.name}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div>
                    <Label className="flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5" /> Market Intelligence
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Select
                      value={form.intelligenceBriefingId || "none"}
                      onValueChange={v => setForm(f => ({ ...f, intelligenceBriefingId: v === "none" ? "" : v }))}
                    >
                      <SelectTrigger data-testid="select-briefing">
                        <SelectValue placeholder="Link a briefing to enrich AI copy..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No briefing</SelectItem>
                        {briefings.map(b => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.briefingData?.periodLabel || `Briefing ${new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">Competitive context will enrich AI-generated posts and emails for this campaign.</p>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!form.name.trim()}
                    onClick={() => setStep(1)}
                    data-testid="button-next-to-assets"
                  >
                    Next: Select Assets <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Select content assets to include in this campaign.</p>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={assetSearch}
                      onChange={e => setAssetSearch(e.target.value)}
                      placeholder="Search assets..."
                      className="pl-8 h-9"
                      data-testid="input-asset-search"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={assetCategoryFilter}
                      onChange={e => setAssetCategoryFilter(e.target.value)}
                      className="h-8 rounded-md border bg-background px-2 text-xs flex-1"
                      data-testid="select-asset-category-filter"
                    >
                      <option value="all">All Categories</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      value={assetDateRange}
                      onChange={e => setAssetDateRange(e.target.value)}
                      className="h-8 rounded-md border bg-background px-2 text-xs flex-1"
                      data-testid="select-asset-date-range"
                    >
                      <option value="all">Any Date</option>
                      <option value="7d">Last 7 Days</option>
                      <option value="30d">Last 30 Days</option>
                      <option value="90d">Last 90 Days</option>
                      <option value="1y">Last Year</option>
                    </select>
                  </div>
                  {activeAssets.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No content assets available. Add assets in the Content Library first.</p>
                  ) : filteredAssets.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No assets match your filters.</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
                      {filteredAssets.map(asset => (
                        <label
                          key={asset.id}
                          className={`flex items-center gap-2 px-2 py-2 hover:bg-muted/50 cursor-pointer transition-colors ${
                            form.selectedAssetIds.includes(asset.id) ? "bg-primary/5" : ""
                          }`}
                          data-testid={`checkbox-asset-${asset.id}`}
                        >
                          <Checkbox
                            checked={form.selectedAssetIds.includes(asset.id)}
                            onCheckedChange={() => toggleAsset(asset.id)}
                            className="shrink-0"
                          />
                          {asset.leadImageUrl && (
                            <img src={asset.leadImageUrl} alt="" className="w-12 h-8 rounded object-cover shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight truncate">{asset.title}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {categoryName(asset.categoryId) && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{categoryName(asset.categoryId)}</span>
                              )}
                              {asset.createdAt && (
                                <span className="text-[10px] text-muted-foreground">{format(new Date(asset.createdAt), "MMM d, yyyy")}</span>
                              )}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {form.selectedAssetIds.length} selected{filteredAssets.length !== activeAssets.length ? ` · ${filteredAssets.length} of ${activeAssets.length} shown` : ` of ${activeAssets.length}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep(0)} className="flex-1" data-testid="button-back-to-details">
                      <ChevronLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button onClick={() => setStep(2)} className="flex-1" data-testid="button-next-to-accounts">
                      Next: Social Accounts <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Select social accounts for post generation.</p>
                  {allSocialAccounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No social accounts available. Add accounts in Social Accounts first.</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto space-y-2 border rounded-lg p-3">
                      {allSocialAccounts.map(account => (
                        <label
                          key={account.id}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                          data-testid={`checkbox-social-${account.id}`}
                        >
                          <Checkbox
                            checked={form.selectedSocialIds.includes(account.id)}
                            onCheckedChange={() => toggleSocial(account.id)}
                          />
                          <Badge variant="outline">{account.platform}</Badge>
                          <span className="text-sm">{account.accountName}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{form.selectedSocialIds.length} account(s) selected</p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep(1)} className="flex-1" data-testid="button-back-to-assets">
                      <ChevronLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button onClick={() => setStep(3)} className="flex-1" data-testid="button-next-to-schedule">
                      Next: Schedule <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={form.startDate}
                        onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                        data-testid="input-start-date"
                      />
                    </div>
                    <div>
                      <Label>Days to Run</Label>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={form.numberOfDays}
                        onChange={e => setForm(f => ({ ...f, numberOfDays: parseInt(e.target.value) || 1 }))}
                        data-testid="input-number-of-days"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.includeSaturday}
                        onCheckedChange={v => setForm(f => ({ ...f, includeSaturday: v }))}
                        data-testid="switch-include-saturday"
                      />
                      <Label className="text-sm">Include Saturday</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.includeSunday}
                        onCheckedChange={v => setForm(f => ({ ...f, includeSunday: v }))}
                        data-testid="switch-include-sunday"
                      />
                      <Label className="text-sm">Include Sunday</Label>
                    </div>
                  </div>
                  {computedEndDate && (
                    <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">
                        End date: <strong>{format(computedEndDate, "MMM d, yyyy")}</strong>
                      </span>
                    </div>
                  )}

                  <div className="border rounded-lg p-3 bg-muted/30 space-y-1">
                    <p className="text-xs font-medium">Summary</p>
                    <p className="text-xs text-muted-foreground">{form.selectedAssetIds.length} asset(s), {form.selectedSocialIds.length} social account(s)</p>
                    <p className="text-xs text-muted-foreground">{form.numberOfDays} days, {form.includeSaturday ? "incl." : "excl."} Saturday, {form.includeSunday ? "incl." : "excl."} Sunday</p>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep(2)} className="flex-1" data-testid="button-back-to-accounts">
                      <ChevronLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={!form.name.trim() || createMutation.isPending}
                      onClick={() => createMutation.mutate()}
                      data-testid="button-create-campaign"
                    >
                      {createMutation.isPending ? "Creating..." : "Create Campaign"}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : campaigns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty-campaigns">
              No campaigns yet. Create your first campaign to start generating content.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.map(c => (
              <Card key={c.id} className="hover:shadow-md transition-shadow" data-testid={`card-campaign-${c.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{c.name}</CardTitle>
                    <Badge variant={STATUS_COLORS[c.status] as any ?? "secondary"} className="shrink-0 capitalize">
                      {c.status}
                    </Badge>
                  </div>
                  {c.description && <CardDescription className="line-clamp-2">{c.description}</CardDescription>}
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {(c.productIds?.length || c.intelligenceBriefingId) && (
                    <div className="flex flex-wrap gap-1" data-testid={`campaign-products-${c.id}`}>
                      {c.productIds?.map(pid => {
                        const name = productName(pid);
                        return name ? (
                          <Badge key={pid} variant="outline" className="text-[10px] gap-1">
                            <Package className="w-2.5 h-2.5" />{name}
                          </Badge>
                        ) : null;
                      })}
                      {c.intelligenceBriefingId && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-blue-600 border-blue-200">
                          <Brain className="w-2.5 h-2.5" />Intel
                        </Badge>
                      )}
                    </div>
                  )}
                  {c.startDate && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(c.startDate), "MMM d")}
                      {c.endDate && <> — {format(new Date(c.endDate), "MMM d, yyyy")}</>}
                      {c.numberOfDays && <span className="ml-1">({c.numberOfDays}d)</span>}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Created {format(new Date(c.createdAt), "MMM d, yyyy")}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={(e) => { e.preventDefault(); duplicateMutation.mutate(c.id); }}
                        data-testid={`button-duplicate-campaign-${c.id}`}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Link href={`/app/marketing/campaigns/${c.id}`}>
                        <Button variant="ghost" size="sm" className="gap-1" data-testid={`button-open-campaign-${c.id}`}>
                          Open <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
