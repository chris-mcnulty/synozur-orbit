import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Loader2, Package, Building, Sparkles, Trash2, Star, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";

interface Product {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  companyName: string | null;
  competitorId: string | null;
  tenantDomain: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectProduct {
  id: string;
  projectId: string;
  productId: string;
  role: "baseline" | "competitor" | "optional";
  source: "manual" | "suggested";
  createdAt: string;
  product: Product;
}

interface ClientProject {
  id: string;
  name: string;
  clientName: string;
  clientDomain: string | null;
  description: string | null;
  analysisType: "company" | "product";
  status: string;
  tenantDomain: string;
  createdAt: string;
}

interface SuggestedProduct {
  name: string;
  companyName: string;
  description: string;
  url: string;
  rationale: string;
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedProduct[]>([]);
  const [productFormData, setProductFormData] = useState({
    name: "",
    description: "",
    url: "",
    companyName: "",
  });

  const { data: project, isLoading: projectLoading } = useQuery<ClientProject>({
    queryKey: ["/api/projects", id],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch project");
      return response.json();
    },
    enabled: !!id,
  });

  const { data: projectProducts = [], isLoading: productsLoading } = useQuery<ProjectProduct[]>({
    queryKey: ["/api/projects", id, "products"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${id}/products`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
    enabled: !!id,
  });

  const { data: allProducts = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  const createProduct = useMutation({
    mutationFn: async (data: typeof productFormData) => {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create product");
      }
      return response.json();
    },
    onSuccess: async (product) => {
      await addProductToProject.mutateAsync({
        productId: product.id,
        role: projectProducts.some(pp => pp.role === "baseline") ? "competitor" : "baseline",
        source: "manual",
      });
      setIsAddProductOpen(false);
      setProductFormData({ name: "", description: "", url: "", companyName: "" });
      toast({
        title: "Product Added",
        description: "Product has been created and added to the project.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addProductToProject = useMutation({
    mutationFn: async (data: { productId: string; role: string; source: string }) => {
      const response = await fetch(`/api/projects/${id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to add product");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "products"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeProductFromProject = useMutation({
    mutationFn: async (productId: string) => {
      const response = await fetch(`/api/projects/${id}/products/${productId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to remove product");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "products"] });
      toast({
        title: "Product Removed",
        description: "Product has been removed from the project.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const setAsBaseline = useMutation({
    mutationFn: async (productId: string) => {
      // Server-side enforcement handles clearing existing baselines
      const response = await fetch(`/api/projects/${id}/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "baseline" }),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to set baseline");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "products"] });
      toast({
        title: "Baseline Set",
        description: "Product has been set as the baseline.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getSuggestions = async () => {
    const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
    if (!baselineProduct) {
      toast({
        title: "No Baseline",
        description: "Please set a baseline product first to get competitor suggestions.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingSuggestions(true);
    try {
      const response = await fetch(`/api/products/${baselineProduct.productId}/suggest-competitors`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to get suggestions");
      const data = await response.json();
      setSuggestions(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const addSuggestedProduct = async (suggestion: SuggestedProduct) => {
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestion.name,
          description: suggestion.description,
          url: suggestion.url,
          companyName: suggestion.companyName,
        }),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create product");
      const product = await response.json();
      
      await addProductToProject.mutateAsync({
        productId: product.id,
        role: "competitor",
        source: "suggested",
      });
      
      setSuggestions(suggestions.filter(s => s.name !== suggestion.name));
      toast({
        title: "Competitor Added",
        description: `${suggestion.name} has been added as a competitor.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createProduct.mutate(productFormData);
  };

  const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
  const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

  if (projectLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="flex-1 p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            <Card>
              <CardContent className="py-16 text-center">
                <p>Project not found</p>
                <Link href="/app/projects">
                  <Button variant="outline" className="mt-4">Back to Projects</Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/app/projects">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-project-name">{project.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  {project.analysisType === "product" ? (
                    <><Package className="h-3 w-3 mr-1" /> Product Analysis</>
                  ) : (
                    <><Building className="h-3 w-3 mr-1" /> Company Analysis</>
                  )}
                </Badge>
                <span className="text-muted-foreground text-sm">{project.clientName}</span>
              </div>
            </div>
          </div>

          {project.analysisType === "product" && (
            <>
              <div className="grid gap-6 lg:grid-cols-2 mb-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Star className="h-5 w-5 text-yellow-500" />
                      Baseline Product
                    </CardTitle>
                    <CardDescription>
                      Your product or client's product to analyze against competitors
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {baselineProduct ? (
                      <div className="flex items-start justify-between p-4 rounded-lg border bg-card">
                        <div>
                          <h3 className="font-semibold" data-testid="text-baseline-name">{baselineProduct.product.name}</h3>
                          {baselineProduct.product.companyName && (
                            <p className="text-sm text-muted-foreground">{baselineProduct.product.companyName}</p>
                          )}
                          {baselineProduct.product.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{baselineProduct.product.description}</p>
                          )}
                          {baselineProduct.product.url && (
                            <a 
                              href={baselineProduct.product.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-sm text-primary hover:underline flex items-center gap-1 mt-2"
                            >
                              Visit Product Page <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => removeProductFromProject.mutate(baselineProduct.productId)}
                          data-testid="button-remove-baseline"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center py-8 border-2 border-dashed rounded-lg">
                        <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground mb-4">No baseline product set</p>
                        <Dialog open={isAddProductOpen} onOpenChange={setIsAddProductOpen}>
                          <DialogTrigger asChild>
                            <Button data-testid="button-add-baseline">
                              <Plus className="mr-2 h-4 w-4" />
                              Add Baseline Product
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <form onSubmit={handleSubmit}>
                              <DialogHeader>
                                <DialogTitle>Add Product</DialogTitle>
                                <DialogDescription>
                                  Add your product or client's product as the baseline for comparison.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                  <Label htmlFor="name">Product Name</Label>
                                  <Input
                                    id="name"
                                    data-testid="input-product-name"
                                    placeholder="e.g., Slack"
                                    value={productFormData.name}
                                    onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                                    required
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <Label htmlFor="companyName">Company Name</Label>
                                  <Input
                                    id="companyName"
                                    data-testid="input-company-name"
                                    placeholder="e.g., Salesforce"
                                    value={productFormData.companyName}
                                    onChange={(e) => setProductFormData({ ...productFormData, companyName: e.target.value })}
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <Label htmlFor="url">Product URL (optional)</Label>
                                  <Input
                                    id="url"
                                    data-testid="input-product-url"
                                    placeholder="https://..."
                                    value={productFormData.url}
                                    onChange={(e) => setProductFormData({ ...productFormData, url: e.target.value })}
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <Label htmlFor="description">Description (optional)</Label>
                                  <Textarea
                                    id="description"
                                    data-testid="input-product-description"
                                    placeholder="Brief description of the product..."
                                    value={productFormData.description}
                                    onChange={(e) => setProductFormData({ ...productFormData, description: e.target.value })}
                                    rows={3}
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button type="submit" data-testid="button-create-product" disabled={createProduct.isPending}>
                                  {createProduct.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  Add Product
                                </Button>
                              </DialogFooter>
                            </form>
                          </DialogContent>
                        </Dialog>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          AI Competitor Suggestions
                        </CardTitle>
                        <CardDescription>
                          Get AI-powered suggestions for competitor products
                        </CardDescription>
                      </div>
                      <Button 
                        onClick={getSuggestions} 
                        disabled={!baselineProduct || isLoadingSuggestions}
                        data-testid="button-get-suggestions"
                      >
                        {isLoadingSuggestions && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <Sparkles className="mr-2 h-4 w-4" />
                        Get Suggestions
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {suggestions.length > 0 ? (
                      <div className="space-y-3">
                        {suggestions.map((suggestion, index) => (
                          <div key={index} className="flex items-start justify-between p-3 rounded-lg border bg-muted/50">
                            <div className="flex-1">
                              <h4 className="font-medium">{suggestion.name}</h4>
                              <p className="text-sm text-muted-foreground">{suggestion.companyName}</p>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{suggestion.rationale}</p>
                            </div>
                            <Button 
                              size="sm" 
                              onClick={() => addSuggestedProduct(suggestion)}
                              data-testid={`button-add-suggestion-${index}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 border-2 border-dashed rounded-lg">
                        <Sparkles className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">
                          {baselineProduct 
                            ? "Click 'Get Suggestions' to find competitor products"
                            : "Set a baseline product first to get suggestions"}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Competitor Products</CardTitle>
                      <CardDescription>
                        Products to compare against the baseline
                      </CardDescription>
                    </div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button data-testid="button-add-competitor">
                          <Plus className="mr-2 h-4 w-4" />
                          Add Competitor
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          createProduct.mutate(productFormData);
                        }}>
                          <DialogHeader>
                            <DialogTitle>Add Competitor Product</DialogTitle>
                            <DialogDescription>
                              Add a competitor product to analyze against your baseline.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                              <Label htmlFor="comp-name">Product Name</Label>
                              <Input
                                id="comp-name"
                                data-testid="input-competitor-product-name"
                                placeholder="e.g., Microsoft Teams"
                                value={productFormData.name}
                                onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                                required
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="comp-companyName">Company Name</Label>
                              <Input
                                id="comp-companyName"
                                data-testid="input-competitor-company-name"
                                placeholder="e.g., Microsoft"
                                value={productFormData.companyName}
                                onChange={(e) => setProductFormData({ ...productFormData, companyName: e.target.value })}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="comp-url">Product URL (optional)</Label>
                              <Input
                                id="comp-url"
                                data-testid="input-competitor-product-url"
                                placeholder="https://..."
                                value={productFormData.url}
                                onChange={(e) => setProductFormData({ ...productFormData, url: e.target.value })}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="comp-description">Description (optional)</Label>
                              <Textarea
                                id="comp-description"
                                data-testid="input-competitor-product-description"
                                placeholder="Brief description of the product..."
                                value={productFormData.description}
                                onChange={(e) => setProductFormData({ ...productFormData, description: e.target.value })}
                                rows={3}
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button type="submit" data-testid="button-create-competitor-product" disabled={createProduct.isPending}>
                              {createProduct.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Add Competitor
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  {productsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : competitorProducts.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {competitorProducts.map((pp) => (
                        <div key={pp.id} className="flex items-start justify-between p-4 rounded-lg border bg-card" data-testid={`card-competitor-${pp.productId}`}>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{pp.product.name}</h3>
                              {pp.source === "suggested" && (
                                <Badge variant="secondary" className="text-xs">
                                  <Sparkles className="h-3 w-3 mr-1" />
                                  AI
                                </Badge>
                              )}
                            </div>
                            {pp.product.companyName && (
                              <p className="text-sm text-muted-foreground">{pp.product.companyName}</p>
                            )}
                            {pp.product.url && (
                              <a 
                                href={pp.product.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                              >
                                View <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => setAsBaseline.mutate(pp.productId)}
                              title="Set as baseline"
                              data-testid={`button-set-baseline-${pp.productId}`}
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => removeProductFromProject.mutate(pp.productId)}
                              data-testid={`button-remove-${pp.productId}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                      <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">No Competitor Products</h3>
                      <p className="text-muted-foreground mb-4">
                        Add competitor products manually or use AI suggestions
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {project.analysisType === "company" && (
            <Card>
              <CardContent className="py-12 text-center">
                <Building className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Company vs Company Analysis</h3>
                <p className="text-muted-foreground mb-4">
                  This is a company-level analysis project. Manage competitors from the Competitors page.
                </p>
                <Link href="/app/competitors">
                  <Button variant="outline">
                    <Building className="mr-2 h-4 w-4" />
                    Go to Competitors
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
