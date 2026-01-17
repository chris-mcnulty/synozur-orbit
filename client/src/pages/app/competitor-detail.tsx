import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, ExternalLink, Globe, Calendar, RefreshCw, BarChart2, FileText, Linkedin, Instagram, Pencil, Activity, Lock, Swords, Sparkles, Target, Shield, MessageSquare, TrendingUp, Loader2, Check, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function CompetitorDetail() {
  const [, params] = useRoute("/app/competitors/:id");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editLinkedIn, setEditLinkedIn] = useState("");
  const [editInstagram, setEditInstagram] = useState("");

  const { data: competitor, isLoading, error } = useQuery({
    queryKey: ["/api/competitors", id],
    queryFn: async () => {
      const response = await fetch(`/api/competitors/${id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch competitor");
      return response.json();
    },
    enabled: !!id,
  });

  const crawlMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/competitors/${id}/crawl`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to crawl");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      toast({
        title: "Crawl Started",
        description: "Competitor data is being updated.",
      });
    },
  });

  const updateSocialMutation = useMutation({
    mutationFn: async (data: { linkedInUrl?: string; instagramUrl?: string }) => {
      const response = await fetch(`/api/competitors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      setEditOpen(false);
      toast({
        title: "Social Links Updated",
        description: "Competitor social media links have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Could not save social media links.",
        variant: "destructive",
      });
    },
  });

  const handleEditOpen = () => {
    setEditLinkedIn(competitor?.linkedInUrl || "");
    setEditInstagram(competitor?.instagramUrl || "");
    setEditOpen(true);
  };

  const handleSaveSocial = () => {
    updateSocialMutation.mutate({
      linkedInUrl: editLinkedIn || undefined,
      instagramUrl: editInstagram || undefined,
    });
  };

  const { data: monitoringSettings } = useQuery({
    queryKey: ["/api/social-monitoring/settings"],
    queryFn: async () => {
      const response = await fetch("/api/social-monitoring/settings", {
        credentials: "include",
      });
      if (!response.ok) return { isPremium: false };
      return response.json();
    },
  });

  const socialMonitorMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/competitors/${id}/monitor-social`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to monitor social media");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      
      const changesFound = data.results?.some((r: any) => r.hasChanges);
      toast({
        title: changesFound ? "Social Updates Found" : "Social Check Complete",
        description: changesFound 
          ? "New social media updates have been detected and logged."
          : "No significant changes detected on social media profiles.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Monitoring Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Battlecard query and mutations
  const { data: battlecard, isLoading: battlecardLoading } = useQuery({
    queryKey: ["/api/competitors", id, "battlecard"],
    queryFn: async () => {
      const response = await fetch(`/api/competitors/${id}/battlecard`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch battlecard");
      return response.json();
    },
    enabled: !!id,
  });

  const generateBattlecardMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/competitors/${id}/battlecard/generate`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate battlecard");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id, "battlecard"] });
      toast({
        title: "Battlecard Generated",
        description: "AI-powered battlecard has been created for this competitor.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateBattlecardMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/battlecards/${battlecard?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update battlecard");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id, "battlecard"] });
      toast({
        title: "Battlecard Updated",
        description: "Your changes have been saved.",
      });
    },
  });

  const hasSocialUrls = competitor?.linkedInUrl || competitor?.instagramUrl;
  const isPremium = monitoringSettings?.isPremium;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[50vh]">
          <p className="text-muted-foreground">Loading competitor...</p>
        </div>
      </AppLayout>
    );
  }

  if (error || !competitor) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-[50vh]">
          <h2 className="text-2xl font-bold mb-2">Competitor Not Found</h2>
          <Link href="/app/competitors" className="text-primary hover:underline flex items-center">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Competitors
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mb-8">
          <Link href="/app/competitors" className="text-sm text-muted-foreground hover:text-foreground flex items-center mb-4 transition-colors">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Competitors
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-2xl font-bold text-foreground border border-border/50 shadow-sm">
                {competitor.name.charAt(0)}
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{competitor.name}</h1>
                <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                  <a href={competitor.url} target="_blank" rel="noreferrer" className="flex items-center hover:text-primary transition-colors">
                    <Globe className="mr-1 h-3 w-3" /> {competitor.url} <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                  <span className="text-border hidden sm:inline">|</span>
                  <span className="flex items-center">
                    <Calendar className="mr-1 h-3 w-3" /> Last crawled: {competitor.lastCrawl || "Never"}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  {competitor.linkedInUrl ? (
                    <a 
                      href={competitor.linkedInUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="flex items-center gap-1 text-sm text-[#0A66C2] hover:underline"
                      data-testid="link-linkedin"
                    >
                      <Linkedin className="h-4 w-4" /> LinkedIn
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground/50">
                      <Linkedin className="h-4 w-4" /> No LinkedIn
                    </span>
                  )}
                  {competitor.instagramUrl ? (
                    <a 
                      href={competitor.instagramUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="flex items-center gap-1 text-sm text-[#E4405F] hover:underline"
                      data-testid="link-instagram"
                    >
                      <Instagram className="h-4 w-4" /> Instagram
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground/50">
                      <Instagram className="h-4 w-4" /> No Instagram
                    </span>
                  )}
                  <Dialog open={editOpen} onOpenChange={setEditOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={handleEditOpen} data-testid="button-edit-social">
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Edit Social Media Links</DialogTitle>
                        <DialogDescription>
                          Add or update social media profile URLs for {competitor.name}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="linkedin" className="flex items-center gap-2">
                            <Linkedin className="h-4 w-4 text-[#0A66C2]" /> LinkedIn URL
                          </Label>
                          <Input
                            id="linkedin"
                            placeholder="https://linkedin.com/company/..."
                            value={editLinkedIn}
                            onChange={(e) => setEditLinkedIn(e.target.value)}
                            data-testid="input-linkedin"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="instagram" className="flex items-center gap-2">
                            <Instagram className="h-4 w-4 text-[#E4405F]" /> Instagram URL
                          </Label>
                          <Input
                            id="instagram"
                            placeholder="https://instagram.com/..."
                            value={editInstagram}
                            onChange={(e) => setEditInstagram(e.target.value)}
                            data-testid="input-instagram"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveSocial} disabled={updateSocialMutation.isPending} data-testid="button-save-social">
                          {updateSocialMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                className="gap-2"
                onClick={() => crawlMutation.mutate()}
                disabled={crawlMutation.isPending}
              >
                <RefreshCw className="h-4 w-4" /> {crawlMutation.isPending ? "Crawling..." : "Re-crawl"}
              </Button>
              
              {hasSocialUrls && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button 
                          variant="outline" 
                          className="gap-2"
                          onClick={() => socialMonitorMutation.mutate()}
                          disabled={!isPremium || socialMonitorMutation.isPending}
                          data-testid="button-monitor-social"
                        >
                          {!isPremium && <Lock className="h-3 w-3" />}
                          <Activity className="h-4 w-4" /> 
                          {socialMonitorMutation.isPending ? "Checking..." : "Check Social"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!isPremium && (
                      <TooltipContent>
                        <p>Social monitoring is a premium feature</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )}
              
              <Button className="gap-2">
                <FileText className="h-4 w-4" /> Generate Report
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <Card className="bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Orbit Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">72<span className="text-lg text-muted-foreground font-normal">/100</span></div>
              <p className="text-xs text-muted-foreground mt-1">Top 15% of your market</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Messaging Overlap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">High</div>
              <p className="text-xs text-muted-foreground mt-1">Direct conflict on 4 themes</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">5</div>
              <p className="text-xs text-muted-foreground mt-1">Changes in last 7 days</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-muted/50 p-1 border border-border rounded-lg">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="battlecard" data-testid="tab-battlecard">
              <Swords className="h-4 w-4 mr-1" /> Battlecard
            </TabsTrigger>
            <TabsTrigger value="messaging">Messaging</TabsTrigger>
            <TabsTrigger value="pages">Pages Tracked</TabsTrigger>
            <TabsTrigger value="history">Crawl History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card>
              <CardHeader>
                <CardTitle>AI Executive Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground leading-relaxed">
                  {competitor.name} has recently pivoted their messaging to focus heavily on "Enterprise Automation," moving away from their previous "SMB Friendly" positioning. This directly impacts your "Enterprise Grade" differentiator. They have launched 3 new landing pages in the last month targeting CTOs specifically.
                </p>
                <div className="flex gap-2">
                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">Pivot Detected</Badge>
                  <Badge variant="outline" className="bg-orange-500/5 text-orange-500 border-orange-500/20">New Audience Segment</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top Keywords</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {["Automation", "Enterprise", "Security", "Scale", "API First", "Compliance", "Cloud"].map((kw) => (
                      <Badge key={kw} variant="secondary" className="px-3 py-1">{kw}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Market Positioning</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px] flex items-center justify-center bg-muted/20 rounded-lg border border-dashed border-border">
                    <span className="text-muted-foreground text-sm flex items-center gap-2">
                      <BarChart2 className="h-4 w-4" /> Positioning Map Placeholder
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="battlecard" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {battlecardLoading ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-muted-foreground mt-2">Loading battlecard...</p>
                </CardContent>
              </Card>
            ) : !battlecard ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <Swords className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Battlecard Yet</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Generate an AI-powered battlecard to get sales-ready talking points, objection handlers, and competitive insights.
                  </p>
                  <Button 
                    onClick={() => generateBattlecardMutation.mutate()}
                    disabled={generateBattlecardMutation.isPending}
                    className="gap-2"
                    data-testid="button-generate-battlecard"
                  >
                    {generateBattlecardMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-4 w-4" /> Generate Battlecard</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Swords className="h-5 w-5 text-primary" />
                      Sales Battlecard: {competitor.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Last generated: {battlecard.lastGeneratedAt ? new Date(battlecard.lastGeneratedAt).toLocaleDateString() : "Never"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={battlecard.status === "published" ? "default" : "secondary"}>
                      {battlecard.status === "published" ? "Published" : "Draft"}
                    </Badge>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => generateBattlecardMutation.mutate()}
                      disabled={generateBattlecardMutation.isPending}
                      data-testid="button-regenerate-battlecard"
                    >
                      {generateBattlecardMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <><RefreshCw className="h-4 w-4 mr-1" /> Regenerate</>
                      )}
                    </Button>
                    <Button 
                      size="sm"
                      onClick={() => updateBattlecardMutation.mutate({ 
                        status: battlecard.status === "published" ? "draft" : "published" 
                      })}
                      data-testid="button-publish-battlecard"
                    >
                      {battlecard.status === "published" ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        Competitor Strengths
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(battlecard.strengths as string[] || []).map((strength: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            <span>{strength}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <X className="h-4 w-4 text-red-500" />
                        Competitor Weaknesses
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(battlecard.weaknesses as string[] || []).map((weakness: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <X className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                            <span>{weakness}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        Our Advantages
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(battlecard.ourAdvantages as string[] || []).map((adv: string, i: number) => (
                          <div key={i} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                            <span className="text-sm">{adv}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-orange-500" />
                        Common Objections & Responses
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {(battlecard.objections as any[] || []).map((obj: any, i: number) => (
                          <div key={i} className="p-4 rounded-lg bg-muted/30 border">
                            <p className="font-medium text-sm mb-2 flex items-center gap-2">
                              <Badge variant="outline" className="text-orange-500 border-orange-500/30">Objection</Badge>
                              {obj.objection}
                            </p>
                            <p className="text-sm text-muted-foreground pl-4 border-l-2 border-primary/30">
                              <span className="font-medium text-foreground">Response:</span> {obj.response}
                            </p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="h-4 w-4 text-blue-500" />
                        Talk Tracks
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {(battlecard.talkTracks as any[] || []).map((track: any, i: number) => (
                          <div key={i} className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                            <p className="font-medium text-sm mb-2">{track.scenario}</p>
                            <p className="text-sm text-muted-foreground italic">"{track.script}"</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart2 className="h-4 w-4 text-purple-500" />
                        Quick Stats
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {battlecard.quickStats && typeof battlecard.quickStats === 'object' && (
                          <>
                            <div className="p-3 rounded-lg bg-muted/30">
                              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Pricing</p>
                              <p className="text-sm font-medium">{(battlecard.quickStats as any).pricing || "Unknown"}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30">
                              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Market Position</p>
                              <p className="text-sm font-medium">{(battlecard.quickStats as any).marketPosition || "Unknown"}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30">
                              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Target Audience</p>
                              <p className="text-sm font-medium">{(battlecard.quickStats as any).targetAudience || "Unknown"}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30">
                              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Key Products</p>
                              <p className="text-sm font-medium">{(battlecard.quickStats as any).keyProducts || "Unknown"}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Pencil className="h-4 w-4" />
                        Custom Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea 
                        placeholder="Add your own notes, insights, or additional information..."
                        defaultValue={battlecard.customNotes || ""}
                        className="min-h-[100px]"
                        onBlur={(e) => {
                          if (e.target.value !== (battlecard.customNotes || "")) {
                            updateBattlecardMutation.mutate({ customNotes: e.target.value });
                          }
                        }}
                        data-testid="textarea-custom-notes"
                      />
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>
          
          <TabsContent value="messaging">
             <Card>
               <CardContent className="p-8 text-center text-muted-foreground">
                 Messaging analysis content would go here.
               </CardContent>
             </Card>
          </TabsContent>
          
          <TabsContent value="pages">
             <Card>
               <CardContent className="p-8 text-center text-muted-foreground">
                 List of tracked pages would go here.
               </CardContent>
             </Card>
          </TabsContent>
          
          <TabsContent value="history">
             <Card>
               <CardContent className="p-8 text-center text-muted-foreground">
                 Crawl history log would go here.
               </CardContent>
             </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
