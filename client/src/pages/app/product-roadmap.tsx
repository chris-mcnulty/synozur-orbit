import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Loader2, Map, Trash2, Edit2, Calendar, Sparkles, CheckCircle, Clock, AlertCircle, Wand2, Globe, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";

interface RoadmapItem {
  id: string;
  productId: string;
  featureId: string | null;
  title: string;
  description: string | null;
  quarter: string | null;
  year: number | null;
  effort: string | null;
  status: string;
  aiRecommended: boolean;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
}

interface FeatureRecommendation {
  id: string;
  productId: string;
  type: string;
  title: string;
  explanation: string;
  suggestedPriority: string | null;
  suggestedQuarter: string | null;
  status: string;
  createdAt: string;
}

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const EFFORTS = [
  { value: "xs", label: "XS (1-2 days)" },
  { value: "s", label: "S (1 week)" },
  { value: "m", label: "M (2-4 weeks)" },
  { value: "l", label: "L (1-2 months)" },
  { value: "xl", label: "XL (3+ months)" },
];
const STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "deferred", label: "Deferred" },
];

export default function ProductRoadmap() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RoadmapItem | null>(null);
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importTab, setImportTab] = useState<"url" | "text">("url");
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    quarter: "",
    year: currentYear,
    effort: "m",
    status: "planned",
  });

  const { data: product } = useQuery<Product>({
    queryKey: ["/api/products", id],
    queryFn: async () => {
      const response = await fetch(`/api/products/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch product");
      return response.json();
    },
  });

  const { data: roadmapItems = [], isLoading } = useQuery<RoadmapItem[]>({
    queryKey: ["/api/products", id, "roadmap"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${id}/roadmap`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch roadmap");
      return response.json();
    },
  });

  const { data: recommendations = [] } = useQuery<FeatureRecommendation[]>({
    queryKey: ["/api/products", id, "recommendations"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${id}/recommendations`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch recommendations");
      return response.json();
    },
  });

  const createItem = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch(`/api/products/${id}/roadmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create roadmap item");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "roadmap"] });
      setIsAddOpen(false);
      resetForm();
      toast({ title: "Roadmap Item Created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({ itemId, data }: { itemId: string; data: Partial<RoadmapItem> }) => {
      const response = await fetch(`/api/products/${id}/roadmap/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update roadmap item");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "roadmap"] });
      setIsEditOpen(false);
      setEditingItem(null);
      toast({ title: "Roadmap Item Updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await fetch(`/api/products/${id}/roadmap/${itemId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete roadmap item");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "roadmap"] });
      toast({ title: "Roadmap Item Deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateRecommendations = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/products/${id}/recommendations/generate`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to generate recommendations");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "recommendations"] });
      toast({ title: "Recommendations Generated", description: "AI has analyzed your competitive landscape and generated roadmap recommendations." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateRecommendation = useMutation({
    mutationFn: async ({ recId, status }: { recId: string; status: string }) => {
      const response = await fetch(`/api/products/${id}/recommendations/${recId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update recommendation");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "recommendations"] });
      toast({ title: "Recommendation Updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      quarter: "",
      year: currentYear,
      effort: "m",
      status: "planned",
    });
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const endpoint = importTab === "url" 
        ? `/api/products/${id}/roadmap/import-url`
        : `/api/products/${id}/roadmap/import-text`;
      
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
      queryClient.invalidateQueries({ queryKey: ["/api/products", id, "roadmap"] });
      toast({ 
        title: "Roadmap Items Imported", 
        description: `Successfully imported ${result.imported} roadmap items using AI extraction.` 
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

  const openEdit = (item: RoadmapItem) => {
    setEditingItem(item);
    setFormData({
      title: item.title,
      description: item.description || "",
      quarter: item.quarter || "",
      year: item.year || currentYear,
      effort: item.effort || "m",
      status: item.status,
    });
    setIsEditOpen(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "in_progress": return <Clock className="h-4 w-4 text-blue-500" />;
      case "deferred": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default: return <Calendar className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getEffortBadge = (effort: string | null) => {
    const colors: Record<string, string> = {
      xs: "bg-green-500/20 text-green-400",
      s: "bg-green-500/20 text-green-400",
      m: "bg-yellow-500/20 text-yellow-400",
      l: "bg-orange-500/20 text-orange-400",
      xl: "bg-red-500/20 text-red-400",
    };
    return effort ? (
      <Badge className={colors[effort] || ""}>
        {effort.toUpperCase()}
      </Badge>
    ) : null;
  };

  const yearItems = roadmapItems.filter(item => item.year === selectedYear);
  const itemsByQuarter = QUARTERS.reduce((acc, q) => {
    acc[q] = yearItems.filter(item => item.quarter === q);
    return acc;
  }, {} as Record<string, RoadmapItem[]>);
  const unscheduledItems = roadmapItems.filter(item => !item.quarter || !item.year);

  const RoadmapForm = ({ onSubmit, isEdit = false }: { onSubmit: (e: React.FormEvent) => void; isEdit?: boolean }) => (
    <form onSubmit={onSubmit}>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Launch SSO Integration"
            required
            data-testid="input-title"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the roadmap item..."
            rows={3}
            data-testid="input-description"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Quarter</Label>
            <Select value={formData.quarter} onValueChange={(v) => setFormData({ ...formData, quarter: v })}>
              <SelectTrigger data-testid="select-quarter">
                <SelectValue placeholder="Select quarter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unscheduled__">Unscheduled</SelectItem>
                {QUARTERS.map((q) => (
                  <SelectItem key={q} value={q}>{q}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Year</Label>
            <Input
              type="number"
              value={formData.year}
              onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || currentYear })}
              data-testid="input-year"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Effort</Label>
            <Select value={formData.effort} onValueChange={(v) => setFormData({ ...formData, effort: v })}>
              <SelectTrigger data-testid="select-effort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EFFORTS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
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
      </div>
      <DialogFooter>
        <Button type="submit" disabled={createItem.isPending || updateItem.isPending} data-testid="button-save-item">
          {(createItem.isPending || updateItem.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Update Item" : "Add Item"}
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
                <h1 className="text-2xl font-bold" data-testid="text-page-title">{product.name} - Roadmap</h1>
                <p className="text-muted-foreground">Plan and track your product roadmap</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/app/products/${id}/features`}>
                <Button variant="outline" data-testid="button-view-features">
                  View Features
                </Button>
              </Link>
              <Dialog open={isImportOpen} onOpenChange={(open) => { if (!open) resetImport(); else setIsImportOpen(true); }}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-import-roadmap">
                    <Wand2 className="mr-2 h-4 w-4" />
                    Import
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Import Roadmap with AI</DialogTitle>
                    <DialogDescription>
                      Extract roadmap items from a competitor's website or paste text from product announcements.
                    </DialogDescription>
                  </DialogHeader>
                  {importResult ? (
                    <div className="py-8 text-center">
                      <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                      <p className="text-lg font-semibold">{importResult.imported} roadmap items imported</p>
                      <p className="text-muted-foreground text-sm mt-2">
                        Items have been added to your roadmap.
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
                              placeholder="https://competitor.com/roadmap"
                              value={importUrl}
                              onChange={(e) => setImportUrl(e.target.value)}
                              data-testid="input-import-url"
                            />
                            <p className="text-xs text-muted-foreground">
                              Enter a competitor's roadmap page or product announcements URL.
                            </p>
                          </div>
                        </div>
                      </TabsContent>
                      <TabsContent value="text" className="mt-4">
                        <div className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="import-text">Roadmap Text</Label>
                            <Textarea
                              id="import-text"
                              placeholder="Paste roadmap items, product announcements, or release notes..."
                              value={importText}
                              onChange={(e) => setImportText(e.target.value)}
                              rows={8}
                              data-testid="input-import-text"
                            />
                            <p className="text-xs text-muted-foreground">
                              AI will analyze the text and extract roadmap items.
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
                              Extract Items
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
                  <Button data-testid="button-add-item">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Item
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Roadmap Item</DialogTitle>
                    <DialogDescription>Add a new item to your product roadmap.</DialogDescription>
                  </DialogHeader>
                  <RoadmapForm onSubmit={(e) => { 
                    e.preventDefault(); 
                    const submitData = { ...formData, quarter: formData.quarter === "__unscheduled__" ? "" : formData.quarter };
                    createItem.mutate(submitData); 
                  }} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-6">
            <Button
              variant={selectedYear === currentYear - 1 ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedYear(currentYear - 1)}
            >
              {currentYear - 1}
            </Button>
            <Button
              variant={selectedYear === currentYear ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedYear(currentYear)}
            >
              {currentYear}
            </Button>
            <Button
              variant={selectedYear === currentYear + 1 ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedYear(currentYear + 1)}
            >
              {currentYear + 1}
            </Button>
          </div>

          <Card className="mb-6 border-primary/50 bg-primary/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  AI Recommendations
                  {recommendations.filter(r => r.status === "pending").length > 0 && (
                    <Badge className="bg-primary text-primary-foreground">
                      {recommendations.filter(r => r.status === "pending").length} pending
                    </Badge>
                  )}
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => generateRecommendations.mutate()}
                  disabled={generateRecommendations.isPending}
                  data-testid="button-generate-recommendations"
                >
                  {generateRecommendations.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Sparkles className="mr-2 h-4 w-4" /> Generate Recommendations</>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recommendations.filter(r => r.status === "pending").length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pending recommendations. Click "Generate Recommendations" to analyze your competitive landscape.
                </p>
              ) : (
                <div className="space-y-3">
                  {recommendations.filter(r => r.status === "pending").slice(0, 5).map((rec) => (
                    <div key={rec.id} className="p-3 rounded-lg bg-background border" data-testid={`rec-${rec.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className={
                              rec.type === "gap" ? "border-red-500/50 text-red-400" :
                              rec.type === "opportunity" ? "border-green-500/50 text-green-400" :
                              rec.type === "priority" ? "border-yellow-500/50 text-yellow-400" :
                              "border-orange-500/50 text-orange-400"
                            }>
                              {rec.type.charAt(0).toUpperCase() + rec.type.slice(1)}
                            </Badge>
                            {rec.suggestedPriority && (
                              <Badge variant="secondary" className="text-xs">
                                {rec.suggestedPriority} priority
                              </Badge>
                            )}
                            {rec.suggestedQuarter && (
                              <Badge variant="secondary" className="text-xs">
                                {rec.suggestedQuarter}
                              </Badge>
                            )}
                          </div>
                          <p className="font-medium text-sm">{rec.title}</p>
                          <p className="text-sm text-muted-foreground mt-1">{rec.explanation}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateRecommendation.mutate({ recId: rec.id, status: "accepted" })}
                            className="text-green-500 hover:text-green-600"
                            data-testid={`accept-${rec.id}`}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateRecommendation.mutate({ recId: rec.id, status: "dismissed" })}
                            className="text-muted-foreground"
                            data-testid={`dismiss-${rec.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {QUARTERS.map((quarter) => (
                <Card key={quarter} className="min-h-[300px]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center justify-between">
                      {quarter} {selectedYear}
                      <Badge variant="outline">{itemsByQuarter[quarter]?.length || 0}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {itemsByQuarter[quarter]?.map((item) => (
                      <Card key={item.id} className="bg-muted/50 cursor-pointer hover:bg-muted/80" data-testid={`card-item-${item.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              {getStatusIcon(item.status)}
                              <div>
                                <p className="font-medium text-sm">{item.title}</p>
                                {item.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {getEffortBadge(item.effort)}
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(item)}>
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={() => deleteItem.mutate(item.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          {item.aiRecommended && (
                            <Badge className="mt-2 bg-primary/20 text-primary text-xs">
                              <Sparkles className="h-3 w-3 mr-1" />
                              AI Suggested
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    {(!itemsByQuarter[quarter] || itemsByQuarter[quarter].length === 0) && (
                      <p className="text-sm text-muted-foreground text-center py-4">No items</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {unscheduledItems.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-base">Backlog / Unscheduled</CardTitle>
                <CardDescription>{unscheduledItems.length} items without a target date</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {unscheduledItems.map((item) => (
                    <Card key={item.id} className="bg-muted/50">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm truncate">{item.title}</p>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(item)}>
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Roadmap Item</DialogTitle>
            <DialogDescription>Update the roadmap item details.</DialogDescription>
          </DialogHeader>
          <RoadmapForm onSubmit={(e) => { 
          e.preventDefault(); 
          if (editingItem) {
            const submitData = { ...formData, quarter: formData.quarter === "__unscheduled__" ? "" : formData.quarter };
            updateItem.mutate({ itemId: editingItem.id, data: submitData }); 
          }
        }} isEdit />
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
