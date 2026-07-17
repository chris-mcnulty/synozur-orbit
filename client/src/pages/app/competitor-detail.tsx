import React, { useState, useEffect } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CompetitorDocuments from "@/components/CompetitorDocuments";
import CompetitorPricing from "@/components/CompetitorPricing";
import { useFeatureAccess } from "@/components/UpgradePrompt";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, ExternalLink, Globe, Calendar, RefreshCw, BarChart2, FileText, Linkedin, Instagram, Twitter, Facebook, Pencil, Activity, Lock, Swords, Sparkles, Target, Shield, MessageSquare, TrendingUp, Loader2, Check, X, Clock, FileSearch, AlertCircle, Eye, Rss, Hash, Tags, Download, Building2, DollarSign, Users, AlertTriangle, Ban, Search, MoreHorizontal } from "lucide-react";
import { AIResearchDialog } from "@/components/AIResearchDialog";
import RefreshStrategyDialog from "@/components/RefreshStrategyDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import DataFreshnessBar from "@/components/DataFreshnessBar";
import { AnnotationRail } from "@/components/collaboration/CollabComponents";
import { useUser } from "@/lib/userContext";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer } from "recharts";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import { formatCompactUsd, formatLifecycleStage, buildHubspotCompanyUrl } from "@/lib/hubspot-format";

const COMPETITOR_TABS = ["overview", "battlecard", "messaging", "pages", "seo", "documents", "pricing", "history"] as const;
type CompetitorTab = typeof COMPETITOR_TABS[number];

function getCompetitorTabFromHash(): CompetitorTab {
  const hash = window.location.hash.replace("#", "");
  return (COMPETITOR_TABS as readonly string[]).includes(hash) ? (hash as CompetitorTab) : "overview";
}

