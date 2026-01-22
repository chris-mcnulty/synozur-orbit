import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Loader2, Trash2, Edit2, Calendar, Sparkles, CheckCircle, Clock, AlertCircle, Wand2, Globe, FileText, LayoutList, LayoutGrid, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

interface RoadmapTabProps {
  productId: string;
  product?: Product;
}

export default function RoadmapTab({ productId, product }: RoadmapTabProps) {
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
  const [viewMode, setViewMode] = useState<"quarter" | "effort">("quarter");
  const [sortOrder, setSortOrder] = useState<"title" | "status" | "effort">("title");

  const { data: roadmapItems = [], isLoading } = useQuery<RoadmapItem[]>({
    queryKey: ["/api/products", productId, "roadmap"],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/roadmap`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch roadmap");
      return res.json();
    },
  });

  const { data: recommendations = [] } = useQuery<FeatureRecommendation[]>({
    queryKey: ["/api/products", productId, "recommendations"],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/recommendations`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createItem = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch(`/api/products/${productId}/roadmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create roadmap item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "roadmap"] });
      setIsAddOpen(false);
      resetForm();
      toast({ title: "Roadmap Item Created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({ itemId, data }: { itemId: string; data: typeof formData }) => {
      const res = await fetch(`/api/products/${productId}/roadmap/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update roadmap item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "roadmap"] });
      setIsEditOpen(false);
      setEditingItem(null);
      resetForm();
      toast({ title: "Roadmap Item Updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/products/${productId}/roadmap/${itemId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete roadmap item");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "roadmap"] });
      toast({ title: "Roadmap Item Deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateRecommendations = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/products/${productId}/recommendations/generate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate recommendations");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "recommendations"] });
      toast({ title: "Recommendations Generated", description: "AI has analyzed your competitive landscape and generated roadmap recommendations." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateRecommendation = useMutation({
    mutationFn: async ({ recId, status }: { recId: string; status: string }) => {
      const res = await fetch(`/api/products/${productId}/recommendations/${recId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update recommendation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "recommendations"] });
      toast({ title: "Recommendation Updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addToRoadmap = useMutation({
    mutationFn: async (recId: string) => {
      const res = await fetch(`/api/products/${productId}/recommendations/${recId}/add-to-roadmap`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to add to roadmap");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "roadmap"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "recommendations"] });
      toast({ title: "Added to Roadmap", description: "The recommendation has been added to your roadmap." });
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

  const handleEdit = (item: RoadmapItem) => {
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

  const handleImport = async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const endpoint = importTab === "url"
        ? `/api/products/${productId}/roadmap/import-url`
        : `/api/products/${productId}/roadmap/import-text`;
      
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
      setImportResult({ imported: result.items?.length || 0 });
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "roadmap"] });
      toast({ title: "Import Complete", description: `Imported ${result.items?.length || 0} roadmap items` });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
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
    return effort ? <Badge className={colors[effort] || ""}>{effort.toUpperCase()}</Badge> : null;
  };

  const sortedRoadmapItems = React.useMemo(() => {
    const sorted = [...roadmapItems];
    const effortOrder = { xs: 0, s: 1, m: 2, l: 3, xl: 4 };
    const statusOrder = { in_progress: 0, planned: 1, completed: 2, deferred: 3 };
    
    sorted.sort((a, b) => {
      switch (sortOrder) {
        case "title":
          return a.title.localeCompare(b.title);
        case "status":
          return (statusOrder[a.status as keyof typeof statusOrder] ?? 99) - 
                 (statusOrder[b.status as keyof typeof statusOrder] ?? 99);
        case "effort":
          return (effortOrder[a.effort as keyof typeof effortOrder] ?? 99) - 
                 (effortOrder[b.effort as keyof typeof effortOrder] ?? 99);
        default:
          return 0;
      }
    });
    return sorted;
  }, [roadmapItems, sortOrder]);

  const itemsByQuarter: Record<string, RoadmapItem[]> = {};
  QUARTERS.forEach(q => {
    const filtered = sortedRoadmapItems.filter(item => item.quarter === q && item.year === selectedYear);
    itemsByQuarter[q] = filtered;
  });

  const itemsByEffort = React.useMemo(() => {
    const groups: Record<string, RoadmapItem[]> = {};
    const effortOrder = ["xs", "s", "m", "l", "xl", "unassigned"];
    
    for (const item of sortedRoadmapItems.filter(item => item.year === selectedYear)) {
      const key = item.effort || "unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    
    return effortOrder
      .filter(e => groups[e]?.length > 0)
      .map(e => [e, groups[e] || []] as [string, RoadmapItem[]]);
  }, [sortedRoadmapItems, selectedYear]);

  const getEffortLabel = (effort: string) => {
    const labels: Record<string, string> = {
      xs: "XS (1-2 days)",
      s: "S (1 week)",
      m: "M (2-4 weeks)",
      l: "L (1-2 months)",
      xl: "XL (3+ months)",
      unassigned: "No Effort Assigned"
    };
    return labels[effort] || effort.toUpperCase();
  };

  const unscheduledItems = roadmapItems.filter(item => !item.quarter || !item.year);

  const RoadmapForm = ({ onSubmit, isEdit = false }: { onSubmit: (e: React.FormEvent) => void; isEdit?: boolean }) => (
    <form onSubmit={onSubmit}>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label>Title *</Label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Roadmap item title"
            required
            data-testid="input-roadmap-title"
          />
        </div>
        <div className="grid gap-2">
          <Label>Description</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the work to be done"
            data-testid="input-roadmap-description"
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
                <SelectValue placeholder="Select effort" />
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
      </div>
      <DialogFooter>
        <Button type="submit" disabled={createItem.isPending || updateItem.isPending} data-testid="button-save-roadmap">
          {(createItem.isPending || updateItem.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Update Item" : "Add Item"}
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Recommendations
              </CardTitle>
              <CardDescription>
                Get AI-powered roadmap suggestions based on competitive intelligence
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => generateRecommendations.mutate()}
              disabled={generateRecommendations.isPending}
              data-testid="button-generate-recommendations"
            >
              {generateRecommendations.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Generate Recommendations
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
                        onClick={() => addToRoadmap.mutate(rec.id)}
                        className="text-primary hover:text-primary/80"
                        title="Add to Roadmap"
                        disabled={addToRoadmap.isPending}
                        data-testid={`add-to-roadmap-${rec.id}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateRecommendation.mutate({ recId: rec.id, status: "accepted" })}
                        className="text-green-500 hover:text-green-600"
                        title="Accept (without adding to roadmap)"
                        data-testid={`accept-${rec.id}`}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateRecommendation.mutate({ recId: rec.id, status: "dismissed" })}
                        className="text-muted-foreground"
                        title="Dismiss"
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
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
          <div className="border-l h-6" />
          <div className="flex items-center border rounded-lg">
            <Button
              variant={viewMode === "quarter" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("quarter")}
              className="rounded-r-none"
              data-testid="button-view-quarter"
              title="View by Quarter"
            >
              <Calendar className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "effort" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("effort")}
              className="rounded-l-none"
              data-testid="button-view-effort"
              title="View by Effort"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
            <SelectTrigger className="w-[130px]" data-testid="select-sort-roadmap">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="effort">Effort</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Dialog open={isImportOpen} onOpenChange={(open) => {
            setIsImportOpen(open);
            if (!open) {
              setImportUrl("");
              setImportText("");
              setImportResult(null);
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-roadmap">
                <Wand2 className="mr-2 h-4 w-4" />
                Import with AI
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Roadmap with AI</DialogTitle>
                <DialogDescription>
                  Extract roadmap items from a competitor's website or paste text.
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
                      placeholder="https://example.com/roadmap"
                      data-testid="input-import-url"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="text" className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Paste Content</Label>
                    <Textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="Paste roadmap content..."
                      rows={8}
                      data-testid="input-import-text"
                    />
                  </div>
                </TabsContent>
              </Tabs>
              {importResult && (
                <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400">
                  Successfully imported {importResult.imported} roadmap items!
                </div>
              )}
              <DialogFooter>
                <Button
                  onClick={handleImport}
                  disabled={isImporting || (importTab === "url" ? !importUrl : importText.length < 50)}
                  data-testid="button-extract-roadmap"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-4 w-4" />
                      Extract Roadmap
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-roadmap-item">
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

      {viewMode === "quarter" ? (
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
                  <div key={item.id} className="p-2 rounded border bg-card hover:bg-accent/50 transition-colors" data-testid={`roadmap-item-${item.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(item.status)}
                        <span className="text-sm font-medium">{item.title}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEdit(item)}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteItem.mutate(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {getEffortBadge(item.effort)}
                      {item.aiRecommended && <Badge variant="secondary" className="text-xs">AI</Badge>}
                    </div>
                  </div>
                ))}
                {(!itemsByQuarter[quarter] || itemsByQuarter[quarter].length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No items</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {itemsByEffort.map(([effort, items]) => (
            <Card key={effort}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getEffortBadge(effort !== "unassigned" ? effort : null)}
                    <span>{getEffortLabel(effort)}</span>
                  </div>
                  <Badge variant="outline">{items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {items.map((item) => (
                  <div key={item.id} className="p-2 rounded border bg-card hover:bg-accent/50 transition-colors" data-testid={`roadmap-item-${item.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(item.status)}
                        <span className="text-sm font-medium">{item.title}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEdit(item)}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteItem.mutate(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {item.quarter && (
                        <Badge variant="outline" className="text-xs">{item.quarter} {item.year}</Badge>
                      )}
                      {item.aiRecommended && <Badge variant="secondary" className="text-xs">AI</Badge>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          {itemsByEffort.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No roadmap items for {selectedYear}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {unscheduledItems.length > 0 && viewMode === "quarter" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Unscheduled</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {unscheduledItems.map((item) => (
              <div key={item.id} className="p-2 rounded border bg-card">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.title}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEdit(item)}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {getEffortBadge(item.effort)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
