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
import { ArrowLeft, ExternalLink, Globe, Calendar, RefreshCw, BarChart2, FileText, Linkedin, Instagram, Twitter, Pencil, Activity, Lock, Swords, Sparkles, Target, Shield, MessageSquare, TrendingUp, Loader2, Check, X, Clock, FileSearch, AlertCircle, Eye, Rss, Hash, Tags, Download, Building2, DollarSign, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function CompetitorDetail() {
  const [, params] = useRoute("/app/competitors/:id");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editLinkedIn, setEditLinkedIn] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editTwitter, setEditTwitter] = useState("");
  const [editBlogUrl, setEditBlogUrl] = useState("");
  const [editSocialFrequency, setEditSocialFrequency] = useState("daily");
  
  // Company Profile editing state (shared with main edit dialog)
  const [editHeadquarters, setEditHeadquarters] = useState("");
  const [editFounded, setEditFounded] = useState("");
  const [editEmployeeCount, setEditEmployeeCount] = useState("");
  const [editRevenue, setEditRevenue] = useState("");
  const [editFundingRaised, setEditFundingRaised] = useState("");
  const [editIndustry, setEditIndustry] = useState("");

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

  const { data: allActivity = [] } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const response = await fetch("/api/activity", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const competitorActivity = allActivity.filter((a: any) => 
    a.competitorId && id && String(a.competitorId) === String(id)
  );
  // Handle both formats: 'pages' and 'pagesCrawled' (backend uses pagesCrawled)
  const rawCrawlData = competitor?.crawlData as { 
    pages?: Array<{ url: string; title?: string; wordCount?: number; pageType?: string }>; 
    pagesCrawled?: Array<{ url: string; title?: string; wordCount?: number; pageType?: string }>; 
    totalWordCount?: number; 
    crawledAt?: string 
  } | null;
  const crawlData = rawCrawlData ? {
    pages: rawCrawlData.pages || rawCrawlData.pagesCrawled,
    totalWordCount: rawCrawlData.totalWordCount,
    crawledAt: rawCrawlData.crawledAt,
  } : null;
  const analysisData = competitor?.analysisData as { 
    positioning?: string; 
    messagingThemes?: string[];
    targetAudience?: string;
    valuePropositions?: string[];
    keyDifferentiators?: string[];
    summary?: string;
    keyMessages?: string[];
    keywords?: string[];
    tone?: string;
  } | null;
  
  // Fetch dashboard scores to get calculated Orbit score for this competitor
  const { data: dashboardScores } = useQuery<{
    competitors: Array<{ id: string; name: string; overallScore: number; innovationScore: number; marketPresenceScore: number }>;
  }>({
    queryKey: ["/api/dashboard/scores"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/scores", { credentials: "include" });
      if (!response.ok) return { competitors: [] };
      return response.json();
    },
  });
  
  // Get this competitor's score from the dashboard data
  const competitorScore = dashboardScores?.competitors?.find(c => String(c.id) === String(id));
  const orbitScore = competitorScore?.overallScore ?? null;
  
  // Calculate messaging overlap based on number of messaging themes
  const messagingThemeCount = analysisData?.messagingThemes?.length ?? 0;
  const getMessagingOverlap = () => {
    if (messagingThemeCount === 0) return { level: "Unknown", detail: "No analysis data" };
    if (messagingThemeCount >= 5) return { level: "High", detail: `${messagingThemeCount} themes identified` };
    if (messagingThemeCount >= 3) return { level: "Medium", detail: `${messagingThemeCount} themes identified` };
    return { level: "Low", detail: `${messagingThemeCount} themes identified` };
  };
  const messagingOverlap = getMessagingOverlap();
  
  // Get recent activity count (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentActivityCount = competitorActivity.filter((a: any) => 
    new Date(a.createdAt) >= sevenDaysAgo
  ).length;

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
    mutationFn: async (data: { linkedInUrl?: string; instagramUrl?: string; twitterUrl?: string; blogFeedUrl?: string; socialCheckFrequency?: string; headquarters?: string; founded?: string; employeeCount?: string; revenue?: string; fundingRaised?: string; industry?: string }) => {
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
        title: "Competitor Updated",
        description: "Competitor information has been saved.",
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
    setEditTwitter(competitor?.twitterUrl || "");
    setEditBlogUrl(competitor?.blogFeedUrl || "");
    setEditSocialFrequency(competitor?.socialCheckFrequency || "daily");
    // Also populate company profile fields
    setEditHeadquarters(competitor?.headquarters || "");
    setEditFounded(competitor?.founded || "");
    setEditEmployeeCount(competitor?.employeeCount || "");
    setEditRevenue(competitor?.revenue || "");
    setEditFundingRaised(competitor?.fundingRaised || "");
    setEditIndustry(competitor?.industry || "");
    setEditOpen(true);
  };

  const handleSaveSocial = () => {
    // Send empty strings so they can be cleared (API converts to null)
    updateSocialMutation.mutate({
      linkedInUrl: editLinkedIn,
      instagramUrl: editInstagram,
      twitterUrl: editTwitter,
      blogFeedUrl: editBlogUrl,
      socialCheckFrequency: editSocialFrequency,
      // Include company profile fields
      headquarters: editHeadquarters,
      founded: editFounded,
      employeeCount: editEmployeeCount,
      revenue: editRevenue,
      fundingRaised: editFundingRaised,
      industry: editIndustry,
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

  const websiteMonitorMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/competitors/${id}/monitor-website`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to monitor website");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      
      const result = data.result || data;
      toast({
        title: result.hasChanges ? "Website Changes Detected" : "No Changes Found",
        description: result.hasChanges 
          ? `${result.summary || "Website updates have been logged to Live Signals."}`
          : result.status === "no_content" 
            ? "Unable to crawl website - site may be unavailable"
            : "No significant changes detected on the website.",
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

  const generateReportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/competitors/${id}/report/pdf`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate report");
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = `Competitor_Report_${competitor?.name || "Report"}.pdf`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match) filename = match[1];
      }
      return { blob, filename };
    },
    onSuccess: ({ blob, filename }) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({
        title: "Report Generated",
        description: "Your competitor intelligence report has been downloaded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Report Generation Failed",
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

  const hasSocialUrls = competitor?.linkedInUrl || competitor?.instagramUrl || competitor?.twitterUrl;
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
                    <Calendar className="mr-1 h-3 w-3" /> Last crawled: {competitor.lastCrawl ? new Date(competitor.lastCrawl).toLocaleString() : "Never"}
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
                  {competitor.twitterUrl ? (
                    <a 
                      href={competitor.twitterUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="flex items-center gap-1 text-sm text-[#1DA1F2] hover:underline"
                      data-testid="link-twitter"
                    >
                      <Twitter className="h-4 w-4" /> Twitter/X
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground/50">
                      <Twitter className="h-4 w-4" /> No Twitter
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
                        <DialogTitle>Edit {competitor.name}</DialogTitle>
                        <DialogDescription>
                          Manage social media profiles, blog/RSS feeds, and product associations for this competitor.
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
                        <div className="space-y-2">
                          <Label htmlFor="twitter" className="flex items-center gap-2">
                            <Twitter className="h-4 w-4 text-[#1DA1F2]" /> Twitter/X URL
                          </Label>
                          <Input
                            id="twitter"
                            placeholder="https://x.com/..."
                            value={editTwitter}
                            onChange={(e) => setEditTwitter(e.target.value)}
                            data-testid="input-twitter"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="blogUrl" className="flex items-center gap-2">
                            <Rss className="h-4 w-4 text-orange-500" /> Blog or RSS Feed URL
                          </Label>
                          <Input
                            id="blogUrl"
                            placeholder="https://example.com/blog or https://example.com/feed.xml"
                            value={editBlogUrl}
                            onChange={(e) => setEditBlogUrl(e.target.value)}
                            data-testid="input-blog-url"
                          />
                          <p className="text-xs text-muted-foreground">RSS feeds, Atom feeds, or blog page URLs</p>
                        </div>
                        <div className="space-y-2 pt-2 border-t">
                          <Label htmlFor="frequency" className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 text-purple-500" /> Auto-check Frequency
                          </Label>
                          <select
                            id="frequency"
                            value={editSocialFrequency}
                            onChange={(e) => setEditSocialFrequency(e.target.value)}
                            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                            data-testid="select-social-frequency"
                          >
                            <option value="hourly">Hourly</option>
                            <option value="daily">Daily (default)</option>
                            <option value="weekly">Weekly</option>
                          </select>
                          <p className="text-xs text-muted-foreground">How often to automatically check this competitor's social media</p>
                        </div>
                        
                        {/* Company Profile Section */}
                        <div className="space-y-3 pt-4 border-t">
                          <p className="text-sm font-medium text-muted-foreground">Company Directory</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label htmlFor="headquarters" className="text-xs">Headquarters</Label>
                              <Input
                                id="headquarters"
                                placeholder="e.g. San Francisco, CA"
                                value={editHeadquarters}
                                onChange={(e) => setEditHeadquarters(e.target.value)}
                                className="h-9"
                                data-testid="input-headquarters"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="founded" className="text-xs">Year Founded</Label>
                              <Input
                                id="founded"
                                placeholder="e.g. 2015"
                                value={editFounded}
                                onChange={(e) => setEditFounded(e.target.value)}
                                className="h-9"
                                data-testid="input-founded"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="employees" className="text-xs">Employee Count</Label>
                              <Input
                                id="employees"
                                placeholder="e.g. 50-100 or 500+"
                                value={editEmployeeCount}
                                onChange={(e) => setEditEmployeeCount(e.target.value)}
                                className="h-9"
                                data-testid="input-employees"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="revenue" className="text-xs">Revenue</Label>
                              <Input
                                id="revenue"
                                placeholder="e.g. $10M-$50M"
                                value={editRevenue}
                                onChange={(e) => setEditRevenue(e.target.value)}
                                className="h-9"
                                data-testid="input-revenue"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="funding" className="text-xs">Funding Raised</Label>
                              <Input
                                id="funding"
                                placeholder="e.g. $25M Series B"
                                value={editFundingRaised}
                                onChange={(e) => setEditFundingRaised(e.target.value)}
                                className="h-9"
                                data-testid="input-funding"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="industry" className="text-xs">Industry</Label>
                              <Input
                                id="industry"
                                placeholder="e.g. Technology"
                                value={editIndustry}
                                onChange={(e) => setEditIndustry(e.target.value)}
                                className="h-9"
                                data-testid="input-industry"
                              />
                            </div>
                          </div>
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
                onClick={() => websiteMonitorMutation.mutate()}
                disabled={websiteMonitorMutation.isPending}
                data-testid="button-scan-website"
              >
                <RefreshCw className={cn("h-4 w-4", websiteMonitorMutation.isPending && "animate-spin")} /> 
                {websiteMonitorMutation.isPending ? "Scanning..." : "Scan Website"}
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
              
              <Button 
                className="gap-2"
                onClick={() => generateReportMutation.mutate()}
                disabled={generateReportMutation.isPending}
                data-testid="button-generate-report"
              >
                {generateReportMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" /> Generate Report
                  </>
                )}
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
              {orbitScore !== null ? (
                <>
                  <div className="text-3xl font-bold text-foreground">{orbitScore.toFixed(0)}<span className="text-lg text-muted-foreground font-normal">/100</span></div>
                  <p className="text-xs text-muted-foreground mt-1">Calculated competitive score</p>
                </>
              ) : (
                <>
                  <div className="text-3xl font-bold text-muted-foreground">—</div>
                  <p className="text-xs text-muted-foreground mt-1">Run analysis to calculate</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Messaging Themes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${messagingOverlap.level === "High" ? "text-destructive" : messagingOverlap.level === "Medium" ? "text-yellow-500" : messagingOverlap.level === "Low" ? "text-green-500" : "text-muted-foreground"}`}>
                {messagingOverlap.level}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{messagingOverlap.detail}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{recentActivityCount}</div>
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
                {analysisData?.summary || analysisData?.positioning ? (
                  <>
                    <p className="text-muted-foreground leading-relaxed">
                      {analysisData.summary || analysisData.positioning}
                    </p>
                    {analysisData.targetAudience && (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Target Audience:</span> {analysisData.targetAudience}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {analysisData.keyDifferentiators?.slice(0, 3).map((diff, i) => (
                        <Badge key={i} variant="outline" className="bg-primary/5 text-primary border-primary/20">
                          {diff}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <FileSearch className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-muted-foreground text-sm">
                      No analysis data yet. Run a crawl and analysis to generate insights.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tags className="h-4 w-4 text-primary" />
                    Keywords & Tone
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(analysisData?.keywords && analysisData.keywords.length > 0) || (analysisData?.messagingThemes && analysisData.messagingThemes.length > 0) ? (
                    <div className="flex flex-wrap gap-2">
                      {(analysisData.keywords || analysisData.messagingThemes || []).map((kw, i) => (
                        <Badge key={i} variant="secondary" className="px-3 py-1">{kw}</Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <p className="text-muted-foreground text-sm">No keywords detected yet.</p>
                    </div>
                  )}
                  {analysisData?.tone && (
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">Tone</p>
                      <p className="text-sm text-primary">{analysisData.tone}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Key Messages
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {analysisData?.keyMessages && analysisData.keyMessages.length > 0 ? (
                    <ul className="space-y-3">
                      {analysisData.keyMessages.map((msg, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                          <span>{msg}</span>
                        </li>
                      ))}
                    </ul>
                  ) : analysisData?.valuePropositions && analysisData.valuePropositions.length > 0 ? (
                    <ul className="space-y-2">
                      {analysisData.valuePropositions.map((vp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Target className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span>{vp}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="h-[80px] flex flex-col items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-muted-foreground/50 mb-2" />
                      <p className="text-muted-foreground text-sm">No key messages detected yet.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            
            {/* Company Profile Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Company Profile
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={handleEditOpen} data-testid="button-edit-profile">
                  <Pencil className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                {(competitor?.headquarters || competitor?.founded || competitor?.employeeCount || competitor?.revenue || competitor?.fundingRaised || competitor?.industry) ? (
                  <div className="grid gap-4 md:grid-cols-6">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> Headquarters
                      </p>
                      <p className="text-sm">{competitor.headquarters || "—"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Founded
                      </p>
                      <p className="text-sm">{competitor.founded || "—"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Users className="h-3 w-3" /> Employees
                      </p>
                      <p className="text-sm">{competitor.employeeCount || "—"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <DollarSign className="h-3 w-3" /> Revenue
                      </p>
                      <p className="text-sm">{competitor.revenue || "—"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" /> Funding Raised
                      </p>
                      <p className="text-sm">{competitor.fundingRaised || "—"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> Industry
                      </p>
                      <p className="text-sm">{competitor.industry || "—"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Building2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-muted-foreground text-sm mb-3">
                      No company profile data yet. Click edit to add details or run AI research.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
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
          
          <TabsContent value="messaging" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {!analysisData ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Messaging Analysis</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Run a full analysis to extract messaging themes, value propositions, and competitive positioning.
                  </p>
                  <Button 
                    onClick={() => crawlMutation.mutate()}
                    disabled={crawlMutation.isPending}
                    data-testid="button-analyze-messaging"
                  >
                    {crawlMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
                    ) : (
                      <><RefreshCw className="h-4 w-4 mr-2" /> Run Analysis</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {analysisData.positioning && (
                  <Card className="md:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" />
                        Market Positioning
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground leading-relaxed">{analysisData.positioning}</p>
                    </CardContent>
                  </Card>
                )}

                {analysisData.targetAudience && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Eye className="h-5 w-5 text-blue-500" />
                        Target Audience
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">{analysisData.targetAudience}</p>
                    </CardContent>
                  </Card>
                )}

                {analysisData.messagingThemes && analysisData.messagingThemes.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Hash className="h-5 w-5 text-purple-500" />
                        Messaging Themes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {analysisData.messagingThemes.map((theme, i) => (
                          <Badge key={i} variant="secondary" className="px-3 py-1">{theme}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {analysisData.valuePropositions && analysisData.valuePropositions.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-yellow-500" />
                        Value Propositions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysisData.valuePropositions.map((vp, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">{vp}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {analysisData.keyDifferentiators && analysisData.keyDifferentiators.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-green-500" />
                        Key Differentiators
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysisData.keyDifferentiators.map((diff, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <TrendingUp className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">{diff}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="pages" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {!crawlData?.pages || crawlData.pages.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <FileSearch className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Pages Tracked</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Run a crawl to discover and track pages from this competitor's website.
                  </p>
                  <Button 
                    onClick={() => crawlMutation.mutate()}
                    disabled={crawlMutation.isPending}
                    data-testid="button-crawl-pages"
                  >
                    {crawlMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Crawling...</>
                    ) : (
                      <><RefreshCw className="h-4 w-4 mr-2" /> Start Crawl</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Tracked Pages</h3>
                    <p className="text-sm text-muted-foreground">
                      {crawlData.pages.length} pages discovered • {crawlData.totalWordCount?.toLocaleString() || 0} total words
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => crawlMutation.mutate()}
                    disabled={crawlMutation.isPending}
                    data-testid="button-recrawl-pages"
                  >
                    {crawlMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><RefreshCw className="h-4 w-4 mr-1" /> Re-crawl</>
                    )}
                  </Button>
                </div>
                <div className="grid gap-3">
                  {crawlData.pages.map((page, i) => (
                    <Card key={i} className="hover:border-primary/50 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{page.title || page.url}</h4>
                            <a 
                              href={page.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 truncate"
                            >
                              <Globe className="h-3 w-3 shrink-0" />
                              <span className="truncate">{page.url}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          </div>
                          <div className="text-right shrink-0">
                            {page.wordCount && (
                              <Badge variant="secondary" className="mb-1">
                                {page.wordCount.toLocaleString()} words
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="history" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {competitorActivity.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <Clock className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Activity History</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Activity will appear here after crawls, monitoring checks, or detected changes.
                  </p>
                  <Button 
                    onClick={() => crawlMutation.mutate()}
                    disabled={crawlMutation.isPending}
                    data-testid="button-first-crawl"
                  >
                    {crawlMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</>
                    ) : (
                      <><RefreshCw className="h-4 w-4 mr-2" /> Run First Crawl</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Activity Timeline</h3>
                  <Badge variant="outline">{competitorActivity.length} events</Badge>
                </div>
                <div className="space-y-3">
                  {competitorActivity.slice(0, 20).map((activity: any) => (
                    <Card key={activity.id} className="hover:border-primary/30 transition-colors" data-testid={`activity-${activity.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            activity.activityType === "website_change" ? "bg-blue-500/20 text-blue-500" :
                            activity.activityType === "social_update" ? "bg-purple-500/20 text-purple-500" :
                            activity.activityType === "blog_post" ? "bg-orange-500/20 text-orange-500" :
                            activity.activityType === "crawl" ? "bg-green-500/20 text-green-500" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {activity.activityType === "website_change" ? <AlertCircle className="h-4 w-4" /> :
                             activity.activityType === "social_update" ? <MessageSquare className="h-4 w-4" /> :
                             activity.activityType === "blog_post" ? <Rss className="h-4 w-4" /> :
                             <Activity className="h-4 w-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">
                                {activity.activityType === "website_change" ? "Website Change" :
                                 activity.activityType === "social_update" ? "Social Update" :
                                 activity.activityType === "blog_post" ? "Blog Post" :
                                 activity.activityType === "crawl" ? "Crawl Completed" :
                                 activity.activityType || "Activity"}
                              </span>
                              {activity.impact && (
                                <Badge variant={
                                  activity.impact === "high" ? "destructive" :
                                  activity.impact === "medium" ? "default" : "secondary"
                                } className="text-xs">
                                  {activity.impact}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {activity.description || activity.summary || "Activity recorded"}
                            </p>
                            <p className="text-xs text-muted-foreground/70 mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(activity.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {competitorActivity.length > 20 && (
                    <p className="text-center text-sm text-muted-foreground py-2">
                      Showing 20 of {competitorActivity.length} events
                    </p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
