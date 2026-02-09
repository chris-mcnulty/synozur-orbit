import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Globe,
  Linkedin,
  Instagram,
  Newspaper,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Clock,
  Users,
  FileText,
  Rss,
  ChevronDown,
  ChevronRight,
  FileCode,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import AppLayout from "@/components/layout/AppLayout";
import { useToast } from "@/hooks/use-toast";
import StalenessDot from "@/components/ui/StalenessDot";

interface SocialMetrics {
  platform: string;
  companyName: string;
  isBaseline: boolean;
  url?: string;
  followers?: number;
  posts?: number;
  lastChecked?: string;
  status: "connected" | "blocked" | "not_configured";
}

interface NewsMention {
  id: string;
  title: string;
  source: string;
  url: string;
  snippet: string;
  publishedAt: string;
  sentiment: "positive" | "neutral" | "negative";
  relevanceScore: number;
}

interface NewsResult {
  competitorId: string;
  competitorName: string;
  mentions: NewsMention[];
  totalMentions: number;
  status: string;
  fetchedAt: string;
}

interface DataSourceSummary {
  websitesTracked: number;
  socialProfiles: number;
  newsMonitored: number;
  documentsUploaded: number;
  lastCrawl?: string;
}

const getSentimentIcon = (sentiment: string) => {
  switch (sentiment) {
    case "positive":
      return <TrendingUp className="w-4 h-4 text-green-500" />;
    case "negative":
      return <TrendingDown className="w-4 h-4 text-red-500" />;
    default:
      return <Minus className="w-4 h-4 text-muted-foreground" />;
  }
};

