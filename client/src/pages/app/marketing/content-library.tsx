import { useState, useEffect, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Library, Plus, Search, ExternalLink, Trash2, Lock, Globe, Loader2,
  ImageIcon, Sparkles, Tag, Filter, Settings, ChevronDown, X, Megaphone,
  Download, Upload, LayoutGrid, List
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
  tags?: { seasons?: string[]; locations?: string[]; topics?: string[] };
  status: string;
  capturedViaExtension: boolean;
  createdAt: string;
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

export default function ContentLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusTab, setStatusTab] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [detailAsset, setDetailAsset] = useState<ContentAsset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "", description: "", categoryId: "", productIds: [] as string[],
    tags: { seasons: [] as string[], topics: [] as string[] },
    aiSummary: "",
  });
  const importFileRef = useRef<HTMLInputElement>(null);

  const [urlInput, setUrlInput] = useState("");
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [formStep, setFormStep] = useState<"url" | "review">("url");

  const [form, setForm] = useState({
    title: "", description: "", url: "", content: "", aiSummary: "",
    leadImageUrl: "", categoryId: "", productIds: [] as string[],
    tags: { seasons: [] as string[], topics: [] as string[] },
  });

  const resetForm = () => {
    setForm({
      title: "", description: "", url: "", content: "", aiSummary: "",
      leadImageUrl: "", categoryId: "", productIds: [],
      tags: { seasons: [], topics: [] },
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

  const { data: assets = [], isLoading } = useQuery<ContentAsset[]>({
    queryKey: ["/api/content-assets"],
    queryFn: async () => {
      const r = await fetch("/api/content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

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

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/content-assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "archived" }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] }),
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
          categoryId: data.categoryId || null,
          productIds: data.productIds.length ? data.productIds : null,
          tags: (data.tags.seasons.length || data.tags.topics.length) ? data.tags : null,
          aiSummary: data.aiSummary || null,
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
      categoryId: asset.categoryId || "",
      productIds: asset.productIds || [],
      tags: {
        seasons: asset.tags?.seasons || [],
        topics: asset.tags?.topics || [],
      },
      aiSummary: asset.aiSummary || "",
    });
    setDetailAsset(asset);
    setEditOpen(true);
  };

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
      toast({ title: "Image saved to Brand Library" });
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

  const filtered = assets.filter(a => {
    const matchesSearch = !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || a.categoryId === categoryFilter;
    const matchesSource = sourceFilter === "all" ||
      (sourceFilter === "captured" && a.capturedViaExtension) ||
      (sourceFilter === "manual" && !a.capturedViaExtension);
    const matchesStatus = statusTab === "all" ||
      (statusTab === "active" && a.status === "active") ||
      (statusTab === "archived" && a.status === "archived");
    return matchesSearch && matchesCategory && matchesSource && matchesStatus;
  });

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

  const handleExportCSV = () => {
    const rows = filtered.map(a => ({
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
        <div className="aspect-video overflow-hidden rounded-t-lg bg-muted">
          <img
            src={asset.leadImageUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={e => (e.currentTarget.style.display = "none")}
          />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{asset.title}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 shrink-0 h-7 w-7"
            onClick={e => { e.stopPropagation(); archiveMutation.mutate(asset.id); }}
            data-testid={`button-archive-${asset.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {asset.capturedViaExtension && <Badge variant="secondary" className="text-xs">Captured</Badge>}
          {asset.extractionStatus === "extracted" && <Badge variant="secondary" className="text-xs"><Sparkles className="w-2.5 h-2.5 mr-0.5" />AI Extracted</Badge>}
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
        <div className="flex items-center gap-2">
          {asset.url && (
            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline flex-1 min-w-0"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{asset.url}</span>
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs gap-1 opacity-0 group-hover:opacity-100"
            onClick={e => { e.stopPropagation(); navigate(`/app/marketing/campaigns?preselect=${asset.id}`); }}
            data-testid={`button-create-campaign-${asset.id}`}
          >
            <Megaphone className="w-3 h-3" /> Campaign
          </Button>
        </div>
        {asset.tags && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.topics?.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            {asset.tags.seasons?.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
          </div>
        )}
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
              <CardTitle>Content Library</CardTitle>
              <CardDescription>Available on the Enterprise plan. Manage marketing content assets to power your campaigns, social posts, and email generation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" data-testid="button-contact-sales-content">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Content Library">Contact Sales</a>
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
                <Library className="w-6 h-6" /> Content Library
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Add URLs or paste content to build your marketing asset library. AI automatically extracts and summarizes page content for social posts and emails.
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
              <Button variant="outline" size="sm" onClick={() => setManageCategoriesOpen(true)} data-testid="button-manage-categories">
                <Settings className="w-4 h-4 mr-1" /> Categories
              </Button>
              <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) resetForm(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-content-asset"><Plus className="w-4 h-4 mr-2" />Add Content</Button>
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
                            onChange={e => setUrlInput(e.target.value)}
                            placeholder="https://example.com/blog-post"
                            data-testid="input-extract-url"
                          />
                          <Button
                            onClick={() => extractMutation.mutate(urlInput)}
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
                                  {p.name} {p.isBaseline && <Badge variant="secondary" className="ml-1 text-[10px]">Yours</Badge>}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
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
                                  {p.name} {p.isBaseline && <Badge variant="secondary" className="ml-1 text-[10px]">Yours</Badge>}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
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

        <Tabs value={statusTab} onValueChange={setStatusTab}>
          <div className="flex items-center justify-between gap-3">
            <TabsList data-testid="tabs-content-status">
              <TabsTrigger value="all" data-testid="tab-content-all">All</TabsTrigger>
              <TabsTrigger value="active" data-testid="tab-content-active">Active</TabsTrigger>
              <TabsTrigger value="archived" data-testid="tab-content-archived">Archived</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "flat" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("flat")}
                data-testid="button-view-flat-content"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "grouped" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grouped")}
                data-testid="button-view-grouped-content"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Tabs>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-content" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48" data-testid="select-filter-category">
              <Filter className="w-4 h-4 mr-1" />
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40" data-testid="select-filter-source">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="captured">Captured</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty-content">
              {assets.length === 0
                ? "No content assets yet. Click \"Add Content\" to get started by pasting a URL or entering content manually."
                : "No assets match your search or filter."}
            </CardContent>
          </Card>
        ) : viewMode === "grouped" ? (
          <div className="space-y-6">
            {groupedByCategory().map(([catName, catAssets]) => (
              <div key={catName} data-testid={`group-content-${catName.toLowerCase().replace(/\s+/g, "-")}`}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5" /> {catName}
                  <Badge variant="secondary" className="text-xs">{catAssets.length}</Badge>
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {catAssets.map(renderAssetCard)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map(renderAssetCard)}
          </div>
        )}

        {/* Edit Asset Dialog */}
        <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) setDetailAsset(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            {detailAsset && (
              <>
                <DialogHeader>
                  <DialogTitle>Edit Content Asset</DialogTitle>
                  <DialogDescription>
                    Modify the asset details below. Changes are saved immediately.
                  </DialogDescription>
                </DialogHeader>

                {detailAsset.leadImageUrl && (
                  <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
                    <img src={detailAsset.leadImageUrl} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = "none")} />
                    <div className="absolute bottom-2 right-2 flex gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => saveLeadImageMutation.mutate({ assetId: detailAsset.id, name: `Image from ${detailAsset.title}` })}
                        disabled={saveLeadImageMutation.isPending}
                        data-testid="button-save-to-brand"
                      >
                        <ImageIcon className="w-3.5 h-3.5 mr-1" />
                        {saveLeadImageMutation.isPending ? "Saving..." : "Save to Brand Library"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <Label>Title *</Label>
                    <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} data-testid="input-edit-content-title" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} data-testid="input-edit-content-description" />
                  </div>
                  <div>
                    <Label className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-primary" /> AI Summary</Label>
                    <Textarea value={editForm.aiSummary} onChange={e => setEditForm(f => ({ ...f, aiSummary: e.target.value }))} rows={3} data-testid="input-edit-content-ai-summary" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Category</Label>
                      <Select value={editForm.categoryId || "none"} onValueChange={v => setEditForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                        <SelectTrigger data-testid="select-edit-content-category"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No category</SelectItem>
                          {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Products</Label>
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

                  <div className="flex gap-2">
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
                      <Megaphone className="w-4 h-4" /> Create Campaign
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
