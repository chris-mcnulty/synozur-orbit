import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Loader2, Trash2, Edit2, Wand2, Globe, FileText, LayoutList, LayoutGrid, ArrowUpDown, Table as TableIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV, type CSVExportItem } from "@/lib/csv-export";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ProductFeature {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  priority: string | null;
  targetQuarter: string | null;
  targetYear: number | null;
  sourceType: string;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  companyName: string | null;
}

const CATEGORIES = [
  { value: "core", label: "Core Features" },
  { value: "security", label: "Security" },
  { value: "analytics", label: "Analytics" },
  { value: "integration", label: "Integrations" },
  { value: "ux", label: "User Experience" },
  { value: "performance", label: "Performance" },
  { value: "api", label: "API & Developer" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "backlog", label: "Backlog" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "released", label: "Released" },
];

const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface FeaturesTabProps {
  productId: string;
  product?: Product;
}

export default function FeaturesTab({ productId, product }: FeaturesTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<ProductFeature | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importTab, setImportTab] = useState<"url" | "text">("url");
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    status: "planned",
    priority: "",
    targetQuarter: "",
    targetYear: new Date().getFullYear(),
  });
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");
  const [sortOrder, setSortOrder] = useState<"name" | "status" | "priority" | "category">("name");

  const { data: features = [], isLoading } = useQuery<ProductFeature[]>({
    queryKey: ["/api/products", productId, "features"],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/features`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch features");
      return res.json();
    },
  });

  const createFeature = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch(`/api/products/${productId}/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create feature");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "features"] });
      setIsAddOpen(false);
      resetForm();
      toast({ title: "Feature Created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateFeature = useMutation({
    mutationFn: async ({ featureId, data }: { featureId: string; data: typeof formData }) => {
      const res = await fetch(`/api/products/${productId}/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update feature");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "features"] });
      setIsEditOpen(false);
      setEditingFeature(null);
      resetForm();
      toast({ title: "Feature Updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteFeature = useMutation({
    mutationFn: async (featureId: string) => {
      const res = await fetch(`/api/products/${productId}/features/${featureId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete feature");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "features"] });
      toast({ title: "Feature Deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      category: "",
      status: "planned",
      priority: "",
      targetQuarter: "",
      targetYear: new Date().getFullYear(),
    });
  };

  const handleEdit = (feature: ProductFeature) => {
    setEditingFeature(feature);
    setFormData({
      name: feature.name,
      description: feature.description || "",
      category: feature.category || "",
      status: feature.status,
      priority: feature.priority || "",
      targetQuarter: feature.targetQuarter || "",
      targetYear: feature.targetYear || new Date().getFullYear(),
    });
    setIsEditOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData = {
      ...formData,
      targetQuarter: formData.targetQuarter === "__none__" ? "" : formData.targetQuarter
    };
    createFeature.mutate(submitData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingFeature) {
      const submitData = {
        ...formData,
        targetQuarter: formData.targetQuarter === "__none__" ? "" : formData.targetQuarter
      };
      updateFeature.mutate({ featureId: editingFeature.id, data: submitData });
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const endpoint = importTab === "url" 
        ? `/api/products/${productId}/features/import-url`
        : `/api/products/${productId}/features/import-text`;
      
      const body = importTab === "url" ? { url: importUrl } : { text: importText };
      
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Import failed");
      }
      
      const result = await res.json();
      setImportResult({ imported: result.features?.length || 0 });
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "features"] });
      toast({ title: "Import Complete", description: `Imported ${result.features?.length || 0} features` });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const sortedFeatures = React.useMemo(() => {
    const sorted = [...features];
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const statusOrder = { released: 0, in_progress: 1, planned: 2, backlog: 3 };
    
    sorted.sort((a, b) => {
      switch (sortOrder) {
        case "name":
          return a.name.localeCompare(b.name);
        case "status":
          return (statusOrder[a.status as keyof typeof statusOrder] ?? 99) - 
                 (statusOrder[b.status as keyof typeof statusOrder] ?? 99);
        case "priority":
          return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 99) - 
                 (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 99);
        case "category":
          return (a.category || "zzz").localeCompare(b.category || "zzz");
        default:
          return 0;
      }
    });
    return sorted;
  }, [features, sortOrder]);

  const groupedFeatures = React.useMemo(() => {
    const groups: Record<string, ProductFeature[]> = {};
    for (const feature of sortedFeatures) {
      const key = feature.category || "uncategorized";
      if (!groups[key]) groups[key] = [];
      groups[key].push(feature);
    }
    const categoryOrder = CATEGORIES.map(c => c.value);
    return Object.entries(groups).sort((a, b) => {
      const aIdx = categoryOrder.indexOf(a[0]);
      const bIdx = categoryOrder.indexOf(b[0]);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
  }, [sortedFeatures]);

  const getCategoryLabel = (value: string) => {
    return CATEGORIES.find(c => c.value === value)?.label || "Uncategorized";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "released": return <Badge className="bg-green-500/20 text-green-400">Released</Badge>;
      case "in_progress": return <Badge className="bg-blue-500/20 text-blue-400">In Progress</Badge>;
      case "planned": return <Badge className="bg-yellow-500/20 text-yellow-400">Planned</Badge>;
      default: return <Badge variant="outline">Backlog</Badge>;
    }
  };

  const getCategoryBadge = (category: string | null) => {
    if (!category) return null;
    const cat = CATEGORIES.find(c => c.value === category.toLowerCase());
    return <Badge variant="secondary">{cat?.label || category}</Badge>;
  };

  const FeatureForm = ({ onSubmit, isEdit = false }: { onSubmit: (e: React.FormEvent) => void; isEdit?: boolean }) => (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Feature" : "Add Feature"}</DialogTitle>
        <DialogDescription>{isEdit ? "Update the feature details." : "Add a new feature to track."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label>Name *</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Feature name"
            required
            data-testid="input-feature-name"
          />
        </div>
        <div className="grid gap-2">
          <Label>Description</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Feature description"
            data-testid="input-feature-description"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
              <SelectTrigger data-testid="select-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
              <SelectTrigger data-testid="select-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Priority</Label>
            <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
              <SelectTrigger data-testid="select-priority">
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Target Quarter</Label>
            <Select value={formData.targetQuarter} onValueChange={(v) => setFormData({ ...formData, targetQuarter: v })}>
              <SelectTrigger data-testid="select-quarter">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                <SelectItem value="Q1">Q1</SelectItem>
                <SelectItem value="Q2">Q2</SelectItem>
                <SelectItem value="Q3">Q3</SelectItem>
                <SelectItem value="Q4">Q4</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={createFeature.isPending || updateFeature.isPending} data-testid="button-save-feature">
          {(createFeature.isPending || updateFeature.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Update Feature" : "Add Feature"}
        </Button>
      </DialogFooter>
    </form>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Product Features</h3>
          <p className="text-sm text-muted-foreground">
            Track and manage features for {product?.name || "this product"}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center border rounded-lg">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="rounded-r-none"
              data-testid="button-view-list"
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grouped" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grouped")}
              className="rounded-l-none"
              data-testid="button-view-grouped"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
            <SelectTrigger className="w-[140px]" data-testid="select-sort-features">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="category">Category</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={isImportOpen} onOpenChange={(open) => {
            setIsImportOpen(open);
            if (!open) {
              setImportUrl("");
              setImportText("");
              setImportResult(null);
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-features">
                <Wand2 className="mr-2 h-4 w-4" />
                Import with AI
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Features with AI</DialogTitle>
                <DialogDescription>
                  Extract features from a competitor's website or paste text from product documentation.
                </DialogDescription>
              </DialogHeader>
              <Tabs value={importTab} onValueChange={(v) => setImportTab(v as "url" | "text")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="url" className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    From URL
                  </TabsTrigger>
                  <TabsTrigger value="text" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Paste Text
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="url" className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Website URL</Label>
                    <Input
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder="https://example.com/features"
                      data-testid="input-import-url"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter a competitor's features page or product documentation URL.
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="text" className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Paste Content</Label>
                    <Textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="Paste feature descriptions, release notes, or product documentation here..."
                      rows={8}
                      data-testid="input-import-text"
                    />
                    <p className="text-xs text-muted-foreground">
                      Paste at least 50 characters of text describing product features.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
              {importResult && (
                <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400">
                  Successfully imported {importResult.imported} features!
                </div>
              )}
              <DialogFooter>
                <Button 
                  onClick={handleImport} 
                  disabled={isImporting || (importTab === "url" ? !importUrl : importText.length < 50)}
                  data-testid="button-extract-features"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-4 w-4" />
                      Extract Features
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {features.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                const featuresToExport = features.map((f): CSVExportItem => ({
                  title: f.name || "",
                  description: f.description || "",
                  category: f.category || "other",
                }));
                exportToCSV(featuresToExport, "Product_Features");
              }}
              data-testid="button-export-features-csv"
            >
              <TableIcon className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-feature">
                <Plus className="mr-2 h-4 w-4" />
                Add Feature
              </Button>
            </DialogTrigger>
            <DialogContent>
              <FeatureForm onSubmit={handleSubmit} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {features.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No features tracked yet</p>
            <p className="text-sm text-muted-foreground">
              Add features manually or import them from a website using AI.
            </p>
          </CardContent>
        </Card>
      ) : viewMode === "list" ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFeatures.map((feature) => (
                  <TableRow key={feature.id} data-testid={`feature-row-${feature.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{feature.name}</p>
                        {feature.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{feature.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getCategoryBadge(feature.category)}</TableCell>
                    <TableCell>{getStatusBadge(feature.status)}</TableCell>
                    <TableCell>
                      {feature.priority && (
                        <Badge variant="outline" className={
                          feature.priority === "high" ? "border-red-500/50 text-red-400" :
                          feature.priority === "medium" ? "border-yellow-500/50 text-yellow-400" :
                          "border-green-500/50 text-green-400"
                        }>
                          {feature.priority}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {feature.targetQuarter && (
                        <span className="text-sm text-muted-foreground">
                          {feature.targetQuarter} {feature.targetYear}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(feature)} data-testid={`edit-feature-${feature.id}`}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteFeature.mutate(feature.id)}
                          className="text-destructive"
                          data-testid={`delete-feature-${feature.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedFeatures.map(([category, categoryFeatures]) => (
            <Card key={category}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  {getCategoryBadge(category)}
                  <span className="text-muted-foreground font-normal">({categoryFeatures.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryFeatures.map((feature) => (
                      <TableRow key={feature.id} data-testid={`feature-row-${feature.id}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{feature.name}</p>
                            {feature.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{feature.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(feature.status)}</TableCell>
                        <TableCell>
                          {feature.priority && (
                            <Badge variant="outline" className={
                              feature.priority === "high" ? "border-red-500/50 text-red-400" :
                              feature.priority === "medium" ? "border-yellow-500/50 text-yellow-400" :
                              "border-green-500/50 text-green-400"
                            }>
                              {feature.priority}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {feature.targetQuarter && (
                            <span className="text-sm text-muted-foreground">
                              {feature.targetQuarter} {feature.targetYear}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(feature)} data-testid={`edit-feature-${feature.id}`}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteFeature.mutate(feature.id)}
                              className="text-destructive"
                              data-testid={`delete-feature-${feature.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <FeatureForm onSubmit={handleEditSubmit} isEdit />
        </DialogContent>
      </Dialog>
    </div>
  );
}
