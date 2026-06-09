import { useState, useEffect, useRef } from "react";
import { OptimizedThumbnail } from "@/components/ui/optimized-thumbnail";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { PaginationFooter, type PaginatedEnvelope, usePersistedPageSize } from "@/components/ui/pagination-footer";
import {
  Library, Plus, Search, ExternalLink, Trash2, Lock, Globe, Loader2, AlertTriangle,
  ImageIcon, Sparkles, Tag, Filter, Settings, ChevronDown, X, Megaphone,
  Download, Upload, LayoutGrid, List, RefreshCw, Mail, Package, Link, FileText,
  Archive, RotateCcw
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportContentAssetsToCSV, parseCSV } from "@/lib/csv-export";
import { ContentTableSkeleton, ContentCardGridSkeleton } from "@/components/ui/skeletons";

interface ContentAsset {
  id: string;
  title: string;
  description?: string;
  url?: string;
  content?: string;
  aiSummary?: string;
  leadImageUrl?: string;
  extractionStatus?: string;
  fileType?: string;
  categoryId?: string;
  productIds?: string[];
  assetType?: string;
  solutionAreaIds?: string[];
  tags?: { seasons?: string[]; locations?: string[]; topics?: string[] };
  status: string;
  capturedViaExtension: boolean;
  createdAt: string;
}

interface SolutionArea {
  id: string;
  name: string;
  color?: string;
}

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  isBaseline: boolean;
}

interface ExtractionResult {
  title: string;
  description: string;
  content: string;
  leadImageUrl: string | null;
  aiSummary: string | null;
  siteName: string | null;
}

const SEASON_OPTIONS = [
  "Spring", "Summer", "Fall", "Winter", "Q1", "Q2", "Q3", "Q4",
  "Holiday", "Back to School", "Year End",
];

const TOPIC_OPTIONS = [
  "Modern Workplace", "Digital Transformation", "Cloud", "Security",
  "AI & Machine Learning", "Collaboration", "Productivity", "Remote Work",
  "Sustainability", "Innovation", "Leadership", "Customer Success",
];

const ASSET_TYPE_LABELS: Record<string, string> = {
  workshop: "Workshop",
  case_study: "Case Study",
  app: "App",
  model: "Model",
  blog_post: "Blog Post",
  whitepaper: "Whitepaper",
  video: "Video",
  other: "Other",
};