export default function CompetitorDetail() {
  const [, params] = useRoute("/app/competitors/:id");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useUser();
  const isAdmin = currentUser?.role === "Domain Admin" || currentUser?.role === "Global Admin";
  const [activeTab, setActiveTab] = useState<CompetitorTab>(getCompetitorTabFromHash);
  const [editOpen, setEditOpen] = useState(false);
  const [editLinkedIn, setEditLinkedIn] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editTwitter, setEditTwitter] = useState("");
  const [editFacebook, setEditFacebook] = useState("");
  const [editBlogUrl, setEditBlogUrl] = useState("");
  const [editSocialFrequency, setEditSocialFrequency] = useState("daily");
  const [excludeFromCrawl, setExcludeFromCrawl] = useState(false);
  
  // Company Profile editing state (shared with main edit dialog)
  const [editHeadquarters, setEditHeadquarters] = useState("");
  const [editFounded, setEditFounded] = useState("");
  const [editEmployeeCount, setEditEmployeeCount] = useState("");
  const [editRevenue, setEditRevenue] = useState("");
  const [editFundingRaised, setEditFundingRaised] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [aiResearchOpen, setAiResearchOpen] = useState(false);
  const [refreshStrategyOpen, setRefreshStrategyOpen] = useState(false);

  useEffect(() => {
    const onHashChange = () => setActiveTab(getCompetitorTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    setActiveTab(getCompetitorTabFromHash());
  }, [id]);

  const { data: contextData } = useQuery<{ activeMarket?: { businessType?: string } }>({
    queryKey: ["/api/context"],
    queryFn: async () => {
      const response = await fetch("/api/context", { credentials: "include" });
      if (!response.ok) return {};
      return response.json();
    },
  });
  const isB2C = contextData?.activeMarket?.businessType === "b2c";
  const { isAllowed: competitorDocsAllowed } = useFeatureAccess("competitorDocuments");

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

  const { data: hubspotStatus } = useQuery<{ connected: boolean; connection: { hubspotPortalId: string | null } | null }>({
    queryKey: ["/api/integrations/hubspot/status"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/hubspot/status", { credentials: "include" });
      if (!res.ok) return { connected: false, connection: null };
      return res.json();
    },
    retry: false,
  });
  const hubspotPortalId = hubspotStatus?.connection?.hubspotPortalId ?? null;
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
    mutationFn: async (data: { linkedInUrl?: string; instagramUrl?: string; twitterUrl?: string; facebookUrl?: string; blogFeedUrl?: string; socialCheckFrequency?: string; excludeFromCrawl?: boolean; headquarters?: string; founded?: string; employeeCount?: string; revenue?: string; fundingRaised?: string; industry?: string }) => {
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
    setEditFacebook(competitor?.facebookUrl || "");
    setEditBlogUrl(competitor?.blogFeedUrl || "");
    setEditSocialFrequency(competitor?.socialCheckFrequency || "daily");
    setExcludeFromCrawl(competitor?.excludeFromCrawl || false);
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
      facebookUrl: editFacebook,
      blogFeedUrl: editBlogUrl,
      socialCheckFrequency: editSocialFrequency,
      excludeFromCrawl: excludeFromCrawl,
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

  const excludeFromCrawlMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/flagged-crawls/competitor/${id}/exclude`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to exclude from crawl");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      toast({ title: "Excluded from Crawl", description: "This competitor will no longer be crawled." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to exclude from crawl. Please try again.", variant: "destructive" });
    },
  });

  const dismissFlagMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/flagged-crawls/competitor/${id}/dismiss`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to dismiss flag");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      toast({ title: "Flag Dismissed", description: "Crawl failure counter has been reset." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to dismiss flag. Please try again.", variant: "destructive" });
    },
  });

  const resumeCrawlMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/flagged-crawls/competitor/${id}/resume`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to resume crawling");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
      toast({ title: "Crawling Resumed", description: "This competitor will be crawled again in the next sweep." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to resume crawling. Please try again.", variant: "destructive" });
    },
  });

  const hasSocialUrls = competitor?.linkedInUrl || competitor?.instagramUrl || competitor?.twitterUrl || competitor?.facebookUrl;
  const isPremium = monitoringSettings?.isPremium;

  const breadcrumbs = [
    { label: "Competitors", href: "/app/competitors" },
    { label: competitor?.name || "Loading..." },
  ];

  if (isLoading) {
    return (
      <AppLayout breadcrumbs={breadcrumbs}>
        <div className="flex items-center justify-center h-[50vh]">
          <p className="text-muted-foreground">Loading competitor...</p>
        </div>
      </AppLayout>
    );
  }

  if (error || !competitor) {
    return (
      <AppLayout breadcrumbs={[{ label: "Competitors", href: "/app/competitors" }, { label: "Not Found" }]}>
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
    <AppLayout breadcrumbs={breadcrumbs}>
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {id && (
          <div className="mb-6">
            <AnnotationRail
              targetKind="competitor"
              targetId={id}
              readOnly={currentUser?.role === "Consultant"}
            />
          </div>
        )}
        <div className="mb-8">
          <Link href="/app/competitors" className="text-sm text-muted-foreground hover:text-foreground flex items-center mb-4 transition-colors">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Competitors
          </Link>

          {competitor.crawlFlaggedAt && !competitor.excludeFromCrawl && (
            <div className="mb-4 p-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 flex items-start gap-3" data-testid="banner-crawl-flagged">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-300">Repeated crawl failures detected</p>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                  This competitor has failed {competitor.consecutiveCrawlFailures} consecutive crawl attempts. The site may block automated crawlers. Consider excluding it from crawl.
                </p>
                {isAdmin && (
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => excludeFromCrawlMutation.mutate()}
                      disabled={excludeFromCrawlMutation.isPending}
                      data-testid="button-exclude-crawl"
                    >
                      <Ban className="h-3 w-3 mr-1" /> Exclude from Crawl
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dismissFlagMutation.mutate()}
                      disabled={dismissFlagMutation.isPending}
                      data-testid="button-dismiss-flag"
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {competitor.excludeFromCrawl && (
            <div className="mb-4 p-4 rounded-lg border border-muted bg-muted/50 flex items-start gap-3" data-testid="banner-excluded-crawl">
              <Ban className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">Automated crawling is paused</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {competitor.consecutiveCrawlFailures
                    ? `Crawling was paused after ${competitor.consecutiveCrawlFailures} consecutive failures. The site may be blocking automated requests.`
                    : "This competitor has been manually excluded from automated crawling."}
                </p>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => resumeCrawlMutation.mutate()}
                    disabled={resumeCrawlMutation.isPending}
                    data-testid="button-resume-crawl"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" /> Resume Crawling
                  </Button>
                )}
              </div>
            </div>
          )}
          
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
                {(() => {
                  const c = competitor as { hubspotCompanyId?: string | null; hubspotOpenDealCount?: number | null; hubspotOpenDealValue?: number | null; hubspotLifecycleStage?: string | null };
                  if (!c.hubspotCompanyId) return null;
                  const dealCount = c.hubspotOpenDealCount ?? 0;
                  const dealValue = c.hubspotOpenDealValue ?? 0;
                  if (dealCount <= 0 && !c.hubspotLifecycleStage) return null;
                  const companyHref = buildHubspotCompanyUrl(hubspotPortalId, c.hubspotCompanyId!);
                  return (
                    <div className="flex items-center gap-2 mt-2 flex-wrap" data-testid="hubspot-context">
                      {dealCount > 0 && (
                        <a
                          href={companyHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="badge-hubspot-deals"
                        >
                          <Badge variant="outline" className="text-orange-600 border-orange-300 dark:text-orange-400 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30">
                            {dealCount} open deal{dealCount === 1 ? "" : "s"}
                            {dealValue > 0 ? ` · ${formatCompactUsd(dealValue)}` : ""}
                            <ExternalLink className="w-3 h-3 ml-1" />
                          </Badge>
                        </a>
                      )}
                      {c.hubspotLifecycleStage && (
                        <Badge
                          variant="outline"
                          className="text-orange-600 border-orange-300 dark:text-orange-400 dark:border-orange-700"
                          data-testid="badge-hubspot-lifecycle"
                        >
                          {formatLifecycleStage(c.hubspotLifecycleStage)}
                        </Badge>
                      )}
                    </div>
                  );
                })()}
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
                  {competitor.facebookUrl ? (
                    <a 
                      href={competitor.facebookUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="flex items-center gap-1 text-sm text-[#1877F2] hover:underline"
                      data-testid="link-facebook"
                    >
                      <Facebook className="h-4 w-4" /> Facebook
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground/50">
                      <Facebook className="h-4 w-4" /> No Facebook
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
                          <Label htmlFor="facebook" className="flex items-center gap-2">
                            <Facebook className="h-4 w-4 text-[#1877F2]" /> Facebook URL
                          </Label>
                          <Input
                            id="facebook"
                            placeholder="https://facebook.com/..."
                            value={editFacebook}
                            onChange={(e) => setEditFacebook(e.target.value)}
                            data-testid="input-facebook"
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
                        <div className="flex items-center justify-between pt-2 border-t">
                          <div className="space-y-0.5">
                            <Label htmlFor="exclude-crawl" className="text-base">Exclude from Auto-Crawl</Label>
                            <p className="text-sm text-muted-foreground">Stop this competitor from being automatically crawled during scheduled jobs.</p>
                          </div>
                          <input
                            type="checkbox"
                            id="exclude-crawl"
                            checked={excludeFromCrawl}
                            onChange={(e) => setExcludeFromCrawl(e.target.checked)}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                            data-testid="checkbox-exclude-crawl"
                          />
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
            
            <div className="flex items-center gap-2">
              <Button 
                className="gap-2 bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                onClick={() => setAiResearchOpen(true)}
                data-testid="button-ai-research"
              >
                <Sparkles className="h-4 w-4" /> AI Research
              </Button>
              <Button 
                variant="outline" 
                className="gap-2"
                onClick={() => setRefreshStrategyOpen(true)}
                data-testid="button-refresh-competitor"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" data-testid="button-more-actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => websiteMonitorMutation.mutate()}
                    disabled={websiteMonitorMutation.isPending}
                    data-testid="button-scan-website"
                  >
                    {websiteMonitorMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Globe className="h-4 w-4 mr-2" />
                    )}
                    Crawl Website
                  </DropdownMenuItem>
                  {hasSocialUrls && (
                    <DropdownMenuItem
                      onClick={() => socialMonitorMutation.mutate()}
                      disabled={!isPremium || socialMonitorMutation.isPending}
                      data-testid="button-monitor-social"
                    >
                      {socialMonitorMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Activity className="h-4 w-4 mr-2" />
                      )}
                      Check Socials
                      {!isPremium && <Lock className="h-3 w-3 ml-1" />}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => generateReportMutation.mutate()}
                    disabled={generateReportMutation.isPending}
                    data-testid="button-generate-report"
                  >
                    {generateReportMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Generate Report
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

        <DataFreshnessBar
          mode="entity"
          entityName={competitor.name}
          entityType="competitor"
          websiteLastUpdated={competitor.lastFullCrawl || competitor.lastCrawl || null}
          socialLastUpdated={competitor.lastSocialCrawl || null}
          autoRefreshAllowed={false}
          readOnly
          onRefresh={async (sources) => {
            if (sources.includes("website")) {
              await fetch(`/api/competitors/${id}/crawl`, { method: "POST", credentials: "include" });
              toast({ title: "Website crawl started", description: `${competitor.name} is being refreshed` });
            }
            if (sources.includes("social")) {
              await fetch(`/api/competitors/${id}/refresh-social`, { method: "POST", credentials: "include" });
              toast({ title: "Social refresh started", description: `${competitor.name} social data is being updated` });
            }
            queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
          }}
        />

        <Tabs value={activeTab} onValueChange={(tab) => {
          setActiveTab(tab as CompetitorTab);
          window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + tab);
        }} className="space-y-6">
          <TabsList className="bg-muted/50 p-1 border border-border rounded-lg">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="battlecard" data-testid="tab-battlecard">
              <Swords className="h-4 w-4 mr-1" /> Battlecard
            </TabsTrigger>
            <TabsTrigger value="messaging">Messaging</TabsTrigger>
            <TabsTrigger value="pages">Pages Tracked</TabsTrigger>
            <TabsTrigger value="seo" data-testid="tab-seo">
              <Search className="h-4 w-4 mr-1" /> SEO &amp; Visibility
            </TabsTrigger>
            <TabsTrigger value="documents" data-testid="tab-documents">
              <FileText className="h-4 w-4 mr-1" /> Documents
            </TabsTrigger>
            <TabsTrigger value="pricing" data-testid="tab-pricing">
              <DollarSign className="h-4 w-4 mr-1" /> Pricing
            </TabsTrigger>
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

            {isB2C && (
              <Card className="border-orange-400/30 bg-gradient-to-r from-orange-50/50 to-pink-50/50 dark:from-orange-950/20 dark:to-pink-950/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Instagram className="h-4 w-4 text-[#E4405F]" />
                    Social Engagement Insights
                    <Badge variant="outline" className="text-[10px] border-orange-400/50 text-orange-600 dark:text-orange-400 ml-auto">B2C Priority</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const igData = competitor?.instagramEngagement as { followers?: number; posts?: number; likes?: number; comments?: number; capturedAt?: string } | null;
                    const liData = competitor?.linkedInEngagement as { followers?: number; posts?: number; reactions?: number; comments?: number } | null;
                    const hasIg = igData && (igData.followers || igData.posts || igData.likes);
                    const hasLi = liData && (liData.followers || liData.posts || liData.reactions);
                    
                    if (!hasIg && !hasLi) {
                      return (
                        <div className="text-center py-4">
                          <Instagram className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                          <p className="text-muted-foreground text-sm">No social engagement data yet.</p>
                          <p className="text-muted-foreground text-xs mt-1">Add Instagram and LinkedIn URLs, then run a social check to capture metrics.</p>
                        </div>
                      );
                    }
                    
                    const formatNum = (n: number) => {
                      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
                      if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
                      return n.toLocaleString();
                    };
                    
                    return (
                      <div className="space-y-4">
                        {hasIg && (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <Instagram className="h-4 w-4 text-[#E4405F]" />
                              <span className="text-sm font-medium">Instagram</span>
                              {igData.capturedAt && (
                                <span className="text-[10px] text-muted-foreground ml-auto">
                                  Updated {new Date(igData.capturedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                              <div className="text-center p-3 rounded-lg bg-background/80">
                                <Users className="h-4 w-4 mx-auto mb-1 text-[#E4405F]" />
                                <p className="text-lg font-bold" data-testid="text-ig-followers">{formatNum(igData.followers || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">Followers</p>
                              </div>
                              <div className="text-center p-3 rounded-lg bg-background/80">
                                <Hash className="h-4 w-4 mx-auto mb-1 text-[#E4405F]" />
                                <p className="text-lg font-bold" data-testid="text-ig-posts">{formatNum(igData.posts || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">Posts</p>
                              </div>
                              <div className="text-center p-3 rounded-lg bg-background/80">
                                <TrendingUp className="h-4 w-4 mx-auto mb-1 text-[#E4405F]" />
                                <p className="text-lg font-bold" data-testid="text-ig-likes">{formatNum(igData.likes || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">Likes</p>
                              </div>
                            </div>
                          </div>
                        )}
                        {hasLi && (
                          <div className={hasIg ? "pt-3 border-t" : ""}>
                            <div className="flex items-center gap-2 mb-3">
                              <Linkedin className="h-4 w-4 text-[#0A66C2]" />
                              <span className="text-sm font-medium">LinkedIn</span>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                              <div className="text-center p-3 rounded-lg bg-background/80">
                                <Users className="h-4 w-4 mx-auto mb-1 text-[#0A66C2]" />
                                <p className="text-lg font-bold" data-testid="text-li-followers">{formatNum(liData.followers || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">Followers</p>
                              </div>
                              <div className="text-center p-3 rounded-lg bg-background/80">
                                <Hash className="h-4 w-4 mx-auto mb-1 text-[#0A66C2]" />
                                <p className="text-lg font-bold" data-testid="text-li-posts">{formatNum(liData.posts || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">Posts</p>
                              </div>
                              <div className="text-center p-3 rounded-lg bg-background/80">
                                <TrendingUp className="h-4 w-4 mx-auto mb-1 text-[#0A66C2]" />
                                <p className="text-lg font-bold" data-testid="text-li-reactions">{formatNum(liData.reactions || 0)}</p>
                                <p className="text-[10px] text-muted-foreground">Reactions</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

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

            <CompetitorTonePanel competitorId={competitor.id} competitorName={competitor.name} />
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
          
          <TabsContent value="seo" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <CompetitorSeoPanel competitorId={id!} competitorName={competitor.name} />
          </TabsContent>

          <TabsContent value="documents" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <CompetitorDocuments
              competitorId={id!}
              competitorName={competitor.name}
              featureEnabled={competitorDocsAllowed}
              latestSources={
                (analysisData as { competitorDocSources?: Array<{
                  id: string;
                  competitorId: string;
                  displayTitle: string;
                  scopeTag: string | null;
                }> } | null)?.competitorDocSources || []
              }
            />
          </TabsContent>

          <TabsContent value="pricing" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <CompetitorPricing
              competitorId={id!}
              competitorName={competitor.name}
              initialPricingUrl={competitor.pricingPageUrl}
            />
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

      <AIResearchDialog
        open={aiResearchOpen}
        onOpenChange={setAiResearchOpen}
        entityType="competitor"
        entityId={competitor.id}
        entityName={competitor.name}
        entityUrl={competitor.url}
      />

      <RefreshStrategyDialog
        open={refreshStrategyOpen}
        onOpenChange={setRefreshStrategyOpen}
        entityName={competitor.name}
        entityType="competitor"
        sources={{
          website: { lastUpdated: competitor.lastFullCrawl || competitor.lastCrawl || null },
          ...(hasSocialUrls ? { social: { lastUpdated: competitor.lastSocialCrawl || null } } : {}),
        }}
        onConfirm={async (selectedSources) => {
          if (selectedSources.includes("website")) {
            await fetch(`/api/competitors/${id}/crawl`, { method: "POST", credentials: "include" });
            toast({ title: "Website crawl started", description: `${competitor.name} is being refreshed` });
          }
          if (selectedSources.includes("social")) {
            await fetch(`/api/competitors/${id}/refresh-social`, { method: "POST", credentials: "include" });
            toast({ title: "Social refresh started", description: `${competitor.name} social data is being updated` });
          }
          queryClient.invalidateQueries({ queryKey: ["/api/competitors", id] });
        }}
      />
    </AppLayout>
  );
}

interface SeoKeywordRow {
  keywordId: string;
  keyword: string;
  country: string;
  rank: number | null;
  previousRank: number | null;
  weekOverWeekChange: number | null;
  estimatedTraffic: number;
  shareOfVoice: number;
  capturedAt: string | null;
}

interface SeoMetricRow {
  id: string;
  keywordId: string;
  entityType: string;
  entityId: string | null;
  entityName: string;
  rank: number | null;
  estimatedTraffic: number;
  shareOfVoice: number;
  capturedAt: string;
}

function CompetitorSeoPanel({ competitorId, competitorName }: { competitorId: string; competitorName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ competitorId: string; keywords: SeoKeywordRow[]; baselineMetrics: SeoMetricRow[] }>({
    queryKey: ["/api/competitors", competitorId, "seo"],
    queryFn: async () => {
      const res = await fetch(`/api/competitors/${competitorId}/seo`, { credentials: "include" });
      if (res.status === 403) {
        const err: any = new Error("Feature locked");
        err.status = 403;
        throw err;
      }
      if (!res.ok) throw new Error("Failed to load SEO metrics");
      return res.json();
    },
  });

  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const selectedKeyword = data?.keywords.find((k) => k.keywordId === (selectedKeywordId || data.keywords[0]?.keywordId));

  const { data: history } = useQuery<SeoMetricRow[]>({
    queryKey: ["/api/seo/keywords", selectedKeyword?.keywordId, "history"],
    queryFn: async () => {
      if (!selectedKeyword) return [];
      const res = await fetch(`/api/seo/keywords/${selectedKeyword.keywordId}/history`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedKeyword,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/seo/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Refresh failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "SEO data refreshed", description: "Latest rankings have been recorded." });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors", competitorId, "seo"] });
      queryClient.invalidateQueries({ queryKey: ["/api/seo/keywords"] });
    },
    onError: (err: Error) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  if (error && (error as any).status === 403) {
    return (
      <Card data-testid="seo-feature-locked">
        <CardContent className="pt-8 text-center space-y-4">
          <Lock className="h-12 w-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">Upgrade to Pro</h3>
          <p className="text-sm text-muted-foreground">
            SEO &amp; Share-of-Voice tracking is available on Pro, Enterprise, and Unlimited plans.
          </p>
          <Button onClick={() => window.location.href = "/pricing"} data-testid="button-upgrade-seo">View Plans</Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" /> Loading SEO data...
        </CardContent>
      </Card>
    );
  }

  const rows = data?.keywords ?? [];
  const trendData = (history || [])
    .filter((h) => h.entityType === "competitor" && h.entityId === competitorId)
    .map((h) => ({
      date: new Date(h.capturedAt).toLocaleDateString(),
      rank: h.rank,
      shareOfVoice: h.shareOfVoice / 100,
    }))
    .reverse();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" /> Tracked Keywords
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              How {competitorName} ranks for keywords tracked in this market.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/app/seo-dashboard">
              <Button variant="outline" size="sm" data-testid="link-seo-dashboard">
                <BarChart2 className="h-4 w-4 mr-1" /> Share-of-Voice Dashboard
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || rows.length === 0}
              data-testid="button-refresh-seo"
            >
              {refreshMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground" data-testid="text-seo-empty">
              No keywords tracked yet. Add keywords from the{" "}
              <Link href="/app/seo-dashboard" className="text-primary underline">SEO Dashboard</Link> to start tracking.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2">Keyword</th>
                    <th className="py-2 pr-2">Country</th>
                    <th className="py-2 pr-2">Rank</th>
                    <th className="py-2 pr-2">WoW</th>
                    <th className="py-2 pr-2">Est. Traffic</th>
                    <th className="py-2 pr-2">Share of Voice</th>
                    <th className="py-2 pr-2">Last captured</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.keywordId}
                      className={cn(
                        "border-b cursor-pointer hover:bg-muted/40",
                        selectedKeyword?.keywordId === row.keywordId && "bg-muted/30",
                      )}
                      onClick={() => setSelectedKeywordId(row.keywordId)}
                      data-testid={`row-seo-keyword-${row.keywordId}`}
                    >
                      <td className="py-2 pr-2 font-medium" data-testid={`text-keyword-${row.keywordId}`}>{row.keyword}</td>
                      <td className="py-2 pr-2 uppercase text-xs text-muted-foreground">{row.country}</td>
                      <td className="py-2 pr-2" data-testid={`text-rank-${row.keywordId}`}>
                        {row.rank ? <Badge variant={row.rank <= 10 ? "default" : "secondary"}>#{row.rank}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-2" data-testid={`text-wow-${row.keywordId}`}>
                        {row.weekOverWeekChange === null ? (
                          <span className="text-muted-foreground inline-flex items-center"><Minus className="h-3 w-3" /></span>
                        ) : row.weekOverWeekChange > 0 ? (
                          <span className="text-emerald-500 inline-flex items-center"><ArrowUp className="h-3 w-3 mr-1" />{row.weekOverWeekChange}</span>
                        ) : row.weekOverWeekChange < 0 ? (
                          <span className="text-red-500 inline-flex items-center"><ArrowDown className="h-3 w-3 mr-1" />{Math.abs(row.weekOverWeekChange)}</span>
                        ) : (
                          <span className="text-muted-foreground inline-flex items-center"><Minus className="h-3 w-3" /></span>
                        )}
                      </td>
                      <td className="py-2 pr-2" data-testid={`text-traffic-${row.keywordId}`}>{row.estimatedTraffic.toLocaleString()}</td>
                      <td className="py-2 pr-2" data-testid={`text-sov-${row.keywordId}`}>{(row.shareOfVoice / 100).toFixed(1)}%</td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground">
                        {row.capturedAt ? new Date(row.capturedAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedKeyword && trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ranking trend — &ldquo;{selectedKeyword.keyword}&rdquo;</CardTitle>
            <p className="text-sm text-muted-foreground">Most recent rank captures (lower is better).</p>
          </CardHeader>
          <CardContent className="h-72" data-testid="chart-seo-trend">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis reversed allowDecimals={false} tick={{ fontSize: 11 }} domain={[1, "dataMax"]} />
                <ReTooltip />
                <Line type="monotone" dataKey="rank" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =====================================================================
// Task #102 — Tone & Sentiment panel (overview tab)
// =====================================================================

interface ToneSummaryResponse {
  competitorId: string;
  sinceDays: number;
  totalAnalyzed: number;
  meanSentiment: number | null;
  meanSentiment30d: number | null;
  meanSentiment90d: number | null;
  recentMeanSentiment: number | null;
  dominantTone: string | null;
  toneCounts: Record<string, number>;
  sparkline: { date: string; sentiment: number; toneLabel: string | null }[];
  topNotes: { date: string; toneLabel: string | null; sentimentScore: number; note: string }[];
  toneShifts: { date: string; fromTone: string | null; toTone: string }[];
}

function sentimentColor(score: number): string {
  if (score > 0.25) return "hsl(142 76% 36%)";
  if (score < -0.25) return "hsl(0 76% 50%)";
  return "hsl(45 93% 47%)";
}

function formatSentiment(score: number | null): string {
  if (score === null || score === undefined) return "—";
  return (score >= 0 ? "+" : "") + score.toFixed(2);
}

function CompetitorTonePanel({ competitorId, competitorName }: { competitorId: string; competitorName: string }) {
  const { isAllowed, isLoading: planLoading } = useFeatureAccess("sentimentAnalysis");

  const { data, isLoading } = useQuery<ToneSummaryResponse>({
    queryKey: [`/api/competitors/${competitorId}/tone`],
    enabled: isAllowed && !planLoading,
    staleTime: 60_000,
  });

  if (planLoading) return null;

  if (!isAllowed) {
    return (
      <Card data-testid="card-tone-locked">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Tone & Sentiment
            <Badge variant="outline" className="ml-2 gap-1"><Lock className="h-3 w-3" /> Pro</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Track how {competitorName}'s tone shifts over time across captured content. Available on Pro and above.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="card-tone-loading">
        <CardContent className="p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Analyzing tone…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalAnalyzed === 0) {
    return (
      <Card data-testid="card-tone-empty">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> Tone & Sentiment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No analyzed content yet. As we capture website, social, and product activity for {competitorName}, we'll score sentiment and tone here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sparkline = data.sparkline.map((p) => ({
    date: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    sentiment: p.sentiment,
    toneLabel: p.toneLabel,
  }));

  const toneEntries = Object.entries(data.toneCounts).sort((a, b) => b[1] - a[1]);
  const total = toneEntries.reduce((s, [, n]) => s + n, 0) || 1;

  const recent = data.recentMeanSentiment;
  const m30 = data.meanSentiment30d;
  const m90 = data.meanSentiment90d;
  const delta = recent !== null && m30 !== null ? recent - m30 : null;

  return (
    <Card data-testid="card-tone-panel">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" /> Tone & Sentiment
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Last {data.sinceDays} days · {data.totalAnalyzed} analyzed item{data.totalAnalyzed === 1 ? "" : "s"}
            </p>
          </div>
          {data.dominantTone && (
            <Badge variant="secondary" data-testid="badge-dominant-tone">{data.dominantTone}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div data-testid="stat-sentiment-recent">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Last 7 days</p>
            <p className="text-2xl font-semibold flex items-center gap-1" style={{ color: recent !== null ? sentimentColor(recent) : undefined }}>
              {formatSentiment(recent)}
              {delta !== null && Math.abs(delta) >= 0.05 && (
                delta > 0
                  ? <ArrowUp className="h-4 w-4 text-emerald-500" />
                  : <ArrowDown className="h-4 w-4 text-rose-500" />
              )}
            </p>
          </div>
          <div data-testid="stat-sentiment-30d">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">30-day mean</p>
            <p className="text-2xl font-semibold" style={{ color: m30 !== null ? sentimentColor(m30) : undefined }}>
              {formatSentiment(m30)}
            </p>
          </div>
          <div data-testid="stat-sentiment-90d">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">90-day mean</p>
            <p className="text-2xl font-semibold" style={{ color: m90 !== null ? sentimentColor(m90) : undefined }}>
              {formatSentiment(m90)}
            </p>
          </div>
          <div data-testid="stat-tone-dominant">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Dominant tone</p>
            <p className="text-2xl font-semibold capitalize">{data.dominantTone || "—"}</p>
          </div>
        </div>

        {sparkline.length > 1 && (
          <div className="h-40" data-testid="chart-tone-sparkline">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 11 }} />
                <ReTooltip
                  formatter={(value: number) => [formatSentiment(value), "Sentiment"]}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Line type="monotone" dataKey="sentiment" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {data.toneShifts && data.toneShifts.length > 0 && (
          <div data-testid="section-tone-shifts">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Recent tone shifts</p>
            <ul className="space-y-1.5">
              {data.toneShifts.map((s, i) => (
                <li key={i} className="text-sm flex items-center gap-2" data-testid={`shift-tone-${i}`}>
                  <Badge variant="outline" className="capitalize">{s.fromTone || "—"}</Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <Badge variant="secondary" className="capitalize">{s.toTone}</Badge>
                  <span className="text-xs text-muted-foreground">on {new Date(s.date).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {toneEntries.length > 0 && (
          <div data-testid="section-tone-distribution">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Tone distribution</p>
            <div className="space-y-1.5">
              {toneEntries.map(([tone, count]) => {
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={tone} className="flex items-center gap-3 text-sm" data-testid={`row-tone-${tone}`}>
                    <span className="capitalize w-28 shrink-0">{tone}</span>
                    <div className="flex-1 bg-muted rounded h-2 overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-16 text-right">{count} · {pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.topNotes.length > 0 && (
          <div data-testid="section-tone-notes">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Recent tone notes</p>
            <ul className="space-y-2">
              {data.topNotes.map((n, i) => (
                <li key={i} className="text-sm border-l-2 pl-3" style={{ borderColor: sentimentColor(n.sentimentScore) }} data-testid={`note-tone-${i}`}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{n.toneLabel || "—"}</span>
                    <span>·</span>
                    <span>{formatSentiment(n.sentimentScore)}</span>
                    <span>·</span>
                    <span>{new Date(n.date).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-0.5">{n.note}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
