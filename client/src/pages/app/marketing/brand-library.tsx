import { useState, useEffect, useRef } from "react";
import { OptimizedThumbnail } from "@/components/ui/optimized-thumbnail";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ImageIcon, Plus, Search, ExternalLink, Trash2, Lock, Settings, ChevronDown, X, Tag, Filter,
  Download, Upload, LayoutGrid, List, Archive, RotateCcw
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
  const [statusTab, setStatusTab] = useState<string>("active");
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<BrandAsset | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", description: "", url: "", fileUrl: "", categoryId: "", fileType: "",
    productIds: [] as string[],
    tags: { seasons: [] as string[], topics: [] as string[] },
  });
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
      if (!r.ok) {
        const text = await r.text();
        let msg = "Failed to create brand asset";
        try { msg = JSON.parse(text).error || msg; } catch { msg = text || msg; }
        throw new Error(msg);
      }
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/brand-assets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });
      toast({ title: "Brand asset archived" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/brand-assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "active" }),
      });
      if (!r.ok) throw new Error("Restore failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });
      toast({ title: "Brand asset restored" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      const r = await fetch(`/api/brand-assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          url: data.url,
          fileUrl: data.fileUrl || null,
          fileType: data.fileType || null,
          categoryId: data.categoryId || null,
          productIds: data.productIds.length ? data.productIds : null,
          tags: (data.tags.seasons.length || data.tags.topics.length) ? data.tags : null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });
      setEditOpen(false);
      setEditAsset(null);
      toast({ title: "Brand asset updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    setUploadingFile(true);
    try {
      const reqRes = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!reqRes.ok) throw new Error((await reqRes.json()).error);
      const { uploadURL, objectPath } = await reqRes.json();

      const uploadRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!uploadRes.ok) throw new Error("File upload failed");

      setEditForm(f => ({ ...f, fileUrl: objectPath, fileType: file.type.startsWith("image/") ? "image" : "document" }));
      toast({ title: "File uploaded successfully" });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploadingFile(false);
    }
  };

  const openEditDialog = (asset: BrandAsset) => {
    setEditForm({
      name: asset.name,
      description: asset.description || "",
      url: asset.url || "",
      fileUrl: asset.fileUrl || "",
      categoryId: asset.categoryId || "",
      fileType: asset.fileType || "",
      productIds: asset.productIds || [],
      tags: {
        seasons: asset.tags?.seasons || [],
        topics: asset.tags?.topics || [],
      },
    });
    setEditAsset(asset);
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
    const matchesCategory = categoryFilter === "all" || (categoryFilter === "__uncategorized" ? !a.categoryId : a.categoryId === categoryFilter);
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
    <div key={asset.id} className="group cursor-pointer" onClick={() => openEditDialog(asset)} data-testid={`card-brand-asset-${asset.id}`}>
      {(() => {
        const imgSrc = asset.fileUrl || asset.url;
        const ft = (asset.fileType || "").toLowerCase();
        const isImage = ft === "image" || ft === "png" || ft === "jpg" || ft === "jpeg" || ft === "svg" || ft === "webp" || ft === "gif"
          || ft.startsWith("image/")
          || (!!imgSrc && /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(imgSrc));
        return imgSrc && isImage ? (
            <OptimizedThumbnail
              src={imgSrc}
              alt={asset.name}
              containerClassName="mb-2"
            >
              {categoryName(asset.categoryId) && (
                <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded z-10">
                  {categoryName(asset.categoryId)}
                </span>
              )}
            </OptimizedThumbnail>
          ) : (
            <div className="aspect-video overflow-hidden rounded-lg bg-muted relative mb-2">
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
              </div>
              {categoryName(asset.categoryId) && (
                <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                  {categoryName(asset.categoryId)}
                </span>
              )}
            </div>
          );
      })()}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{asset.name}</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={e => { e.stopPropagation(); openEditDialog(asset); }}
            data-testid={`button-edit-brand-${asset.id}`}
          >
            <Settings className="w-3 h-3" />
          </Button>
          {asset.status === "archived" ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-green-500 hover:text-green-600"
              onClick={e => { e.stopPropagation(); restoreMutation.mutate(asset.id); }}
              title="Restore"
              data-testid={`button-restore-brand-${asset.id}`}
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={e => { e.stopPropagation(); deleteMutation.mutate(asset.id); }}
              title="Archive"
              data-testid={`button-archive-brand-${asset.id}`}
            >
              <Archive className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      {asset.tags && (
          <div className="flex flex-wrap gap-1 mt-1">
            {asset.tags.topics?.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            {asset.tags.seasons?.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
          </div>
        )}
    </div>
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
                <ImageIcon className="w-6 h-6" /> Brand Assets
              </h1>
              <p className="text-muted-foreground text-sm mt-1">Approved visuals for your marketing campaigns.</p>
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
                  <Button data-testid="button-add-brand-asset"><Plus className="w-4 h-4 mr-2" />Add Image</Button>
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
                              {p.name}
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

        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search brand assets..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-brand" />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center bg-muted rounded-md p-0.5" data-testid="status-toggle-brand">
              <button
                onClick={() => setStatusTab("active")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${statusTab === "active" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="button-status-active-brand"
              >
                Active
              </button>
              <button
                onClick={() => setStatusTab("archived")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${statusTab === "archived" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="button-status-archived-brand"
              >
                <Archive className="w-3 h-3" /> Archived
                {assets.filter(a => a.status === "archived").length > 0 && (
                  <span className="bg-muted-foreground/20 rounded-full px-1.5 text-[10px]">{assets.filter(a => a.status === "archived").length}</span>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap" data-testid="category-pills-brand">
          {(() => {
            const statusFiltered = assets.filter(a => statusTab === "all" || a.status === statusTab);
            const allCount = statusFiltered.length;
            const catCounts = new Map<string, number>();
            for (const a of statusFiltered) {
              const catId = a.categoryId || "__uncategorized";
              catCounts.set(catId, (catCounts.get(catId) || 0) + 1);
            }
            return (
              <>
                <button
                  onClick={() => setCategoryFilter("all")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  data-testid="pill-brand-category-all"
                >
                  All <span className="bg-white/20 rounded-full px-1.5 text-[10px]">{allCount}</span>
                </button>
                {categories.map(cat => {
                  const count = catCounts.get(cat.id) || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.id === categoryFilter ? "all" : cat.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === cat.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      data-testid={`pill-brand-category-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {cat.name} <span className={`rounded-full px-1.5 text-[10px] ${categoryFilter === cat.id ? "bg-white/20" : "bg-primary/20 text-primary"}`}>{count}</span>
                    </button>
                  );
                })}
                {(catCounts.get("__uncategorized") || 0) > 0 && (
                  <button
                    onClick={() => setCategoryFilter(categoryFilter === "__uncategorized" ? "all" : "__uncategorized")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === "__uncategorized" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    data-testid="pill-brand-category-uncategorized"
                  >
                    Uncategorized <span className={`rounded-full px-1.5 text-[10px] ${categoryFilter === "__uncategorized" ? "bg-white/20" : "bg-primary/20 text-primary"}`}>{catCounts.get("__uncategorized")}</span>
                  </button>
                )}
              </>
            );
          })()}
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty-brand">
              {assets.length === 0 ? "No brand assets yet. Add your first asset to get started." : statusTab === "archived" ? "No archived brand assets." : "No assets match your search or filter."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 items-start">
            {filtered.map(renderAssetCard)}
          </div>
        )}

        {/* Edit Brand Asset Dialog */}
        <Dialog open={editOpen} onOpenChange={v => { setEditOpen(v); if (!v) setEditAsset(null); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            {editAsset && (
              <>
                <DialogHeader>
                  <DialogTitle>Edit Brand Asset</DialogTitle>
                  <DialogDescription>Modify the brand asset details below.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Name *</Label>
                    <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} data-testid="input-edit-brand-name" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} data-testid="input-edit-brand-description" />
                  </div>
                  <div>
                    <Label>URL or File Path</Label>
                    <Input value={editForm.url} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))} data-testid="input-edit-brand-url" />
                    {(() => {
                      const previewSrc = editForm.fileUrl || editForm.url;
                      const ft = (editForm.fileType || "").toLowerCase();
                      const showPreview = previewSrc && (
                        ft === "image" || ft === "png" || ft === "jpg" || ft === "jpeg" || ft === "svg" || ft === "webp" || ft === "gif"
                        || ft.startsWith("image/")
                        || /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(previewSrc)
                      );
                      return showPreview ? (
                        <div className="mt-2 rounded-lg overflow-hidden bg-muted aspect-video flex items-center justify-center p-2">
                          <img src={previewSrc} alt={editForm.name} className="max-w-full max-h-full object-contain" onError={e => (e.currentTarget.parentElement!.style.display = "none")} />
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div>
                    <Label>Upload File</Label>
                    <div className="flex gap-2 items-center">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf,.docx,.doc,.txt"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={uploadingFile}
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="button-upload-brand-file"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingFile ? "Uploading..." : "Choose File"}
                      </Button>
                      {editForm.fileUrl && editForm.fileUrl.startsWith("/objects/") && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">File uploaded</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Category</Label>
                      <Select value={editForm.categoryId || "none"} onValueChange={v => setEditForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                        <SelectTrigger data-testid="select-edit-brand-category"><SelectValue placeholder="Select" /></SelectTrigger>
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
                          <Button variant="outline" className="w-full justify-between text-left font-normal" data-testid="button-edit-brand-select-products">
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
                  <Button
                    className="w-full"
                    disabled={!editForm.name.trim() || editMutation.isPending}
                    onClick={() => editMutation.mutate({ id: editAsset.id, data: editForm })}
                    data-testid="button-save-edit-brand"
                  >
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

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