export default function ContentLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [assetTypeFilter, setAssetTypeFilter] = useState<string>("all");
  const [solutionAreaFilter, setSolutionAreaFilter] = useState<string>("all");
  const [statusTab, setStatusTab] = useState<string>("active");
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [detailAsset, setDetailAsset] = useState<ContentAsset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "", description: "", url: "", content: "", leadImageUrl: "",
    categoryId: "", productIds: [] as string[],
    tags: { seasons: [] as string[], topics: [] as string[] },
    aiSummary: "", assetType: "other", solutionAreaIds: [] as string[],
  });
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkQueuedCount, setBulkQueuedCount] = useState(0);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showBrandImagePicker, setShowBrandImagePicker] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  const [urlInput, setUrlInput] = useState("");
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [formStep, setFormStep] = useState<"url" | "review">("url");
  const [duplicateAsset, setDuplicateAsset] = useState<ContentAsset | null>(null);

  const normalizeUrl = (u: string) => {
    try {
      const url = new URL(u.trim().toLowerCase());
      return url.origin + url.pathname.replace(/\/+$/, "");
    } catch { return u.trim().toLowerCase().replace(/\/+$/, ""); }
  };

  const checkDuplicateUrl = (url: string): ContentAsset | null => {
    if (!url.trim()) return null;
    const norm = normalizeUrl(url);
    return assets.find(a => a.url && normalizeUrl(a.url) === norm) || null;
  };

  const [form, setForm] = useState({
    title: "", description: "", url: "", content: "", aiSummary: "",
    leadImageUrl: "", categoryId: "", productIds: [] as string[],
    tags: { seasons: [] as string[], topics: [] as string[] },
    assetType: "other", solutionAreaIds: [] as string[],
  });

  const resetForm = () => {
    setForm({
      title: "", description: "", url: "", content: "", aiSummary: "",
      leadImageUrl: "", categoryId: "", productIds: [],
      tags: { seasons: [], topics: [] },
      assetType: "other", solutionAreaIds: [],
    });
    setUrlInput("");
    setExtractionResult(null);
    setFormStep("url");
  };

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.contentLibrary === true;

  const [assetPage, setAssetPage] = useState(1);
  const [ASSETS_PAGE_SIZE, setAssetsPageSize] = usePersistedPageSize("content-library");
  const debouncedAssetSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    setAssetPage(1);
  }, [debouncedAssetSearch, statusTab, ASSETS_PAGE_SIZE, categoryFilter, sourceFilter, assetTypeFilter, solutionAreaFilter]);

  const serverStatusParam = statusTab === "archived" ? "archived" : undefined;
  const serverCategoryParam = categoryFilter === "all" ? undefined : categoryFilter;
  const serverSourceParam = sourceFilter === "all" ? undefined : sourceFilter;
  const serverAssetTypeParam = assetTypeFilter === "all" ? undefined : assetTypeFilter;
  const serverSolutionAreaParam = solutionAreaFilter === "all" ? undefined : solutionAreaFilter;

  const { data: assetsPage, isLoading } = useQuery<PaginatedEnvelope<ContentAsset>>({
    queryKey: [
      "/api/content-assets",
      "paginated",
      { page: assetPage, pageSize: ASSETS_PAGE_SIZE, q: debouncedAssetSearch, status: serverStatusParam, categoryId: serverCategoryParam, source: serverSourceParam, assetType: serverAssetTypeParam, solutionAreaId: serverSolutionAreaParam },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(assetPage), pageSize: String(ASSETS_PAGE_SIZE) });
      if (debouncedAssetSearch) params.set("q", debouncedAssetSearch);
      if (serverStatusParam) params.set("status", serverStatusParam);
      if (serverCategoryParam) params.set("categoryId", serverCategoryParam);
      if (serverSourceParam) params.set("source", serverSourceParam);
      if (serverAssetTypeParam) params.set("assetType", serverAssetTypeParam);
      if (serverSolutionAreaParam) params.set("solutionAreaId", serverSolutionAreaParam);
      const r = await fetch(`/api/content-assets?${params.toString()}`, { credentials: "include" });
      if (!r.ok) return { items: [], total: 0, hasMore: false, page: assetPage, pageSize: ASSETS_PAGE_SIZE };
      return r.json();
    },
    enabled: isAllowed,
    placeholderData: (prev) => prev,
  });

  const assets: ContentAsset[] = assetsPage?.items ?? [];
  const assetsTotal = assetsPage?.total ?? 0;
  const assetsHasMore = assetsPage?.hasMore ?? false;

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/content-categories"],
    queryFn: async () => {
      const r = await fetch("/api/content-categories", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: marketProducts = [] } = useQuery<Product[]>({
    queryKey: ["/api/marketing/products"],
    queryFn: async () => {
      const r = await fetch("/api/marketing/products", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: solutionAreas = [] } = useQuery<SolutionArea[]>({
    queryKey: ["/api/solution-areas"],
    queryFn: async () => {
      const r = await fetch("/api/solution-areas", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  interface BrandAsset { id: string; name: string; fileUrl: string | null; url: string | null; fileType: string | null; }
  const { data: brandAssets = [] } = useQuery<BrandAsset[]>({
    queryKey: ["/api/brand-assets"],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed && showBrandImagePicker,
  });
  const brandImages = brandAssets.filter(ba => {
    const url = ba.fileUrl || ba.url || "";
    return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url) || ba.fileType?.startsWith("image/");
  });

  const { data: suggestions = [] } = useQuery<any[]>({
    queryKey: ["/api/suggested-content-assets"],
    queryFn: async () => {
      const r = await fetch("/api/suggested-content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const dismissSuggestion = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/suggested-content-assets/${id}/dismiss`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/suggested-content-assets"] }),
  });

  const dismissAllSuggestions = useMutation({
    mutationFn: async () => {
      await fetch("/api/suggested-content-assets/dismiss-all", { method: "POST", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/suggested-content-assets"] }),
  });

  const handleAcceptSuggestion = (suggestion: any) => {
    setUrlInput(suggestion.url);
    setForm(f => ({ ...f, title: suggestion.title, url: suggestion.url }));
    setAddOpen(true);
    extractMutation.mutate(suggestion.url);
    dismissSuggestion.mutate(suggestion.id);
  };

  useEffect(() => {
    if (isAllowed && categories.length === 0) {
      fetch("/api/content-categories/seed-defaults", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).then(r => {
        if (r.ok) queryClient.invalidateQueries({ queryKey: ["/api/content-categories"] });
      });
    }
  }, [isAllowed, categories.length]);

  const extractMutation = useMutation({
    mutationFn: async (url: string) => {
      const r = await fetch("/api/content-assets/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json() as Promise<ExtractionResult>;
    },
    onSuccess: (result) => {
      setExtractionResult(result);
      setForm(f => ({
        ...f,
        title: result.title || f.title,
        description: result.description || f.description,
        url: urlInput,
        content: result.content || f.content,
        aiSummary: result.aiSummary || "",
        leadImageUrl: result.leadImageUrl || "",
      }));
      setFormStep("review");
    },
    onError: (err: Error) => toast({ title: "Extraction failed", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch("/api/content-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          extractionStatus: extractionResult ? "extracted" : "manual",
          tags: (data.tags.seasons.length || data.tags.topics.length) ? data.tags : null,
          productIds: data.productIds.length ? data.productIds : null,
          assetType: data.assetType || "other",
          solutionAreaIds: data.solutionAreaIds.length ? data.solutionAreaIds : null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      setAddOpen(false);
      resetForm();
      toast({ title: "Content asset added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/content-assets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast({ title: "Content asset archived" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/content-assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "active" }),
      });
      if (!r.ok) throw new Error("Restore failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast({ title: "Content asset restored" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/content-assets/${id}?permanent=true`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast({ title: "Content asset permanently deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      const r = await fetch(`/api/content-assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          url: data.url || null,
          content: data.content || null,
          leadImageUrl: data.leadImageUrl || null,
          categoryId: data.categoryId || null,
          productIds: data.productIds.length ? data.productIds : null,
          tags: (data.tags.seasons.length || data.tags.topics.length) ? data.tags : null,
          aiSummary: data.aiSummary || null,
          assetType: data.assetType || "other",
          solutionAreaIds: data.solutionAreaIds.length ? data.solutionAreaIds : null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      setEditOpen(false);
      toast({ title: "Asset updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEditDialog = (asset: ContentAsset) => {
    setEditForm({
      title: asset.title,
      description: asset.description || "",
      url: asset.url || "",
      content: asset.content || "",
      leadImageUrl: asset.leadImageUrl || "",
      categoryId: asset.categoryId || "",
      productIds: asset.productIds || [],
      tags: {
        seasons: asset.tags?.seasons || [],
        topics: asset.tags?.topics || [],
      },
      aiSummary: asset.aiSummary || "",
      assetType: asset.assetType || "other",
      solutionAreaIds: asset.solutionAreaIds || [],
    });
    setDetailAsset(asset);
    setEditOpen(true);
  };

  useEffect(() => {
    if (!isAllowed) return;
    const assetId = new URLSearchParams(window.location.search).get("asset");
    if (!assetId) return;
    fetch(`/api/content-assets/${assetId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((asset: ContentAsset | null) => {
        if (asset) openEditDialog(asset);
      })
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("asset");
        window.history.replaceState({}, "", url.pathname + url.search);
      });
  }, [isAllowed]);

  const toggleEditTag = (type: "seasons" | "topics", value: string) => {
    setEditForm(f => ({
      ...f,
      tags: {
        ...f.tags,
        [type]: f.tags[type].includes(value)
          ? f.tags[type].filter(v => v !== value)
          : [...f.tags[type], value],
      },
    }));
  };

  const toggleEditProduct = (productId: string) => {
    setEditForm(f => ({
      ...f,
      productIds: f.productIds.includes(productId)
        ? f.productIds.filter(id => id !== productId)
        : [...f.productIds, productId],
    }));
  };

  const handleBulkGenerateSummaries = async () => {
    setBulkGenerating(true);
    setBulkQueuedCount(0);
    try {
      const r = await fetch("/api/content-assets/generate-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Failed to start bulk generation");
      }
      const data = await r.json();
      if (data.queued) {
        setBulkQueuedCount(data.queued);
        toast({ title: "Generating summaries", description: `${data.queued} assets queued for AI summary generation. This will run in the background — refresh the page in a few minutes to see results.` });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
          setBulkGenerating(false);
        }, 10000);
      } else {
        toast({ title: "All done", description: "All active assets already have AI summaries." });
        setBulkGenerating(false);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setBulkGenerating(false);
    }
  };

  const handleRegenerateAllSummaries = async () => {
    if (!assets?.length) return;
    setBulkGenerating(true);
    setBulkQueuedCount(0);
    try {
      const allIds = assets.map((a) => a.id);
      const r = await fetch("/api/content-assets/generate-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ assetIds: allIds }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Failed to start regeneration");
      }
      const data = await r.json();
      if (data.queued) {
        setBulkQueuedCount(data.queued);
        toast({ title: "Regenerating all summaries", description: `${data.queued} assets queued for AI summary regeneration. This will run in the background — refresh the page in a few minutes to see results.` });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
          setBulkGenerating(false);
        }, 15000);
      } else {
        toast({ title: "No assets", description: "No content assets found to regenerate." });
        setBulkGenerating(false);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setBulkGenerating(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!detailAsset) return;
    setGeneratingSummary(true);
    try {
      const r = await fetch(`/api/content-assets/${detailAsset.id}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Failed to generate summary");
      }
      const data = await r.json();
      setEditForm(f => ({ ...f, aiSummary: data.aiSummary }));
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast({ title: "AI summary generated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingSummary(false);
    }
  };

  const saveLeadImageMutation = useMutation({
    mutationFn: async ({ assetId, name }: { assetId: string; name: string }) => {
      const r = await fetch(`/api/content-assets/${assetId}/save-lead-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Image saved to Visual/Brand Assets" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch("/api/content-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-categories"] });
      setNewCategoryName("");
      toast({ title: "Category added" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/content-categories/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/content-categories"] }),
  });

  // Search, status, category, and source are all applied server-side.
  const filtered = assets;

  const groupedByCategory = () => {
    const groups: Record<string, ContentAsset[]> = {};
    for (const asset of filtered) {
      const catName = categoryName(asset.categoryId) || "Uncategorized";
      if (!groups[catName]) groups[catName] = [];
      groups[catName].push(asset);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const categoryName = (id?: string) => categories.find(c => c.id === id)?.name;
  const productName = (id: string) => marketProducts.find(p => p.id === id)?.name;

  const toggleTag = (type: "seasons" | "topics", value: string) => {
    setForm(f => ({
      ...f,
      tags: {
        ...f.tags,
        [type]: f.tags[type].includes(value)
          ? f.tags[type].filter(v => v !== value)
          : [...f.tags[type], value],
      },
    }));
  };

  const toggleProduct = (productId: string) => {
    setForm(f => ({
      ...f,
      productIds: f.productIds.includes(productId)
        ? f.productIds.filter(id => id !== productId)
        : [...f.productIds, productId],
    }));
  };

  const handleExportCSV = async () => {
    let allAssets: ContentAsset[] = [];
    try {
      const params = new URLSearchParams();
      if (statusTab === "archived") params.set("status", "archived");
      const url = "/api/content-assets" + (params.toString() ? `?${params.toString()}` : "");
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("fetch failed");
      allAssets = await r.json();
    } catch {
      toast({ title: "Export failed", description: "Could not fetch assets.", variant: "destructive" });
      return;
    }
    const rows = allAssets.map(a => ({
      title: a.title,
      description: a.description || "",
      url: a.url || "",
      category: categoryName(a.categoryId) || "",
      status: a.status,
      fileType: a.fileType || "",
      createdDate: new Date(a.createdAt).toLocaleDateString(),
    }));
    exportContentAssetsToCSV(rows, "content-library");
    toast({ title: "CSV exported", description: `${rows.length} assets exported.` });
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) {
      toast({ title: "Import failed", description: "No valid rows found in CSV.", variant: "destructive" });
      return;
    }

    let imported = 0;
    let failed = 0;
    const neededCategories = new Set<string>();
    for (const row of rows) {
      const catName = (row["Category"] || "").trim();
      if (catName && !categories.find(c => c.name.toLowerCase() === catName.toLowerCase())) {
        neededCategories.add(catName);
      }
    }

    const createdCategoryMap: Record<string, string> = {};
    for (const catName of neededCategories) {
      try {
        const r = await fetch("/api/content-categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: catName }),
        });
        if (r.ok) {
          const cat = await r.json();
          createdCategoryMap[catName.toLowerCase()] = cat.id;
        }
      } catch {}
    }

    if (neededCategories.size > 0) {
      await queryClient.invalidateQueries({ queryKey: ["/api/content-categories"] });
    }

    for (const row of rows) {
      const title = row["Title"] || "";
      if (!title.trim()) { failed++; continue; }
      const catName = (row["Category"] || "").trim();
      const matchedCategory = categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
      const categoryId = matchedCategory?.id || createdCategoryMap[catName.toLowerCase()] || null;

      const activeRaw = row["ACTIVE"] || row["Active"] || "";
      let status = "active";
      if (row["Status"]) {
        status = row["Status"].toLowerCase() === "archived" ? "archived" : "active";
      } else if (activeRaw) {
        status = activeRaw.toUpperCase() === "FALSE" ? "archived" : "active";
      }

      const imageUrl = row["Image URL"] || row["Image Url"] || "";

      try {
        const r = await fetch("/api/content-assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title,
            description: row["Description"] || "",
            url: row["URL"] || row["Url"] || "",
            categoryId,
            fileType: (row["File Type"] || "").toLowerCase() || undefined,
            status,
            leadImageUrl: imageUrl || undefined,
            extractionStatus: row["Captured"] || imageUrl ? "captured" : "manual",
          }),
        });
        if (r.ok) imported++; else failed++;
      } catch { failed++; }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/content-categories"] });
    const catNote = neededCategories.size > 0 ? ` ${neededCategories.size} new categories created.` : "";
    toast({
      title: "Import complete",
      description: `${imported} assets imported${failed > 0 ? `, ${failed} failed` : ""}.${catNote}`,
    });
    if (importFileRef.current) importFileRef.current.value = "";
  };

  const renderAssetCard = (asset: ContentAsset) => (
    <Card
      key={asset.id}
      className="group cursor-pointer hover:border-primary/40 transition-colors"
      onClick={() => openEditDialog(asset)}
      data-testid={`card-content-asset-${asset.id}`}
    >
      {asset.leadImageUrl && (
        <OptimizedThumbnail
          src={asset.leadImageUrl}
          containerClassName="rounded-t-lg rounded-b-none"
        />
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{asset.title}</CardTitle>
          {asset.status === "archived" ? (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-7 w-7 text-green-500 hover:text-green-600"
                onClick={e => { e.stopPropagation(); restoreMutation.mutate(asset.id); }}
                title="Restore"
                data-testid={`button-restore-${asset.id}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-7 w-7 text-destructive hover:text-destructive"
                onClick={e => { e.stopPropagation(); if (window.confirm("Permanently delete this asset? This cannot be undone.")) permanentDeleteMutation.mutate(asset.id); }}
                title="Permanently delete"
                data-testid={`button-perm-delete-${asset.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 shrink-0 h-7 w-7"
              onClick={e => { e.stopPropagation(); deleteMutation.mutate(asset.id); }}
              title="Archive"
              data-testid={`button-archive-${asset.id}`}
            >
              <Archive className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {asset.capturedViaExtension && <Badge variant="secondary" className="text-xs">Captured</Badge>}
          {asset.extractionStatus === "extracted" && <Badge variant="secondary" className="text-xs"><Sparkles className="w-2.5 h-2.5 mr-0.5" />AI Extracted</Badge>}
          {asset.aiSummary && <Badge variant="secondary" className="text-xs text-primary"><Sparkles className="w-2.5 h-2.5 mr-0.5" />Summarized</Badge>}
          {categoryName(asset.categoryId) && <Badge variant="outline" className="text-xs">{categoryName(asset.categoryId)}</Badge>}
          {asset.status === "archived" && <Badge variant="secondary" className="text-xs">Archived</Badge>}
          {asset.productIds?.map(pid => (
            <Badge key={pid} variant="outline" className="text-xs text-primary">{productName(pid) || pid}</Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {asset.description && <p className="text-sm text-muted-foreground line-clamp-2">{asset.description}</p>}
        {asset.aiSummary && <p className="text-xs text-muted-foreground line-clamp-2 italic">{asset.aiSummary}</p>}
        {asset.url && (
          <a
            href={asset.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{asset.url}</span>
          </a>
        )}
        <div className="flex flex-wrap items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={e => { e.stopPropagation(); navigate(`/app/marketing/email-newsletters?assetId=${asset.id}`); }}
            data-testid={`button-generate-email-${asset.id}`}
          >
            <Mail className="w-3 h-3" /> Email
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={e => { e.stopPropagation(); navigate(`/app/marketing/campaigns?preselect=${asset.id}`); }}
            data-testid={`button-create-campaign-${asset.id}`}
          >
            <Megaphone className="w-3 h-3" /> Campaign
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={e => {
              e.stopPropagation();
              const params = new URLSearchParams({
                fromAsset: asset.id,
                name: asset.title,
                ...(asset.description ? { description: asset.description } : {}),
                ...(asset.url ? { url: asset.url } : {}),
              });
              navigate(`/app/products?${params.toString()}`);
            }}
            data-testid={`button-create-product-${asset.id}`}
          >
            <Package className="w-3 h-3" /> Product
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {asset.assetType && asset.assetType !== "other" && (
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">{ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}</Badge>
          )}
          {asset.tags?.topics?.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
          {asset.tags?.seasons?.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
        </div>
      </CardContent>
    </Card>
  );

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center" data-testid="card-locked-content-library">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Digital/Web Assets</CardTitle>
              <CardDescription>Available on the Enterprise plan. Manage URLs, articles, and web-based content assets to power your campaigns, social posts, and email generation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" data-testid="button-contact-sales-content">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Digital Web Assets">Contact Sales</a>
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
        <div className="page-header-gradient-bar rounded-lg p-6 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-content-library-title">
                <Library className="w-6 h-6" /> Digital/Web Assets
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Manage web content used to generate posts.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImportCSV}
                data-testid="input-import-csv-content"
              />
              <Button variant="outline" size="sm" onClick={() => importFileRef.current?.click()} data-testid="button-import-csv-content">
                <Upload className="w-4 h-4 mr-1" /> Import CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0} data-testid="button-export-csv-content">
                <Download className="w-4 h-4 mr-1" /> Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkGenerateSummaries}
                disabled={bulkGenerating}
                data-testid="button-generate-all-summaries"
              >
                {bulkGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating{bulkQueuedCount ? ` (${bulkQueuedCount})` : ""}...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-1" /> Generate Missing Summaries</>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerateAllSummaries}
                disabled={bulkGenerating}
                data-testid="button-regenerate-all-summaries"
              >
                {bulkGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Regenerating{bulkQueuedCount ? ` (${bulkQueuedCount})` : ""}...</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-1" /> Regenerate All Summaries</>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setManageCategoriesOpen(true)} data-testid="button-manage-categories">
                <Settings className="w-4 h-4 mr-1" /> Categories
              </Button>
              <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) { resetForm(); setDuplicateAsset(null); } }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-content-asset"><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{formStep === "url" ? "Add Content Asset" : "Review Extracted Content"}</DialogTitle>
                    <DialogDescription>
                      {formStep === "url"
                        ? "Paste a URL to automatically extract content, or enter details manually."
                        : "Review and adjust the extracted content before saving."}
                    </DialogDescription>
                  </DialogHeader>

                  {formStep === "url" ? (
                    <div className="space-y-4">
                      <div className="border rounded-lg p-4 bg-muted/30">
                        <Label className="text-sm font-medium">Extract from URL</Label>
                        <p className="text-xs text-muted-foreground mb-2">
                          Paste a URL and Orbit will fetch the title, description, content, and lead image automatically.
                        </p>
                        <div className="flex gap-2">
                          <Input
                            value={urlInput}
                            onChange={e => { setUrlInput(e.target.value); setDuplicateAsset(null); }}
                            placeholder="https://example.com/blog-post"
                            data-testid="input-extract-url"
                          />
                          <Button
                            onClick={() => {
                              const dup = checkDuplicateUrl(urlInput);
                              if (dup) {
                                setDuplicateAsset(dup);
                              } else {
                                setDuplicateAsset(null);
                                extractMutation.mutate(urlInput);
                              }
                            }}
                            disabled={!urlInput.trim() || extractMutation.isPending}
                            data-testid="button-extract-url"
                          >
                            {extractMutation.isPending ? (
                              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Extracting...</>
                            ) : (
                              <><Globe className="w-4 h-4 mr-1" /> Extract</>
                            )}
                          </Button>
                        </div>
                        {duplicateAsset && (
                          <div className="mt-2 border border-yellow-500/50 bg-yellow-500/10 rounded-lg p-3 space-y-2" data-testid="duplicate-url-warning">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                              <div className="text-sm">
                                <p className="font-medium text-yellow-500">Duplicate URL detected</p>
                                <p className="text-muted-foreground mt-0.5">
                                  This URL already exists as "<span className="font-medium">{duplicateAsset.title}</span>"
                                  {duplicateAsset.categoryId && categoryName(duplicateAsset.categoryId) && (
                                    <> in {categoryName(duplicateAsset.categoryId)}</>
                                  )}.
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2 ml-6">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setDuplicateAsset(null);
                                  extractMutation.mutate(urlInput);
                                }}
                                data-testid="button-extract-anyway"
                              >
                                Extract Anyway
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setDuplicateAsset(null);
                                  openEditDialog(duplicateAsset);
                                  setAddOpen(false);
                                }}
                                data-testid="button-view-existing"
                              >
                                View Existing
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or enter manually</span></div>
                      </div>

                      <div>
                        <Label>Title *</Label>
                        <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Asset title" data-testid="input-content-title" />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description" data-testid="input-content-description" />
                      </div>
                      <div>
                        <Label>Content</Label>
                        <Textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="Paste content here..." rows={5} data-testid="input-content-body" />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Category</Label>
                          <Select value={form.categoryId || "none"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                            <SelectTrigger data-testid="select-content-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No category</SelectItem>
                              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Asset Type</Label>
                          <Select value={form.assetType} onValueChange={v => setForm(f => ({ ...f, assetType: v }))}>
                            <SelectTrigger data-testid="select-content-asset-type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(ASSET_TYPE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <Label>Products</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-select-products">
                              {form.productIds.length ? `${form.productIds.length} selected` : "Select products"}
                              <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                            {marketProducts.length === 0 ? (
                              <div className="px-2 py-1 text-sm text-muted-foreground">No products in this market</div>
                            ) : marketProducts.map(p => (
                              <DropdownMenuCheckboxItem
                                key={p.id}
                                checked={form.productIds.includes(p.id)}
                                onCheckedChange={() => toggleProduct(p.id)}
                              >
                                {p.name}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {solutionAreas.length > 0 && (
                        <div>
                          <Label>Solution Areas</Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-select-solution-areas">
                                {form.solutionAreaIds.length ? `${form.solutionAreaIds.length} selected` : "Select solution areas"}
                                <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                              {solutionAreas.map(a => (
                                <DropdownMenuCheckboxItem
                                  key={a.id}
                                  checked={form.solutionAreaIds.includes(a.id)}
                                  onCheckedChange={() => setForm(f => ({
                                    ...f,
                                    solutionAreaIds: f.solutionAreaIds.includes(a.id)
                                      ? f.solutionAreaIds.filter(id => id !== a.id)
                                      : [...f.solutionAreaIds, a.id],
                                  }))}
                                >
                                  {a.name}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}

                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                            <Tag className="w-4 h-4 mr-1" /> Tags & Classifications <ChevronDown className="w-4 h-4 ml-auto" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-3 pt-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">Topics</Label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {TOPIC_OPTIONS.map(t => (
                                <Badge
                                  key={t}
                                  variant={form.tags.topics.includes(t) ? "default" : "outline"}
                                  className="cursor-pointer text-xs"
                                  onClick={() => toggleTag("topics", t)}
                                  data-testid={`tag-topic-${t.toLowerCase().replace(/\s+/g, "-")}`}
                                >{t}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Seasons / Timing</Label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {SEASON_OPTIONS.map(s => (
                                <Badge
                                  key={s}
                                  variant={form.tags.seasons.includes(s) ? "default" : "outline"}
                                  className="cursor-pointer text-xs"
                                  onClick={() => toggleTag("seasons", s)}
                                  data-testid={`tag-season-${s.toLowerCase().replace(/\s+/g, "-")}`}
                                >{s}</Badge>
                              ))}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>

                      <Button
                        className="w-full"
                        disabled={!form.title.trim() || createMutation.isPending}
                        onClick={() => createMutation.mutate(form)}
                        data-testid="button-save-content-asset"
                      >
                        {createMutation.isPending ? "Saving..." : "Save Asset"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {form.leadImageUrl && (
                        <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
                          <img
                            src={form.leadImageUrl}
                            alt="Lead image"
                            className="w-full h-full object-cover"
                            onError={e => (e.currentTarget.style.display = "none")}
                            data-testid="img-extracted-lead"
                          />
                          <div className="absolute bottom-2 right-2">
                            <Badge variant="secondary" className="text-xs"><ImageIcon className="w-3 h-3 mr-1" /> Lead Image</Badge>
                          </div>
                        </div>
                      )}

                      <div>
                        <Label>Title *</Label>
                        <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-review-title" />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-review-description" />
                      </div>
                      <div>
                        <Label className="flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-primary" /> AI Summary
                        </Label>
                        <Textarea
                          value={form.aiSummary}
                          onChange={e => setForm(f => ({ ...f, aiSummary: e.target.value }))}
                          rows={4}
                          className="text-sm"
                          data-testid="input-review-ai-summary"
                        />
                        <p className="text-xs text-muted-foreground mt-1">This summary is used when generating social posts and emails.</p>
                      </div>

                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                            Extracted Content <ChevronDown className="w-4 h-4 ml-auto" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <Textarea
                            value={form.content}
                            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                            rows={8}
                            className="text-xs font-mono"
                            data-testid="input-review-content"
                          />
                        </CollapsibleContent>
                      </Collapsible>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Category</Label>
                          <Select value={form.categoryId || "none"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                            <SelectTrigger data-testid="select-review-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No category</SelectItem>
                              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Asset Type</Label>
                          <Select value={form.assetType} onValueChange={v => setForm(f => ({ ...f, assetType: v }))}>
                            <SelectTrigger data-testid="select-review-asset-type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(ASSET_TYPE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <Label>Products</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-review-products">
                              {form.productIds.length ? `${form.productIds.length} selected` : "Select products"}
                              <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                            {marketProducts.length === 0 ? (
                              <div className="px-2 py-1 text-sm text-muted-foreground">No products in this market</div>
                            ) : marketProducts.map(p => (
                              <DropdownMenuCheckboxItem
                                key={p.id}
                                checked={form.productIds.includes(p.id)}
                                onCheckedChange={() => toggleProduct(p.id)}
                              >
                                {p.name}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {solutionAreas.length > 0 && (
                        <div>
                          <Label>Solution Areas</Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-review-solution-areas">
                                {form.solutionAreaIds.length ? `${form.solutionAreaIds.length} selected` : "Select solution areas"}
                                <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                              {solutionAreas.map(a => (
                                <DropdownMenuCheckboxItem
                                  key={a.id}
                                  checked={form.solutionAreaIds.includes(a.id)}
                                  onCheckedChange={() => setForm(f => ({
                                    ...f,
                                    solutionAreaIds: f.solutionAreaIds.includes(a.id)
                                      ? f.solutionAreaIds.filter(id => id !== a.id)
                                      : [...f.solutionAreaIds, a.id],
                                  }))}
                                >
                                  {a.name}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}

                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                            <Tag className="w-4 h-4 mr-1" /> Tags & Classifications <ChevronDown className="w-4 h-4 ml-auto" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-3 pt-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">Topics</Label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {TOPIC_OPTIONS.map(t => (
                                <Badge
                                  key={t}
                                  variant={form.tags.topics.includes(t) ? "default" : "outline"}
                                  className="cursor-pointer text-xs"
                                  onClick={() => toggleTag("topics", t)}
                                >{t}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Seasons / Timing</Label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {SEASON_OPTIONS.map(s => (
                                <Badge
                                  key={s}
                                  variant={form.tags.seasons.includes(s) ? "default" : "outline"}
                                  className="cursor-pointer text-xs"
                                  onClick={() => toggleTag("seasons", s)}
                                >{s}</Badge>
                              ))}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>

                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setFormStep("url")} className="flex-1" data-testid="button-back-to-url">
                          Back
                        </Button>
                        <Button
                          className="flex-1"
                          disabled={!form.title.trim() || createMutation.isPending}
                          onClick={() => createMutation.mutate(form)}
                          data-testid="button-save-extracted-asset"
                        >
                          {createMutation.isPending ? "Saving..." : "Save Asset"}
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-content" />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center bg-muted rounded-md p-0.5" data-testid="status-toggle-content">
              <button
                onClick={() => setStatusTab("active")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${statusTab === "active" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="button-status-active-content"
              >
                Active
              </button>
              <button
                onClick={() => setStatusTab("archived")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${statusTab === "archived" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="button-status-archived-content"
              >
                <Archive className="w-3 h-3" /> Archived
                {statusTab === "archived" && assetsTotal > 0 && (
                  <span className="bg-muted-foreground/20 rounded-full px-1.5 text-[10px]">{assetsTotal}</span>
                )}
              </button>
            </div>
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("table")}
              data-testid="button-view-table-content"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("cards")}
              data-testid="button-view-cards-content"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap" data-testid="category-pills-content">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            data-testid="pill-category-all"
          >
            All <span className="bg-white/20 rounded-full px-1.5 text-[10px]">{assetsTotal}</span>
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id === categoryFilter ? "all" : cat.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === cat.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
              data-testid={`pill-category-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {cat.name}
            </button>
          ))}
          <button
            onClick={() => setCategoryFilter(categoryFilter === "__uncategorized" ? "all" : "__uncategorized")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === "__uncategorized" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            data-testid="pill-category-uncategorized"
          >
            Uncategorized
          </button>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-7 w-[140px] text-xs" data-testid="select-source-filter-content">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="manual">Manually added</SelectItem>
              <SelectItem value="captured">Captured</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assetTypeFilter} onValueChange={setAssetTypeFilter}>
            <SelectTrigger className="h-7 w-[140px] text-xs" data-testid="select-asset-type-filter-content">
              <SelectValue placeholder="Asset type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(ASSET_TYPE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {solutionAreas.length > 0 && (
            <Select value={solutionAreaFilter} onValueChange={setSolutionAreaFilter}>
              <SelectTrigger className="h-7 w-[160px] text-xs" data-testid="select-solution-area-filter-content">
                <SelectValue placeholder="Solution area" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All areas</SelectItem>
                {solutionAreas.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {suggestions.length > 0 && (
          <Collapsible open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
            <Card className="border-primary/20 bg-primary/[0.02]">
              <CollapsibleTrigger asChild>
                <button className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-primary/5 transition-colors rounded-lg" data-testid="btn-toggle-suggestions">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Suggested from your website</span>
                    <Badge variant="secondary" className="text-xs">{suggestions.length}</Badge>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${suggestionsOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-3">
                    Pages discovered during your website crawl that could work well as marketing content assets. Add them to your library or dismiss.
                  </p>
                  <div className="space-y-2 max-h-[320px] overflow-y-auto">
                    {suggestions.map((s: any) => (
                      <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors group" data-testid={`suggested-asset-${s.id}`}>
                        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Globe className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{s.title}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground truncate max-w-[250px]">{s.url?.replace(/^https?:\/\//, "")}</span>
                            {s.suggestedCategory && (
                              <Badge variant="outline" className="text-[10px] h-4 shrink-0">{s.suggestedCategory}</Badge>
                            )}
                          </div>
                          {s.reason && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{s.reason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => handleAcceptSuggestion(s)}
                            data-testid={`btn-accept-suggestion-${s.id}`}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Add
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground"
                            onClick={() => dismissSuggestion.mutate(s.id)}
                            data-testid={`btn-dismiss-suggestion-${s.id}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {suggestions.length > 3 && (
                    <div className="flex justify-end mt-2">
                      <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => dismissAllSuggestions.mutate()} data-testid="btn-dismiss-all-suggestions">
                        Dismiss All
                      </Button>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        {isLoading && !assetsPage ? (
          viewMode === "table" ? (
            <ContentTableSkeleton count={6} />
          ) : (
            <ContentCardGridSkeleton count={6} />
          )
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty-content">
              {assetsTotal === 0 && !debouncedAssetSearch
                ? "No content assets yet. Click \"Add Content\" to get started by pasting a URL or entering content manually."
                : "No assets match your search or filter."}
            </CardContent>
          </Card>
        ) : viewMode === "table" ? (
          <div className="rounded-lg border overflow-hidden animate-in fade-in duration-200 motion-reduce:animate-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Content</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Category</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">AI Extraction</th>
                  <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Added</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(asset => (
                  <tr key={asset.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors" data-testid={`table-row-${asset.id}`}>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        {asset.leadImageUrl ? (
                          <img src={asset.leadImageUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <button
                            onClick={() => openEditDialog(asset)}
                            className="text-sm font-medium hover:text-primary transition-colors truncate block max-w-[280px] text-left"
                            data-testid={`link-asset-title-${asset.id}`}
                          >
                            {asset.title}
                          </button>
                          {asset.url && (
                            <a href={asset.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary truncate block max-w-[280px]">
                              {asset.url.replace(/^https?:\/\//, "").substring(0, 40)}...
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {asset.categoryId ? (
                          <Badge variant="outline" className="text-xs">{categoryName(asset.categoryId) || "—"}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {asset.assetType && asset.assetType !== "other" && (
                          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">{ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge className={`text-xs ${asset.status === "active" ? "bg-green-500/20 text-green-400 border-green-500/50" : "bg-gray-500/20 text-gray-400 border-gray-500/50"}`}>
                        {asset.status === "active" ? "Active" : "Archived"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      {asset.extractionStatus === "completed" ? (
                        <span className="text-xs text-green-400 flex items-center gap-1"><Globe className="w-3 h-3" /> Completed</span>
                      ) : asset.extractionStatus === "pending" ? (
                        <span className="text-xs text-yellow-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Pending</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(asset.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1 justify-end">
                        {asset.url && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => extractMutation.mutate(asset.id)} data-testid={`button-extract-${asset.id}`}>
                            <RefreshCw className="w-3 h-3 mr-1" /> Extract
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEditDialog(asset)} data-testid={`button-view-${asset.id}`}>
                          View
                        </Button>
                        {asset.status === "archived" ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600" onClick={() => restoreMutation.mutate(asset.id)} title="Restore" data-testid={`button-restore-table-${asset.id}`}>
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (window.confirm("Permanently delete this asset? This cannot be undone.")) permanentDeleteMutation.mutate(asset.id); }} title="Permanently delete" data-testid={`button-perm-delete-table-${asset.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => deleteMutation.mutate(asset.id)} title="Archive" data-testid={`button-archive-table-${asset.id}`}>
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-start animate-in fade-in duration-200 motion-reduce:animate-none">
            {filtered.map(renderAssetCard)}
          </div>
        )}

        {assetsTotal > 0 && (
          <PaginationFooter
            page={assetPage}
            pageSize={ASSETS_PAGE_SIZE}
            total={assetsTotal}
            hasMore={assetsHasMore}
            onPrev={() => setAssetPage((p) => Math.max(1, p - 1))}
            onNext={() => setAssetPage((p) => p + 1)}
            onPageChange={(p) => setAssetPage(p)}
            onPageSizeChange={(s) => { setAssetsPageSize(s); setAssetPage(1); }}
            testIdPrefix="content-pagination"
          />
        )}

        {/* Edit Asset Dialog */}
        <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) { setDetailAsset(null); setShowBrandImagePicker(false); } }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            {detailAsset && (
              <>
                <DialogHeader>
                  <DialogTitle>Edit Content Asset</DialogTitle>
                  <DialogDescription>
                    Modify the asset details below. Changes are saved immediately.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div>
                    <Label className="flex items-center gap-1 mb-1"><ImageIcon className="w-3.5 h-3.5" /> Lead Image</Label>
                    {editForm.leadImageUrl ? (
                      <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
                        <img src={editForm.leadImageUrl} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = "none")} />
                        <div className="absolute bottom-2 right-2 flex gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => saveLeadImageMutation.mutate({ assetId: detailAsset.id, name: `Image from ${detailAsset.title}` })}
                            disabled={saveLeadImageMutation.isPending}
                            data-testid="button-save-to-brand"
                          >
                            <ImageIcon className="w-3.5 h-3.5 mr-1" />
                            {saveLeadImageMutation.isPending ? "Saving..." : "Save to Visual/Brand Assets"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setEditForm(f => ({ ...f, leadImageUrl: "" }))}
                            data-testid="button-remove-lead-image"
                          >
                            <X className="w-3.5 h-3.5 mr-1" /> Remove
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex gap-2 mt-1">
                      <Input
                        value={editForm.leadImageUrl}
                        onChange={e => setEditForm(f => ({ ...f, leadImageUrl: e.target.value }))}
                        placeholder="Paste image URL..."
                        className="flex-1"
                        data-testid="input-edit-lead-image-url"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1"
                        onClick={() => setShowBrandImagePicker(!showBrandImagePicker)}
                        data-testid="button-pick-brand-image"
                      >
                        <Library className="w-3.5 h-3.5" />
                        {showBrandImagePicker ? "Hide" : "Visual/Brand Assets"}
                      </Button>
                    </div>
                    {showBrandImagePicker && (
                      <div className="border rounded-lg p-3 mt-2 bg-muted/30 space-y-2">
                        <Label className="text-xs text-muted-foreground">Select an image from Visual/Brand Assets</Label>
                        {brandImages.length > 0 ? (
                          <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                            {brandImages.map(ba => {
                              const imgUrl = ba.fileUrl || ba.url || "";
                              return (
                                <button
                                  key={ba.id}
                                  type="button"
                                  className="relative rounded border overflow-hidden aspect-square hover:ring-2 ring-primary transition-all bg-card"
                                  onClick={() => {
                                    setEditForm(f => ({ ...f, leadImageUrl: imgUrl }));
                                    setShowBrandImagePicker(false);
                                  }}
                                  data-testid={`button-brand-image-${ba.id}`}
                                >
                                  <img src={imgUrl} alt={ba.name} className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = "none")} />
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                                    <p className="text-[9px] text-white truncate">{ba.name}</p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No images found in Visual/Brand Assets.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>Title *</Label>
                    <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} data-testid="input-edit-content-title" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} data-testid="input-edit-content-description" />
                  </div>
                  <div>
                    <Label className="flex items-center gap-1"><Link className="w-3.5 h-3.5" /> Source URL</Label>
                    <Input value={editForm.url} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." data-testid="input-edit-content-url" />
                  </div>

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                        <FileText className="w-4 h-4 mr-1" /> Full Content / Body Text <ChevronDown className="w-4 h-4 ml-auto" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <Textarea
                        value={editForm.content}
                        onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
                        rows={8}
                        placeholder="Full article text, blog post body, or other content..."
                        data-testid="input-edit-content-body"
                      />
                    </CollapsibleContent>
                  </Collapsible>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-primary" /> AI Summary</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateSummary}
                        disabled={generatingSummary}
                        data-testid="button-generate-ai-summary"
                      >
                        {generatingSummary ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Generating...</>
                        ) : (
                          <><Sparkles className="w-3.5 h-3.5 mr-1" /> {editForm.aiSummary ? "Regenerate" : "Generate"} Summary</>
                        )}
                      </Button>
                    </div>
                    <Textarea value={editForm.aiSummary} onChange={e => setEditForm(f => ({ ...f, aiSummary: e.target.value }))} rows={6} placeholder={generatingSummary ? "Generating AI summary..." : "Click 'Generate Summary' to create an AI-powered summary for this asset"} data-testid="input-edit-content-ai-summary" />
                  </div>

                  <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                    <Label className="flex items-center gap-1 text-sm font-medium"><Package className="w-3.5 h-3.5" /> Product & Category</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Category</Label>
                        <Select value={editForm.categoryId || "none"} onValueChange={v => setEditForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                          <SelectTrigger data-testid="select-edit-content-category"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No category</SelectItem>
                            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Asset Type</Label>
                        <Select value={editForm.assetType} onValueChange={v => setEditForm(f => ({ ...f, assetType: v }))}>
                          <SelectTrigger data-testid="select-edit-content-asset-type"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(ASSET_TYPE_LABELS).map(([v, l]) => (
                              <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Linked Products</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-edit-select-products">
                            {editForm.productIds.length ? `${editForm.productIds.length} selected` : "Select products"}
                            <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                          {marketProducts.map(p => (
                            <DropdownMenuCheckboxItem
                              key={p.id}
                              checked={editForm.productIds.includes(p.id)}
                              onCheckedChange={() => toggleEditProduct(p.id)}
                            >
                              {p.name}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {solutionAreas.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Solution Areas</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-edit-select-solution-areas">
                              {editForm.solutionAreaIds.length ? `${editForm.solutionAreaIds.length} selected` : "Select solution areas"}
                              <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                            {solutionAreas.map(a => (
                              <DropdownMenuCheckboxItem
                                key={a.id}
                                checked={editForm.solutionAreaIds.includes(a.id)}
                                onCheckedChange={() => setEditForm(f => ({
                                  ...f,
                                  solutionAreaIds: f.solutionAreaIds.includes(a.id)
                                    ? f.solutionAreaIds.filter(id => id !== a.id)
                                    : [...f.solutionAreaIds, a.id],
                                }))}
                              >
                                {a.name}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {editForm.solutionAreaIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {editForm.solutionAreaIds.map(sid => {
                              const area = solutionAreas.find(a => a.id === sid);
                              return area ? (
                                <Badge key={sid} variant="secondary" className="gap-1 text-xs">
                                  {area.name}
                                  <X className="w-3 h-3 cursor-pointer" onClick={() => setEditForm(f => ({ ...f, solutionAreaIds: f.solutionAreaIds.filter(id => id !== sid) }))} />
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {editForm.productIds.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {editForm.productIds.map(pid => {
                          const prod = marketProducts.find(p => p.id === pid);
                          return prod ? (
                            <Badge key={pid} variant="secondary" className="gap-1">
                              {prod.name}
                              <X className="w-3 h-3 cursor-pointer" onClick={() => toggleEditProduct(pid)} />
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                        <Tag className="w-4 h-4 mr-1" /> Tags & Classifications <ChevronDown className="w-4 h-4 ml-auto" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Topics</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {TOPIC_OPTIONS.map(t => (
                            <Badge
                              key={t}
                              variant={editForm.tags.topics.includes(t) ? "default" : "outline"}
                              className="cursor-pointer text-xs"
                              onClick={() => toggleEditTag("topics", t)}
                            >{t}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Seasons / Timing</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {SEASON_OPTIONS.map(s => (
                            <Badge
                              key={s}
                              variant={editForm.tags.seasons.includes(s) ? "default" : "outline"}
                              className="cursor-pointer text-xs"
                              onClick={() => toggleEditTag("seasons", s)}
                            >{s}</Badge>
                          ))}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={() => {
                        setEditOpen(false);
                        setDetailAsset(null);
                        navigate(`/app/marketing/email-newsletters?assetId=${detailAsset.id}`);
                      }}
                      data-testid="button-generate-email-from-detail"
                    >
                      <Mail className="w-4 h-4" /> Generate Email
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={() => {
                        setEditOpen(false);
                        setDetailAsset(null);
                        navigate(`/app/marketing/campaigns?preselect=${detailAsset.id}`);
                      }}
                      data-testid="button-create-campaign-from-detail"
                    >
                      <Megaphone className="w-4 h-4" /> Instant Campaign
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={() => {
                        setEditOpen(false);
                        setDetailAsset(null);
                        const params = new URLSearchParams({
                          fromAsset: detailAsset.id,
                          name: detailAsset.title,
                          ...(detailAsset.description ? { description: detailAsset.description } : {}),
                          ...(detailAsset.url ? { url: detailAsset.url } : {}),
                        });
                        navigate(`/app/products?${params.toString()}`);
                      }}
                      data-testid="button-create-product-from-detail"
                    >
                      <Package className="w-4 h-4" /> Create Product
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={!editForm.title.trim() || editMutation.isPending}
                      onClick={() => editMutation.mutate({ id: detailAsset.id, data: editForm })}
                      data-testid="button-save-edit-content"
                    >
                      {editMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Manage Categories Dialog */}
        <Dialog open={manageCategoriesOpen} onOpenChange={setManageCategoriesOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Manage Content Categories</DialogTitle>
              <DialogDescription>Add, edit, or remove content categories for your tenant.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  data-testid="input-new-category"
                />
                <Button
                  size="sm"
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  onClick={() => createCategoryMutation.mutate(newCategoryName)}
                  data-testid="button-add-category"
                >
                  Add
                </Button>
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {categories.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50" data-testid={`category-item-${c.id}`}>
                    <span className="text-sm">{c.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => deleteCategoryMutation.mutate(c.id)}
                      data-testid={`button-delete-category-${c.id}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                {categories.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No categories yet.</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
