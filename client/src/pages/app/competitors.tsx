import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreHorizontal, ExternalLink, RefreshCw, Building2, Edit2, Loader2, Trash2, ChevronDown, ChevronUp, Brain, Target, MessageSquare, Tags } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function Competitors() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [expandedCompetitors, setExpandedCompetitors] = useState<Set<string>>(new Set());
  const [profileForm, setProfileForm] = useState({
    companyName: "",
    websiteUrl: "",
    description: "",
  });

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

  const addCompetitor = useMutation({
    mutationFn: async (data: { name: string; url: string }) => {
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

  const saveProfile = useMutation({
    mutationFn: async (data: { companyName: string; websiteUrl: string; description: string }) => {
      const response = await fetch("/api/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to save company profile");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      setIsProfileDialogOpen(false);
      toast({
        title: "Profile Saved",
        description: "Your company profile has been updated.",
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

  const analyzeProfile = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/company-profile/analyze", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to analyze company website");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      toast({
        title: "Analysis Complete",
        description: "Your company website has been analyzed.",
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

  const deleteProfile = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/company-profile", {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete company profile");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      toast({
        title: "Profile Deleted",
        description: "Your company profile has been removed.",
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

  const crawlCompetitor = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/competitors/${id}/crawl`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to crawl competitor");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({
        title: "Crawl Started",
        description: "Competitor data is being updated.",
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
    addCompetitor.mutate({ name, url });
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    saveProfile.mutate(profileForm);
  };

  const openProfileDialog = () => {
    if (companyProfile) {
      setProfileForm({
        companyName: companyProfile.companyName || "",
        websiteUrl: companyProfile.websiteUrl || "",
        description: companyProfile.description || "",
      });
    }
    setIsProfileDialogOpen(true);
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
                  <Input
                    id="url"
                    placeholder="https://acme.com"
                    className="col-span-3"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                </div>
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

      <div className="space-y-8">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-secondary/5 animate-in fade-in slide-in-from-bottom-6 duration-600">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Your Company</CardTitle>
                  <CardDescription>Baseline for competitive analysis</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" onClick={openProfileDialog}>
                      <Edit2 className="w-4 h-4 mr-2" />
                      {companyProfile ? "Edit" : "Set Up"}
                    </Button>
                  </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{companyProfile ? "Edit" : "Set Up"} Your Company Profile</DialogTitle>
                    <DialogDescription>
                      Add your company details to use as a baseline for competitive analysis.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSaveProfile}>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="companyName">Company Name</Label>
                        <Input
                          id="companyName"
                          placeholder="Your Company Inc."
                          value={profileForm.companyName}
                          onChange={(e) => setProfileForm({ ...profileForm, companyName: e.target.value })}
                          required
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="websiteUrl">Website URL</Label>
                        <Input
                          id="websiteUrl"
                          placeholder="https://yourcompany.com"
                          value={profileForm.websiteUrl}
                          onChange={(e) => setProfileForm({ ...profileForm, websiteUrl: e.target.value })}
                          required
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="description">Description (optional)</Label>
                        <Textarea
                          id="description"
                          placeholder="Brief description of your company..."
                          value={profileForm.description}
                          onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                          rows={3}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={saveProfile.isPending}>
                        {saveProfile.isPending ? "Saving..." : "Save Profile"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
                {companyProfile && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Company Profile?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove your company profile and any associated analysis data. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteProfile.mutate()}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {companyProfile ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{companyProfile.companyName}</h3>
                    <a
                      href={companyProfile.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                    >
                      {companyProfile.websiteUrl} <ExternalLink size={12} />
                    </a>
                    {companyProfile.description && (
                      <p className="text-sm text-muted-foreground mt-2">{companyProfile.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium">Last Analysis</p>
                      <p className="text-xs text-muted-foreground">
                        {companyProfile.lastAnalysis
                          ? new Date(companyProfile.lastAnalysis).toLocaleDateString()
                          : "Never"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => analyzeProfile.mutate()}
                      disabled={analyzeProfile.isPending}
                    >
                      {analyzeProfile.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Analyze
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {companyProfile.analysisData && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium mb-2">Analysis Summary</p>
                    <p className="text-sm text-muted-foreground">
                      {typeof companyProfile.analysisData === 'object' && companyProfile.analysisData.summary
                        ? companyProfile.analysisData.summary
                        : "Analysis data available. View full analysis for details."}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-muted-foreground mb-4">
                  Set up your company profile to establish a baseline for competitive analysis.
                </p>
                <Button variant="outline" onClick={openProfileDialog}>
                  <Plus className="w-4 h-4 mr-2" /> Set Up Profile
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
                              <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center font-bold text-lg text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                                {competitor.name.charAt(0)}
                              </div>
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
                              </div>
                            </div>

                            <div className="flex items-center gap-6">
                              <div className="text-right hidden md:block">
                                <p className="text-sm font-medium">Last Crawl</p>
                                <p className="text-xs text-muted-foreground">{competitor.lastCrawl || "Never"}</p>
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => crawlCompetitor.mutate(competitor.id)}
                                  disabled={crawlCompetitor.isPending}
                                  data-testid={`button-crawl-${competitor.id}`}
                                >
                                  <RefreshCw className="w-4 h-4 mr-2" /> Analyze
                                </Button>
                                
                                {analysis && (
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
                                    <DropdownMenuItem onClick={() => crawlCompetitor.mutate(competitor.id)}>
                                      Re-analyze Website
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
                            {analysis && (
                              <div className="mt-6 pt-6 border-t space-y-4">
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
                              </div>
                            )}
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
    </AppLayout>
  );
}
