import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreHorizontal, ExternalLink, RefreshCw, Building2, Loader2, ChevronDown, ChevronUp, Brain, Target, MessageSquare, Tags, FolderKanban, Zap, Search, Crown, Sparkles, Check, X, ClipboardPaste } from "lucide-react";
import { ManualResearchDialog } from "@/components/ManualResearchDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function Competitors() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [expandedCompetitors, setExpandedCompetitors] = useState<Set<string>>(new Set());

  const [faviconErrors, setFaviconErrors] = useState<Set<string>>(new Set());
  const [isSuggestDialogOpen, setIsSuggestDialogOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; url: string; description: string; rationale: string }>>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);
  const [manualResearchOpen, setManualResearchOpen] = useState(false);
  const [manualResearchTarget, setManualResearchTarget] = useState<{ id: string; name: string; url: string } | null>(null);
  const [urlError, setUrlError] = useState("");

  // Validate and normalize URL - basic frontend validation, backend does authoritative security checks
  const normalizeAndValidateUrl = (inputUrl: string): { valid: boolean; normalized: string; error: string } => {
    let normalized = inputUrl.trim();
    
    // Auto-prepend https:// if no scheme provided
    if (normalized && !normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }
    
    try {
      const parsed = new URL(normalized);
      
      // Require https://
      if (parsed.protocol !== "https:") {
        return { valid: false, normalized, error: "URL must use https:// (secure connection required)" };
      }
      
      // Must have a valid domain with TLD
      const hostname = parsed.hostname.toLowerCase();
      if (!hostname.includes(".") || hostname === "localhost") {
        return { valid: false, normalized, error: "Please enter a valid website URL (e.g., https://example.com)" };
      }
      
      return { valid: true, normalized, error: "" };
    } catch {
      return { valid: false, normalized, error: "Please enter a valid URL (e.g., https://example.com)" };
    }
  };

  const handleFaviconError = (competitorId: string) => {
    setFaviconErrors(prev => new Set(prev).add(competitorId));
  };

  const toggleExpanded = (id: string) => {
    setExpandedCompetitors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const { data: competitors = [], isLoading } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch competitors");
      return response.json();
    },
  });

  const { data: projects = [] } = useQuery<{ id: string; name: string; clientName: string; status: string }[]>({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    retry: false,
  });

  const activeProjects = projects.filter(p => p.status === "active");

  const { data: companyProfile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch company profile");
      return response.json();
    },
  });

  // Fetch tenant info to check plan
  const { data: tenantInfo } = useQuery<{ plan: string; isPremium: boolean }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", {
        credentials: "include",
      });
      if (!response.ok) return { plan: "trial", isPremium: false };
      return response.json();
    },
  });
  
  const isPremiumPlan = tenantInfo?.isPremium || ["pro", "professional", "enterprise"].includes(tenantInfo?.plan || "");

  const addCompetitor = useMutation({
    mutationFn: async (data: { name: string; url: string; projectId?: string }) => {
      const response = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to add competitor");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      setIsDialogOpen(false);
      setName("");
      setUrl("");
      setUrlError("");
      setSelectedProjectId("");
      toast({
        title: "Competitor Added",
        description: "We've started tracking this competitor.",
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

  const [analyzingCompetitor, setAnalyzingCompetitor] = useState<string | null>(null);

  const crawlCompetitor = useMutation({
    mutationFn: async ({ id, analysisType }: { id: string; analysisType: "quick" | "full" | "full_with_change" }) => {
      setAnalyzingCompetitor(id);
      const response = await fetch(`/api/competitors/${id}/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisType }),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to analyze competitor");
      }
      return response.json();
    },
    onSuccess: (data, variables) => {
      setAnalyzingCompetitor(null);
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      
      // Check if crawl failed and manual research is available
      if (data.success === false && data.canUseManualResearch) {
        const competitor = competitors.find((c: any) => c.id === variables.id);
        if (competitor) {
          setManualResearchTarget({ id: competitor.id, name: competitor.name, url: competitor.url });
          toast({
            title: "Website Could Not Be Crawled",
            description: "You can use AI-assisted manual research instead.",
            action: (
              <Button 
                size="sm" 
                onClick={() => setManualResearchOpen(true)}
                className="gap-1"
              >
                <ClipboardPaste className="h-3 w-3" /> Use AI Research
              </Button>
            ),
          });
          return;
        }
      }
      
      const typeLabels: Record<string, string> = {
        quick: "Quick Refresh",
        full: "Full Analysis", 
        full_with_change: "Full Analysis with Change Detection"
      };
      toast({
        title: typeLabels[data.analysisType] || "Analysis Complete",
        description: data.message || "Competitor data has been updated.",
      });
    },
    onError: (error: Error) => {
      setAnalyzingCompetitor(null);
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCompetitor = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/competitors/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete competitor");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({
        title: "Competitor Removed",
        description: "Competitor has been removed from tracking.",
      });
    },
  });

  const handleAddCompetitor = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError("");
    
    // Validate and normalize URL
    const validation = normalizeAndValidateUrl(url);
    if (!validation.valid) {
      setUrlError(validation.error);
      return;
    }
    
    addCompetitor.mutate({ 
      name, 
      url: validation.normalized,
      projectId: selectedProjectId || undefined
    });
  };

  const getSuggestions = async () => {
    setIsLoadingSuggestions(true);
    setSuggestions([]);
    try {
      const response = await fetch("/api/company-profile/suggest-competitors", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get suggestions");
      }
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

  const addSuggestedCompetitor = async (suggestion: { name: string; url: string }) => {
    setAddingSuggestion(suggestion.url);
    try {
      const response = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: suggestion.name, url: suggestion.url }),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to add competitor");
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      setSuggestions(prev => prev.filter(s => s.url !== suggestion.url));
      toast({
        title: "Competitor Added",
        description: `${suggestion.name} has been added to your tracking list.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAddingSuggestion(null);
    }
  };

  const openSuggestDialog = () => {
    setIsSuggestDialogOpen(true);
    getSuggestions();
  };

  if (isLoading || isLoadingProfile) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Competitors</h1>
          <p className="text-muted-foreground">Compare your company against the competition.</p>
        </div>
        <div className="flex items-center gap-2">
          {companyProfile && (
            <Button 
              variant="outline" 
              onClick={openSuggestDialog}
              disabled={!companyProfile}
              data-testid="button-ai-suggest-competitors"
            >
              <Sparkles className="w-4 h-4 mr-2" /> AI Suggest
            </Button>
          )}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
                <Plus className="w-4 h-4 mr-2" /> Add Competitor
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Competitor</DialogTitle>
              <DialogDescription>
                Enter the details of the competitor you want to track. We'll start gathering intelligence immediately.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddCompetitor}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="Acme Inc."
                    className="col-span-3"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="url" className="text-right">
                    Website
                  </Label>
                  <div className="col-span-3 space-y-1">
                    <Input
                      id="url"
                      placeholder="https://acme.com"
                      className={urlError ? "border-destructive" : ""}
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        if (urlError) setUrlError("");
                      }}
                      required
                      data-testid="input-competitor-url"
                    />
                    {urlError && (
                      <p className="text-xs text-destructive">{urlError}</p>
                    )}
                  </div>
                </div>
                {activeProjects.length > 0 && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="project" className="text-right">
                      Project
                    </Label>
                    <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                      <SelectTrigger className="col-span-3" data-testid="select-project">
                        <SelectValue placeholder="None (own analysis)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None (own analysis)</SelectItem>
                        {activeProjects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            <span className="flex items-center gap-2">
                              <FolderKanban className="h-3 w-3" />
                              {project.name} ({project.clientName})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={addCompetitor.isPending}>
                  {addCompetitor.isPending ? "Adding..." : "Start Tracking"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Dialog open={isSuggestDialogOpen} onOpenChange={setIsSuggestDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI-Suggested Competitors
            </DialogTitle>
            <DialogDescription>
              Based on your company profile, we've identified potential competitors you might want to track.
            </DialogDescription>
          </DialogHeader>
          
          {isLoadingSuggestions ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Analyzing your market and finding competitors...</p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <Search className="w-12 h-12 text-muted-foreground/50" />
              <div>
                <p className="font-medium">No new suggestions found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  You may already be tracking the major competitors in your market.
                </p>
              </div>
              <Button variant="outline" onClick={getSuggestions} data-testid="button-try-again-suggestions">
                <RefreshCw className="w-4 h-4 mr-2" /> Try Again
              </Button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                  data-testid={`suggestion-${index}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{suggestion.name}</h4>
                        <a
                          href={suggestion.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`link-suggestion-${index}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {suggestion.description}
                      </p>
                      <p className="text-xs text-muted-foreground/70 italic">
                        {suggestion.rationale}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => addSuggestedCompetitor(suggestion)}
                      disabled={addingSuggestion === suggestion.url}
                      data-testid={`button-add-suggestion-${index}`}
                    >
                      {addingSuggestion === suggestion.url ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-1" /> Add
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsSuggestDialogOpen(false)} data-testid="button-close-suggestions">
              Close
            </Button>
            {suggestions.length > 0 && (
              <Button variant="outline" onClick={getSuggestions} disabled={isLoadingSuggestions} data-testid="button-refresh-suggestions">
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        {!companyProfile && (
          <Card className="border-dashed border-2 border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium">Set up your Company Baseline first</p>
                    <p className="text-sm text-muted-foreground">Add your company profile before tracking competitors</p>
                  </div>
                </div>
                <Link href="/app/company-profile">
                  <Button variant="outline" data-testid="link-setup-baseline">
                    <Building2 className="w-4 h-4 mr-2" />
                    Set Up Baseline
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {companyProfile && (
          <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{companyProfile.companyName}</p>
                    <p className="text-sm text-muted-foreground">Your baseline for competitive analysis</p>
                  </div>
                </div>
                <Link href="/app/company-profile">
                  <Button variant="ghost" size="sm" data-testid="link-view-baseline">
                    View Baseline
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Tracked Competitors</h2>
          {competitors.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground mb-4">No competitors tracked yet</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Your First Competitor
              </Button>
            </Card>
          ) : (
            <div className="grid gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700 fill-mode-backwards delay-100">
              {competitors.map((competitor: any) => {
                const analysis = competitor.analysisData as any;
                const isExpanded = expandedCompetitors.has(competitor.id);
                
                return (
                  <div key={competitor.id} className="group">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(competitor.id)}>
                      <Card className="hover:border-primary/50 hover:shadow-md transition-all duration-300">
                        <CardContent className="p-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              {competitor.faviconUrl && !faviconErrors.has(competitor.id) ? (
                                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden group-hover:ring-2 group-hover:ring-primary/50 transition-all">
                                  <img 
                                    src={competitor.faviconUrl} 
                                    alt={`${competitor.name} logo`}
                                    className="w-8 h-8 object-contain"
                                    onError={() => handleFaviconError(competitor.id)}
                                    referrerPolicy="no-referrer"
                                    data-testid={`img-favicon-${competitor.id}`}
                                  />
                                </div>
                              ) : (
                                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center font-bold text-lg text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                                  {competitor.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                                  {competitor.name}
                                </h3>
                                <div className="flex items-center gap-2">
                                  <a 
                                    href={competitor.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {competitor.url} <ExternalLink size={12} />
                                  </a>
                                  {analysis && (
                                    <Badge variant="secondary" className="ml-2">
                                      <Brain className="w-3 h-3 mr-1" /> Analyzed
                                    </Badge>
                                  )}
                                </div>
                                {analysis?.summary && (
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-1" data-testid={`text-summary-${competitor.id}`}>
                                    {analysis.summary}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-6">
                              <div className="text-right hidden md:block">
                                <p className="text-sm font-medium">Last Crawl</p>
                                <p className="text-xs text-muted-foreground">{competitor.lastCrawl || "Never"}</p>
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Analysis Type Dropdown */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                                      disabled={analyzingCompetitor === competitor.id}
                                      data-testid={`button-crawl-${competitor.id}`}
                                    >
                                      {analyzingCompetitor === competitor.id ? (
                                        <>
                                          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...
                                        </>
                                      ) : (
                                        <>
                                          <RefreshCw className="w-4 h-4 mr-2" /> Analyze <ChevronDown className="w-3 h-3 ml-1" />
                                        </>
                                      )}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuItem 
                                      onClick={() => crawlCompetitor.mutate({ id: competitor.id, analysisType: "quick" })}
                                      data-testid={`button-quick-analysis-${competitor.id}`}
                                    >
                                      <Zap className="w-4 h-4 mr-2 text-yellow-500" />
                                      <div>
                                        <div className="font-medium">Quick Refresh</div>
                                        <div className="text-xs text-muted-foreground">Refresh webpage data only</div>
                                      </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => crawlCompetitor.mutate({ id: competitor.id, analysisType: "full" })}
                                      data-testid={`button-full-analysis-${competitor.id}`}
                                    >
                                      <Search className="w-4 h-4 mr-2 text-blue-500" />
                                      <div>
                                        <div className="font-medium">Full Analysis</div>
                                        <div className="text-xs text-muted-foreground">Crawl + AI analysis</div>
                                      </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => isPremiumPlan && crawlCompetitor.mutate({ id: competitor.id, analysisType: "full_with_change" })}
                                      disabled={!isPremiumPlan}
                                      className={!isPremiumPlan ? "opacity-50 cursor-not-allowed" : ""}
                                      data-testid={`button-full-change-analysis-${competitor.id}`}
                                    >
                                      <Crown className="w-4 h-4 mr-2 text-amber-500" />
                                      <div className="flex-1">
                                        <div className="font-medium flex items-center gap-2">
                                          Full + Change Analysis
                                          {!isPremiumPlan && <Badge variant="outline" className="text-[10px] px-1 py-0">Pro</Badge>}
                                        </div>
                                        <div className="text-xs text-muted-foreground">Include social & news monitoring</div>
                                      </div>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                
                                {(analysis || competitor.screenshotUrl) && (
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="icon" data-testid={`button-expand-${competitor.id}`}>
                                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </Button>
                                  </CollapsibleTrigger>
                                )}
                                
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => crawlCompetitor.mutate({ id: competitor.id, analysisType: "full" })}>
                                      Re-analyze Website
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => {
                                        setManualResearchTarget({ id: competitor.id, name: competitor.name, url: competitor.url });
                                        setManualResearchOpen(true);
                                      }}
                                      data-testid={`button-manual-research-${competitor.id}`}
                                    >
                                      <ClipboardPaste className="w-4 h-4 mr-2" />
                                      Manual AI Research
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => deleteCompetitor.mutate(competitor.id)}
                                    >
                                      Remove Competitor
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                          
                          <CollapsibleContent>
                            <div className="mt-6 pt-6 border-t space-y-4">
                              {competitor.screenshotUrl && (
                                <div className="mb-4">
                                  <p className="text-sm font-medium mb-2">Homepage Screenshot</p>
                                  <a href={competitor.url} target="_blank" rel="noopener noreferrer">
                                    <img 
                                      src={competitor.screenshotUrl} 
                                      alt={`${competitor.name} homepage`}
                                      className="rounded-lg border shadow-sm max-h-48 object-cover object-top w-full hover:opacity-90 transition-opacity"
                                      referrerPolicy="no-referrer"
                                      data-testid={`img-screenshot-${competitor.id}`}
                                    />
                                  </a>
                                </div>
                              )}
                              {analysis && (
                                <>
                                  <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2 text-sm font-medium">
                                        <Brain className="w-4 h-4 text-primary" />
                                        Summary
                                      </div>
                                      <p className="text-sm text-muted-foreground">{analysis.summary}</p>
                                    </div>
                                    
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2 text-sm font-medium">
                                        <Target className="w-4 h-4 text-primary" />
                                        Target Audience
                                      </div>
                                      <p className="text-sm text-muted-foreground">{analysis.targetAudience}</p>
                                    </div>
                                  </div>
                                  
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                      <MessageSquare className="w-4 h-4 text-primary" />
                                      Key Messages
                                    </div>
                                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                                      {analysis.keyMessages?.map((msg: string, i: number) => (
                                        <li key={i}>{msg}</li>
                                      ))}
                                    </ul>
                                  </div>
                                  
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                      <Tags className="w-4 h-4 text-primary" />
                                      Keywords & Tone
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {analysis.keywords?.map((keyword: string, i: number) => (
                                        <Badge key={i} variant="outline">{keyword}</Badge>
                                      ))}
                                      <Badge variant="secondary">{analysis.tone}</Badge>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </CollapsibleContent>
                        </CardContent>
                      </Card>
                    </Collapsible>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {manualResearchTarget && (
        <ManualResearchDialog
          open={manualResearchOpen}
          onOpenChange={setManualResearchOpen}
          entityType="competitor"
          entityId={manualResearchTarget.id}
          entityName={manualResearchTarget.name}
          entityUrl={manualResearchTarget.url}
        />
      )}
    </AppLayout>
  );
}
