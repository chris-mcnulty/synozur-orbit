import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
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
import { ArrowLeft, Plus, Loader2, Package, Trash2, Edit2, Upload, FileText, Wand2, CheckCircle, Link2, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";

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

export default function ProductFeatures() {
  const { id } = useParams<{ id: string }>();
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
    priority: "medium",
    targetQuarter: "",
    targetYear: new Date().getFullYear(),
  });

  const { data: product } = useQuery<Product>({
    queryKey: ["/api/products", id],
    queryFn: async () => {
      const response = await fetch(`/api/products/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch product");
      return response.json();
    },
  });

  const { data: features = [], isLoading } = useQuery<ProductFeature[]>({
    queryKey: ["/api/products", id, "features"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${id}/features`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch features");
      return response.json();
    },
  });

  const createFeature = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch(`/api/products/${id}/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create feature");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "features"] });
      setIsAddOpen(false);
      resetForm();
      toast({ title: "Feature Created", description: "The feature has been added to your catalog." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateFeature = useMutation({
    mutationFn: async ({ featureId, data }: { featureId: string; data: Partial<ProductFeature> }) => {
      const response = await fetch(`/api/products/${id}/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update feature");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "features"] });
      setIsEditOpen(false);
      setEditingFeature(null);
      toast({ title: "Feature Updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteFeature = useMutation({
    mutationFn: async (featureId: string) => {
      const response = await fetch(`/api/products/${id}/features/${featureId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete feature");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "features"] });
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
      priority: "medium",
      targetQuarter: "",
      targetYear: new Date().getFullYear(),
    });
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const endpoint = importTab === "url" 
        ? `/api/products/${id}/features/import-url`
        : `/api/products/${id}/features/import-text`;
      
      const body = importTab === "url" 
        ? { url: importUrl }
        : { text: importText };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import failed");
      }

      const result = await response.json();
      setImportResult({ imported: result.imported });
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "features"] });
      toast({ 
        title: "Features Imported", 
        description: `Successfully imported ${result.imported} features using AI extraction.` 
      });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const resetImport = () => {
    setImportUrl("");
    setImportText("");
    setImportResult(null);
    setIsImportOpen(false);
  };

  const openEdit = (feature: ProductFeature) => {
    setEditingFeature(feature);
    setFormData({
      name: feature.name,
      description: feature.description || "",
      category: feature.category || "",
      status: feature.status,
      priority: feature.priority || "medium",
      targetQuarter: feature.targetQuarter || "",
      targetYear: feature.targetYear || new Date().getFullYear(),
    });
    setIsEditOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createFeature.mutate(formData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingFeature) {
      updateFeature.mutate({ featureId: editingFeature.id, data: formData });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "released":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/50">Released</Badge>;
      case "in_progress":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/50">In Progress</Badge>;
      case "planned":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">Planned</Badge>;
      case "backlog":
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/50">Backlog</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string | null) => {
    switch (priority) {
      case "high":
        return <Badge variant="outline" className="border-red-500/50 text-red-400">High</Badge>;
      case "medium":
        return <Badge variant="outline" className="border-yellow-500/50 text-yellow-400">Medium</Badge>;
      case "low":
        return <Badge variant="outline" className="border-green-500/50 text-green-400">Low</Badge>;
      default:
        return null;
    }
  };

  const FeatureForm = ({ onSubmit, isEdit = false }: { onSubmit: (e: React.FormEvent) => void; isEdit?: boolean }) => (
    <form onSubmit={onSubmit}>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Feature Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Single Sign-On Integration"
            required
            data-testid="input-feature-name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the feature..."
            rows={3}
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
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label>Priority</Label>
            <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
              <SelectTrigger data-testid="select-priority">
                <SelectValue />
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
                <SelectItem value="">None</SelectItem>
                <SelectItem value="Q1">Q1</SelectItem>
                <SelectItem value="Q2">Q2</SelectItem>
                <SelectItem value="Q3">Q3</SelectItem>
                <SelectItem value="Q4">Q4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Year</Label>
            <Input
              type="number"
              value={formData.targetYear}
              onChange={(e) => setFormData({ ...formData, targetYear: parseInt(e.target.value) || new Date().getFullYear() })}
              data-testid="input-year"
            />
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

  if (!product) {
    return (
      <AppLayout>
        <div className="flex-1 p-4 md:p-8 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Link href="/app/products">
                <Button variant="ghost" size="icon" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold" data-testid="text-page-title">{product.name} - Features</h1>
                <p className="text-muted-foreground">Manage your product feature catalog</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/app/products/${id}/roadmap`}>
                <Button variant="outline" data-testid="button-view-roadmap">
                  View Roadmap
                </Button>
              </Link>
              <Dialog open={isImportOpen} onOpenChange={(open) => { if (!open) resetImport(); else setIsImportOpen(true); }}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-import-features">
                    <Wand2 className="mr-2 h-4 w-4" />
                    Import
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Import Features with AI</DialogTitle>
                    <DialogDescription>
                      Extract features from a competitor's website or paste text from product documentation.
                    </DialogDescription>
                  </DialogHeader>
                  {importResult ? (
                    <div className="py-8 text-center">
                      <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                      <p className="text-lg font-semibold">{importResult.imported} features imported</p>
                      <p className="text-muted-foreground text-sm mt-2">
                        Features have been added to your catalog.
                      </p>
                      <Button onClick={resetImport} className="mt-4" data-testid="button-done-import">
                        Done
                      </Button>
                    </div>
                  ) : (
                    <Tabs value={importTab} onValueChange={(v) => setImportTab(v as "url" | "text")}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="url" data-testid="tab-import-url">
                          <Globe className="mr-2 h-4 w-4" />
                          From URL
                        </TabsTrigger>
                        <TabsTrigger value="text" data-testid="tab-import-text">
                          <FileText className="mr-2 h-4 w-4" />
                          Paste Text
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="url" className="mt-4">
                        <div className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="import-url">Website URL</Label>
                            <Input
                              id="import-url"
                              type="url"
                              placeholder="https://competitor.com/features"
                              value={importUrl}
                              onChange={(e) => setImportUrl(e.target.value)}
                              data-testid="input-import-url"
                            />
                            <p className="text-xs text-muted-foreground">
                              Enter a competitor's features page or product documentation URL.
                            </p>
                          </div>
                        </div>
                      </TabsContent>
                      <TabsContent value="text" className="mt-4">
                        <div className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="import-text">Feature Text</Label>
                            <Textarea
                              id="import-text"
                              placeholder="Paste feature descriptions, product documentation, or release notes..."
                              value={importText}
                              onChange={(e) => setImportText(e.target.value)}
                              rows={8}
                              data-testid="input-import-text"
                            />
                            <p className="text-xs text-muted-foreground">
                              AI will analyze the text and extract individual features.
                            </p>
                          </div>
                        </div>
                      </TabsContent>
                      <DialogFooter className="mt-4">
                        <Button 
                          onClick={handleImport} 
                          disabled={isImporting || (importTab === "url" ? !importUrl : importText.length < 50)}
                          data-testid="button-run-import"
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
                    </Tabs>
                  )}
                </DialogContent>
              </Dialog>
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-feature">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Feature
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Add Feature</DialogTitle>
                    <DialogDescription>Add a new feature to your product catalog.</DialogDescription>
                  </DialogHeader>
                  <FeatureForm onSubmit={handleSubmit} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{features.length}</div>
                <p className="text-muted-foreground text-sm">Total Features</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold text-green-400">
                  {features.filter(f => f.status === "released").length}
                </div>
                <p className="text-muted-foreground text-sm">Released</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold text-blue-400">
                  {features.filter(f => f.status === "in_progress").length}
                </div>
                <p className="text-muted-foreground text-sm">In Progress</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold text-yellow-400">
                  {features.filter(f => f.status === "planned" || f.status === "backlog").length}
                </div>
                <p className="text-muted-foreground text-sm">Planned/Backlog</p>
              </CardContent>
            </Card>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : features.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Features Yet</h3>
                <p className="text-muted-foreground text-center max-w-md mb-4">
                  Start building your product catalog by adding features manually or importing from a file.
                </p>
                <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-first-feature">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Your First Feature
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Feature Catalog</CardTitle>
                <CardDescription>{features.length} features</CardDescription>
              </CardHeader>
              <CardContent>
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
                    {features.map((feature) => (
                      <TableRow key={feature.id} data-testid={`row-feature-${feature.id}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{feature.name}</div>
                            {feature.description && (
                              <div className="text-sm text-muted-foreground line-clamp-1">{feature.description}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {feature.category && (
                            <Badge variant="outline">
                              {CATEGORIES.find(c => c.value === feature.category)?.label || feature.category}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(feature.status)}</TableCell>
                        <TableCell>{getPriorityBadge(feature.priority)}</TableCell>
                        <TableCell>
                          {feature.targetQuarter && feature.targetYear ? (
                            <span className="text-sm">{feature.targetQuarter} {feature.targetYear}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(feature)} data-testid={`button-edit-${feature.id}`}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteFeature.mutate(feature.id)}
                              className="text-destructive"
                              data-testid={`button-delete-${feature.id}`}
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
          )}
        </div>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Feature</DialogTitle>
            <DialogDescription>Update the feature details.</DialogDescription>
          </DialogHeader>
          <FeatureForm onSubmit={handleEditSubmit} isEdit />
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