const getSentimentBadgeColor = (sentiment: string) => {
  switch (sentiment) {
    case "positive":
      return "bg-green-500/10 text-green-400 border-green-500/30";
    case "negative":
      return "bg-red-500/10 text-red-400 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getPlatformIcon = (platform: string) => {
  switch (platform.toLowerCase()) {
    case "linkedin":
      return <Linkedin className="w-5 h-5 text-blue-500" />;
    case "instagram":
      return <Instagram className="w-5 h-5 text-pink-500" />;
    default:
      return <Globe className="w-5 h-5" />;
  }
};

const getPageTypeLabel = (pageType: string) => {
  const labels: Record<string, string> = {
    homepage: "Home",
    about: "About",
    services: "Services",
    products: "Products",
    blog: "Blog",
    other: "Other",
  };
  return labels[pageType] || pageType;
};

function WebsiteEntry({ name, url, lastCrawled, crawlData, badge, isBaseline }: {
  name: string;
  url: string;
  lastCrawled?: string;
  crawlData?: any;
  badge: string;
  isBaseline?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const pages = crawlData?.pagesCrawled || crawlData?.pages || [];

  return (
    <div className={`rounded-lg ${isBaseline ? "border-2 border-primary/30 bg-primary/5" : "border border-border/50 bg-card/50"}`}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isBaseline ? "bg-primary/20" : "bg-muted"}`}>
              <Globe className={`w-5 h-5 ${isBaseline ? "text-primary" : ""}`} />
            </div>
            <div>
              <h3 className="font-semibold">{name}</h3>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                {url} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={isBaseline ? "bg-primary/10 text-primary border-primary/30" : ""}>
              {badge}
            </Badge>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-3">
            {lastCrawled && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last crawled {new Date(lastCrawled).toLocaleDateString()}
              </p>
            )}
            {pages.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {pages.length} {pages.length === 1 ? "page" : "pages"} monitored
              </Badge>
            )}
          </div>
          {pages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="text-xs"
              data-testid={`button-expand-pages-${name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {expanded ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
              {expanded ? "Hide pages" : "Show pages"}
            </Button>
          )}
        </div>
      </div>
      {expanded && pages.length > 0 && (
        <div className="border-t border-border/50 px-4 py-3">
          <div className="space-y-2">
            {pages.map((page: any, index: number) => (
              <div
                key={index}
                className="flex items-center justify-between py-2 px-3 rounded-md bg-background/50 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary truncate"
                    title={page.url}
                  >
                    {page.title || page.url}
                  </a>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Badge variant="outline" className="text-xs">
                    {getPageTypeLabel(page.pageType)}
                  </Badge>
                  {page.wordCount != null && (
                    <span className="text-xs text-muted-foreground">{page.wordCount.toLocaleString()} words</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {crawlData?.totalWordCount != null && (
            <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/30">
              Total content: {crawlData.totalWordCount.toLocaleString()} words across {pages.length} pages
            </p>
          )}
        </div>
      )}
      {!lastCrawled && pages.length === 0 && (
        <div className="border-t border-border/50 px-4 py-3">
          <p className="text-xs text-muted-foreground">Not yet crawled. Run a refresh from the Refresh Center to start monitoring pages.</p>
        </div>
      )}
    </div>
  );
}

export default function DataSourcesPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: competitors = [], isLoading: loadingCompetitors } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch competitors");
      return res.json();
    },
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["/api/documents"],
    queryFn: async () => {
      const res = await fetch("/api/documents", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: newsData, isLoading: loadingNews, refetch: refetchNews } = useQuery({
    queryKey: ["/api/data-sources/news"],
    queryFn: async () => {
      const res = await fetch("/api/data-sources/news", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    enabled: competitors.length > 0,
  });

  const refreshNewsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/data-sources/news/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to refresh news" }));
        throw new Error(err.error || "Failed to refresh news");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.results) {
        setLiveNewsResults(data.results);
      }
      toast({ title: "News scan complete", description: `Found ${data.results?.reduce((sum: number, r: any) => sum + (r.mentions?.length || 0), 0) || 0} mentions across your competitors.` });
    },
    onError: (error: Error) => {
      toast({ title: "Error scanning news", description: error.message, variant: "destructive" });
    },
  });

  const buildSocialMetrics = (): SocialMetrics[] => {
    const metrics: SocialMetrics[] = [];
    
    const allCompanies = [
      ...(companyProfile ? [{ ...companyProfile, isBaseline: true }] : []),
      ...competitors.map((c: any) => ({ ...c, isBaseline: false })),
    ];

    for (const company of allCompanies) {
      const companyName = company.name || "Unknown";
      const isBaseline = !!company.isBaseline;
      if (company.linkedInUrl) {
        metrics.push({
          platform: "LinkedIn",
          companyName,
          isBaseline,
          url: company.linkedInUrl,
          status: "connected",
          lastChecked: company.linkedinLastChecked,
        });
      }
      if (company.instagramUrl) {
        metrics.push({
          platform: "Instagram",
          companyName,
          isBaseline,
          url: company.instagramUrl,
          status: company.instagramContent ? "connected" : "blocked",
          lastChecked: company.instagramLastChecked,
        });
      }
    }

    return metrics;
  };

  const socialMetrics = buildSocialMetrics();
  
  const summary: DataSourceSummary = {
    websitesTracked: (companyProfile ? 1 : 0) + competitors.length,
    socialProfiles: socialMetrics.filter(m => m.status === "connected").length,
    newsMonitored: competitors.length,
    documentsUploaded: documents.length,
    lastCrawl: competitors[0]?.lastCrawled || companyProfile?.lastCrawled,
  };

  const [liveNewsResults, setLiveNewsResults] = useState<any[]>([]);

  const allMentions: Array<NewsMention & { competitorName: string }> = [];
  const newsResults = liveNewsResults.length > 0 ? liveNewsResults : (newsData?.results || []);
  for (const result of newsResults) {
    for (const mention of result.mentions || []) {
      allMentions.push({ ...mention, competitorName: result.competitorName });
    }
  }
  allMentions.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Data Sources</h1>
              <p className="text-muted-foreground text-sm">View all the intelligence sources feeding into your competitive analysis</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Globe className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{summary.websitesTracked}</p>
                  <p className="text-sm text-muted-foreground">Websites Tracked</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Users className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{summary.socialProfiles}</p>
                  <p className="text-sm text-muted-foreground">Social Profiles</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10">
                    <Newspaper className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{allMentions.length}</p>
                    <p className="text-sm text-muted-foreground">News Mentions</p>
                  </div>
                </div>
                <StalenessDot 
                  lastUpdated={newsData?.results?.[0]?.fetchedAt} 
                  label="News data freshness"
                  size="md"
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <FileText className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{summary.documentsUploaded}</p>
                  <p className="text-sm text-muted-foreground">Documents Uploaded</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="social" data-testid="tab-social">Social Media</TabsTrigger>
            <TabsTrigger value="news" data-testid="tab-news">News Mentions</TabsTrigger>
            <TabsTrigger value="websites" data-testid="tab-websites">Websites</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Rss className="w-5 h-5" />
                    Latest News Mentions
                  </CardTitle>
                  <CardDescription>Recent mentions of your competitors in the news</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingNews ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : allMentions.length > 0 ? (
                    <div className="space-y-3">
                      {allMentions.slice(0, 5).map((mention) => (
                        <div
                          key={mention.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border/50"
                        >
                          {getSentimentIcon(mention.sentiment)}
                          <div className="flex-1 min-w-0">
                            <a
                              href={mention.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-sm hover:text-primary transition-colors line-clamp-1"
                            >
                              {mention.title}
                            </a>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {mention.snippet}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge variant="outline" className="text-xs">
                                {mention.competitorName}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{mention.source}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p className="font-medium">No news mentions yet</p>
                      <p className="text-xs mt-1 max-w-xs mx-auto">Scan the web for recent mentions of your competitors in news articles and blogs.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => refreshNewsMutation.mutate()}
                        disabled={refreshNewsMutation.isPending}
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshNewsMutation.isPending ? "animate-spin" : ""}`} />
                        {refreshNewsMutation.isPending ? "Scanning..." : "Scan for mentions"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Social Media Status
                  </CardTitle>
                  <CardDescription>Connected social profiles and their status</CardDescription>
                </CardHeader>
                <CardContent>
                  {socialMetrics.length > 0 ? (
                    <div className="space-y-3">
                      {socialMetrics.slice(0, 6).map((metric, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border/50"
                        >
                          <div className="flex items-center gap-3">
                            {getPlatformIcon(metric.platform)}
                            <div>
                              <p className="font-medium text-sm">
                                {metric.companyName}
                                {metric.isBaseline && <span className="text-xs text-primary ml-1">(You)</span>}
                              </p>
                              <p className="text-xs text-muted-foreground">{metric.platform}</p>
                              {metric.url && (
                                <a
                                  href={metric.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                >
                                  View profile <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              metric.status === "connected"
                                ? "bg-green-500/10 text-green-400 border-green-500/30"
                                : metric.status === "blocked"
                                ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                                : "bg-muted text-muted-foreground"
                            }
                          >
                            {metric.status === "connected" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                            {metric.status === "blocked" && <AlertCircle className="w-3 h-3 mr-1" />}
                            {metric.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No social profiles configured</p>
                      <p className="text-xs mt-2">Add LinkedIn or Instagram URLs to competitors</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="social" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Social Media Profiles</CardTitle>
                  <CardDescription>Track competitor presence across social platforms</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {loadingCompetitors ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {competitors.map((competitor: any) => (
                      <div
                        key={competitor.id}
                        className="p-4 rounded-lg border border-border/50 bg-card/50"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-semibold">{competitor.name}</h3>
                          {competitor.lastCrawled && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Last updated {new Date(competitor.lastCrawled).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {["linkedin", "instagram"].map((platform) => {
                            const url = competitor[`${platform}Url`];
                            return (
                              <div
                                key={platform}
                                className={`p-3 rounded-lg ${
                                  url ? "bg-primary/5 border border-primary/20" : "bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  {getPlatformIcon(platform)}
                                  <span className="text-sm font-medium capitalize">{platform}</span>
                                </div>
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                  >
                                    Connected <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Not configured</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {competitors.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No competitors added yet</p>
                        <p className="text-xs mt-2">Add competitors to track their social media presence</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="news" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>News Mentions</CardTitle>
                  <CardDescription>Track competitor mentions in news and articles</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshNewsMutation.mutate()}
                  disabled={refreshNewsMutation.isPending}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshNewsMutation.isPending ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {loadingNews ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4, 5].map(i => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                ) : allMentions.length > 0 ? (
                  <div className="space-y-4">
                    {allMentions.map((mention) => (
                      <div
                        key={mention.id}
                        className="p-4 rounded-lg border border-border/50 bg-card/50"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              {getSentimentIcon(mention.sentiment)}
                              <a
                                href={mention.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium hover:text-primary transition-colors"
                              >
                                {mention.title}
                              </a>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                              {mention.snippet}
                            </p>
                            <div className="flex items-center gap-3 flex-wrap">
                              <Badge variant="outline">{mention.competitorName}</Badge>
                              <span className="text-xs text-muted-foreground">{mention.source}</span>
                              <Badge variant="outline" className={getSentimentBadgeColor(mention.sentiment)}>
                                {mention.sentiment}
                              </Badge>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span>Relevance:</span>
                                <Progress value={mention.relevanceScore} className="w-16 h-1.5" />
                                <span>{mention.relevanceScore}%</span>
                              </div>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" asChild>
                            <a href={mention.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">No news mentions yet</p>
                    <p className="text-sm mt-2 mb-4 max-w-md mx-auto">
                      News scanning searches the web for recent articles, press releases, and blog posts mentioning your competitors. Results are fetched on-demand and analyzed for sentiment.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => refreshNewsMutation.mutate()}
                      disabled={refreshNewsMutation.isPending}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${refreshNewsMutation.isPending ? "animate-spin" : ""}`} />
                      {refreshNewsMutation.isPending ? "Scanning the web..." : "Scan for mentions"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="websites" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Website Tracking</CardTitle>
                <CardDescription>Monitored websites and their crawled pages</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {companyProfile && (
                    <WebsiteEntry
                      name={companyProfile.name || companyProfile.companyName}
                      url={companyProfile.websiteUrl}
                      lastCrawled={companyProfile.lastCrawled}
                      crawlData={companyProfile.crawlData}
                      badge="Baseline"
                      isBaseline
                    />
                  )}

                  {competitors.map((competitor: any) => (
                    <WebsiteEntry
                      key={competitor.id}
                      name={competitor.name}
                      url={competitor.websiteUrl || competitor.url}
                      lastCrawled={competitor.lastCrawled || competitor.lastFullCrawl}
                      crawlData={competitor.crawlData}
                      badge="Competitor"
                    />
                  ))}

                  {!companyProfile && competitors.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No websites configured yet</p>
                      <p className="text-xs mt-2">Add your company profile and competitors to start tracking</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
