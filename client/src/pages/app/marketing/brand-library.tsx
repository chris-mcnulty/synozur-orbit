import { useState, useEffect, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ImageIcon, Plus, Search, ExternalLink, Trash2, Lock, Settings, ChevronDown, X, Tag, Filter,
  Download, Upload, LayoutGrid, List
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { exportBrandAssetsToCSV, parseCSV } from "@/lib/csv-export";

interface BrandAsset {
  id: string;
  name: string;
  description?: string;
  url?: string;
  fileUrl?: string;
  fileType?: string;
  categoryId?: string;
  productIds?: string[];
  tags?: { seasons?: string[]; locations?: string[]; topics?: string[] };
  sourceContentAssetId?: string;
  status: string;
  createdAt: string;
}

interface BrandAssetCategory {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  isBaseline: boolean;
}

const TOPIC_OPTIONS = [
  "Modern Workplace", "Digital Transformation", "Cloud", "Security",
  "AI & Machine Learning", "Collaboration", "Productivity", "Remote Work",
  "Sustainability", "Innovation", "Leadership", "Customer Success",
];

const SEASON_OPTIONS = [
  "Spring", "Summer", "Fall", "Winter", "Q1", "Q2", "Q3", "Q4",
  "Holiday", "Back to School", "Year End",
];

export default function BrandLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [fileTypeFilter, setFileTypeFilter] = useState<string>("all");
  const [statusTab, setStatusTab] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: "", description: "", url: "", categoryId: "", fileType: "",
    productIds: [] as string[],
    tags: { seasons: [] as string[], topics: [] as string[] },
  });

  const resetForm = () => setForm({
    name: "", description: "", url: "", categoryId: "", fileType: "",
    productIds: [], tags: { seasons: [], topics: [] },
  });

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.brandLibrary === true;

  const { data: assets = [], isLoading } = useQuery<BrandAsset[]>({
    queryKey: ["/api/brand-assets"],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: categories = [] } = useQuery<BrandAssetCategory[]>({
    queryKey: ["/api/brand-asset-categories"],
    queryFn: async () => {
      const r = await fetch("/api/brand-asset-categories", { credentials: "include" });
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
      fetch("/api/brand-asset-categories/seed-defaults", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).then(r => {
        if (r.ok) queryClient.invalidateQueries({ queryKey: ["/api/brand-asset-categories"] });
      });
    }
  }, [isAllowed, categories.length]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch("/api/brand-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          tags: (data.tags.seasons.length || data.tags.topics.length) ? data.tags : null,
          productIds: data.productIds.length ? data.productIds : null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });
      setAddOpen(false);
      resetForm();
      toast({ title: "Brand asset added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/brand-assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "archived" }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] }),
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch("/api/brand-asset-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-asset-categories"] });
      setNewCategoryName("");
      toast({ title: "Category added" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/brand-asset-categories/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/brand-asset-categories"] }),
  });

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

  const filtered = assets.filter(a => {
    const matchesSearch = !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || a.categoryId === categoryFilter;
    const matchesFileType = fileTypeFilter === "all" || a.fileType === fileTypeFilter;
    const matchesStatus = statusTab === "all" ||
      (statusTab === "active" && a.status === "active") ||
      (statusTab === "archived" && a.status === "archived");
    return matchesSearch && matchesCategory && matchesFileType && matchesStatus;
  });

  const groupedByCategory = () => {
    const groups: Record<string, BrandAsset[]> = {};
    for (const asset of filtered) {
      const catName = categoryName(asset.categoryId) || "Uncategorized";
      if (!groups[catName]) groups[catName] = [];
      groups[catName].push(asset);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const categoryName = (id?: string) => categories.find(c => c.id === id)?.name;
  const productName = (id: string) => marketProducts.find(p => p.id === id)?.name;

  const handleExportCSV = () => {
    const rows = filtered.map(a => ({
      name: a.name,
      description: a.description || "",
      url: a.url || "",
      category: categoryName(a.categoryId) || "",
      status: a.status,
      fileType: a.fileType || "",
      createdDate: new Date(a.createdAt).toLocaleDateString(),
    }));
    exportBrandAssetsToCSV(rows, "brand-library");
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
    for (const row of rows) {
      const name = row["Name"] || "";
      if (!name.trim()) { failed++; continue; }
      const catName = row["Category"] || "";
      const matchedCategory = categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
      try {
        const r = await fetch("/api/brand-assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name,
            description: row["Description"] || "",
            url: row["URL"] || "",
            categoryId: matchedCategory?.id || "",
            fileType: (row["File Type"] || "").toLowerCase(),
            status: (row["Status"] || "active").toLowerCase() === "archived" ? "archived" : "active",
          }),
        });
        if (r.ok) imported++; else failed++;
      } catch { failed++; }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });
    toast({
      title: "Import complete",
      description: `${imported} assets imported${failed > 0 ? `, ${failed} failed` : ""}.`,
    });
    if (importFileRef.current) importFileRef.current.value = "";
  };

  const renderAssetCard = (asset: BrandAsset) => (
    <Card key={asset.id} className="group" data-testid={`card-brand-asset-${asset.id}`}>
      {asset.url && (asset.fileType === "image" || asset.fileType === "png" || asset.fileType === "jpg" || asset.fileType === "svg") && (
        <div className="aspect-video overflow-hidden rounded-t-lg bg-muted flex items-center justify-center p-4">
          <img
            src={asset.url}
            alt={asset.name}
            className="max-w-full max-h-full object-contain"
            onError={e => (e.currentTarget.style.display = "none")}
          />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{asset.name}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 shrink-0 h-7 w-7"
            onClick={() => archiveMutation.mutate(asset.id)}
            data-testid={`button-archive-brand-${asset.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {categoryName(asset.categoryId) && <Badge variant="outline" className="text-xs">{categoryName(asset.categoryId)}</Badge>}
          {asset.fileType && <Badge variant="secondary" className="text-xs">{asset.fileType.toUpperCase()}</Badge>}
          {asset.sourceContentAssetId && <Badge variant="secondary" className="text-xs">From Content</Badge>}
          {asset.status === "archived" && <Badge variant="secondary" className="text-xs">Archived</Badge>}
          {asset.productIds?.map(pid => (
            <Badge key={pid} variant="outline" className="text-xs text-primary">{productName(pid) || pid}</Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {asset.description && <p className="text-sm text-muted-foreground">{asset.description}</p>}
        {asset.url && (
          <a href={asset.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
            <ExternalLink className="w-3 h-3" />
            <span className="truncate">{asset.url}</span>
          </a>
        )}
        {asset.tags && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.topics?.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            {asset.tags.seasons?.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const uniqueFileTypes = [...new Set(assets.map(a => a.fileType).filter(Boolean))] as string[];

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center" data-testid="card-locked-brand-library">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Brand Library</CardTitle>
              <CardDescription>Available on the Enterprise plan. Store approved logos, visuals, and brand templates to maintain consistency across all marketing output.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" data-testid="button-contact-sales-brand">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Brand Library">Contact Sales</a>
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
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-brand-library-title">
                <ImageIcon className="w-6 h-6" /> Brand Library
              </h1>
              <p className="text-muted-foreground text-sm mt-1">Brand-approved visual assets, logos, and templates for consistent marketing output.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImportCSV}
                data-testid="input-import-csv-brand"
              />
              <Button variant="outline" size="sm" onClick={() => importFileRef.current?.click()} data-testid="button-import-csv-brand">
                <Upload className="w-4 h-4 mr-1" /> Import CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0} data-testid="button-export-csv-brand">
                <Download className="w-4 h-4 mr-1" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => setManageCategoriesOpen(true)} data-testid="button-manage-brand-categories">
                <Settings className="w-4 h-4 mr-1" /> Categories
              </Button>
              <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) resetForm(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-brand-asset"><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add Brand Asset</DialogTitle>
                    <DialogDescription>Add a logo, image, template, or other brand asset.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Name *</Label>
                      <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Primary Logo" data-testid="input-brand-name" />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Usage notes" data-testid="input-brand-description" />
                    </div>
                    <div>
                      <Label>URL or File Path</Label>
                      <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." data-testid="input-brand-url" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Category</Label>
                        <Select value={form.categoryId || "none"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                          <SelectTrigger data-testid="select-brand-category"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No category</SelectItem>
                            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>File Type</Label>
                        <Select value={form.fileType || "none"} onValueChange={v => setForm(f => ({ ...f, fileType: v === "none" ? "" : v }))}>
                          <SelectTrigger data-testid="select-brand-filetype"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not specified</SelectItem>
                            <SelectItem value="png">PNG</SelectItem>
                            <SelectItem value="jpg">JPG</SelectItem>
                            <SelectItem value="svg">SVG</SelectItem>
                            <SelectItem value="pdf">PDF</SelectItem>
                            <SelectItem value="image">Image (other)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label>Products</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-brand-select-products">
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

                    <Button
                      className="w-full"
                      disabled={!form.name.trim() || createMutation.isPending}
                      onClick={() => createMutation.mutate(form)}
                      data-testid="button-save-brand-asset"
                    >
                      {createMutation.isPending ? "Adding..." : "Add Asset"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        <Tabs value={statusTab} onValueChange={setStatusTab}>
          <div className="flex items-center justify-between gap-3">
            <TabsList data-testid="tabs-brand-status">
              <TabsTrigger value="all" data-testid="tab-brand-all">All</TabsTrigger>
              <TabsTrigger value="active" data-testid="tab-brand-active">Active</TabsTrigger>
              <TabsTrigger value="archived" data-testid="tab-brand-archived">Archived</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "flat" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("flat")}
                data-testid="button-view-flat-brand"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "grouped" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grouped")}
                data-testid="button-view-grouped-brand"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Tabs>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search brand assets..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-brand" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48" data-testid="select-filter-brand-category">
              <Filter className="w-4 h-4 mr-1" />
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
            <SelectTrigger className="w-40" data-testid="select-filter-brand-filetype">
              <SelectValue placeholder="All file types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All file types</SelectItem>
              {uniqueFileTypes.map(ft => <SelectItem key={ft} value={ft}>{ft.toUpperCase()}</SelectItem>)}
              {uniqueFileTypes.length === 0 && (
                <>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpg">JPG</SelectItem>
                  <SelectItem value="svg">SVG</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty-brand">
              {assets.length === 0 ? "No brand assets yet. Add your first asset to get started." : "No assets match your search or filter."}
            </CardContent>
          </Card>
        ) : viewMode === "grouped" ? (
          <div className="space-y-6">
            {groupedByCategory().map(([catName, catAssets]) => (
              <div key={catName} data-testid={`group-brand-${catName.toLowerCase().replace(/\s+/g, "-")}`}>
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

        {/* Manage Categories Dialog */}
        <Dialog open={manageCategoriesOpen} onOpenChange={setManageCategoriesOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Manage Brand Categories</DialogTitle>
              <DialogDescription>Add or remove brand asset categories for your tenant.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  data-testid="input-new-brand-category"
                />
                <Button
                  size="sm"
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  onClick={() => createCategoryMutation.mutate(newCategoryName)}
                  data-testid="button-add-brand-category"
                >
                  Add
                </Button>
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {categories.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                    <span className="text-sm">{c.name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteCategoryMutation.mutate(c.id)}>
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
