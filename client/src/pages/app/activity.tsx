import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { Building, Globe, TrendingUp, TrendingDown, Minus, Rss, FileText, Users, Twitter, Instagram, Linkedin, AlertCircle, Newspaper, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BlogPost {
  title: string;
  url?: string;
}

interface BlogSnapshot {
  postCount: number;
  latestTitles: string[];
  capturedAt: string;
}

interface SocialEngagement {
  followers?: number;
  posts?: number;
  likes?: number;
  comments?: number;
  reactions?: number;
  capturedAt?: string;
}

interface Competitor {
  id: string;
  name: string;
  url: string;
  faviconUrl?: string;
  blogSnapshot?: BlogSnapshot;
  linkedinEngagement?: SocialEngagement;
  instagramEngagement?: SocialEngagement;
  twitterEngagement?: SocialEngagement;
  linkedInUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  lastWebsiteMonitor?: string;
  lastFullCrawl?: string;
}

interface Activity {
  id: string;
  type: string;
  competitorId?: string;
  competitorName?: string;
  description: string;
  summary?: string;
  date: string;
  impact: string;
  sourceType?: string;
  details?: {
    changeScore?: number;
    pagesMonitored?: number;
  };
}

export default function Activity() {
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("insights");

  const { data: activity = [], isLoading: loadingActivity } = useQuery<Activity[]>({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const response = await fetch("/api/activity", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: competitors = [], isLoading: loadingCompetitors } = useQuery<Competitor[]>({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const websiteChanges = activity.filter((item) => 
    item.type === "website_update" && 
    item.summary && 
    !item.summary.toLowerCase().includes("no significant")
  );

  const competitorsWithBlogs = competitors.filter((c) => 
    c.blogSnapshot && c.blogSnapshot.postCount > 0
  );

  const competitorsWithSocial = competitors.filter((c) =>
    c.linkedinEngagement || c.instagramEngagement || c.twitterEngagement ||
    c.linkedInUrl || c.instagramUrl || c.twitterUrl
  );

  const filteredActivity = activity.filter((item) => {
    const sourceType = item.sourceType || "competitor";
    if (companyFilter === "all") return true;
    if (companyFilter === "baseline") return sourceType === "baseline";
    return item.competitorId === companyFilter;
  });

  const isLoading = loadingActivity || loadingCompetitors;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const formatTimeAgo = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  const formatNumber = (num: number | undefined) => {
    if (!num) return "—";
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Competitor Intelligence</h1>
        <p className="text-muted-foreground">Track changes across websites, social channels, and content.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="insights" className="gap-2" data-testid="tab-insights">
            <TrendingUp className="h-4 w-4" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="social" className="gap-2" data-testid="tab-social">
            <Users className="h-4 w-4" />
            Social Signals
          </TabsTrigger>
          <TabsTrigger value="blogs" className="gap-2" data-testid="tab-blogs">
            <Rss className="h-4 w-4" />
            Blog Activity
          </TabsTrigger>
          <TabsTrigger value="feed" className="gap-2" data-testid="tab-feed">
            <FileText className="h-4 w-4" />
            Activity Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="insights" className="space-y-6">
          {websiteChanges.length === 0 ? (
            <Card className="p-8">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No significant changes detected yet</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Orbit monitors competitor websites for meaningful changes like positioning updates, new offerings, or campaign launches. 
                  Changes will appear here when detected.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Newspaper className="h-5 w-5 text-primary" />
                  Website Changes Detected
                </h2>
                <Badge variant="secondary">{websiteChanges.length} updates</Badge>
              </div>
              
              {websiteChanges.map((change) => (
                <Card key={change.id} className="border-l-4 border-l-primary" data-testid={`insight-${change.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          <Globe className="h-3 w-3 mr-1" />
                          {change.competitorName}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTimeAgo(change.date)}
                        </span>
                      </div>
                      <Badge variant={change.impact === "High" ? "destructive" : change.impact === "Medium" ? "default" : "secondary"}>
                        {change.impact} Impact
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">{change.summary}</p>
                    {change.details?.changeScore && (
                      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {change.details.changeScore}% content change
                        </span>
                        {change.details.pagesMonitored && (
                          <span>{change.details.pagesMonitored} pages monitored</span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="social" className="space-y-6">
          {competitorsWithSocial.length === 0 ? (
            <Card className="p-8">
              <div className="text-center">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No social profiles tracked</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Social profiles are automatically discovered during website crawls. 
                  Add competitors with linked social accounts to track their engagement.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {competitorsWithSocial.map((competitor) => (
                <Card key={competitor.id} data-testid={`social-card-${competitor.id}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      {competitor.faviconUrl && (
                        <img src={competitor.faviconUrl} alt="" className="h-4 w-4" />
                      )}
                      {competitor.name}
                    </CardTitle>
                    {competitor.lastWebsiteMonitor && (
                      <CardDescription className="text-xs">
                        Last checked {formatTimeAgo(competitor.lastWebsiteMonitor)}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(competitor.linkedInUrl || competitor.linkedinEngagement) && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div className="flex items-center gap-2">
                          <Linkedin className="h-4 w-4 text-[#0077B5]" />
                          <span className="text-sm">LinkedIn</span>
                        </div>
                        {competitor.linkedinEngagement?.followers ? (
                          <span className="text-sm font-medium">
                            {formatNumber(competitor.linkedinEngagement.followers)} followers
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-xs">Linked</Badge>
                        )}
                      </div>
                    )}
                    
                    {(competitor.instagramUrl || competitor.instagramEngagement) && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div className="flex items-center gap-2">
                          <Instagram className="h-4 w-4 text-[#E4405F]" />
                          <span className="text-sm">Instagram</span>
                        </div>
                        {competitor.instagramEngagement?.followers ? (
                          <span className="text-sm font-medium">
                            {formatNumber(competitor.instagramEngagement.followers)} followers
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-xs">Linked</Badge>
                        )}
                      </div>
                    )}
                    
                    {(competitor.twitterUrl || competitor.twitterEngagement) && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div className="flex items-center gap-2">
                          <Twitter className="h-4 w-4 text-[#1DA1F2]" />
                          <span className="text-sm">Twitter/X</span>
                        </div>
                        {competitor.twitterEngagement?.followers ? (
                          <span className="text-sm font-medium">
                            {formatNumber(competitor.twitterEngagement.followers)} followers
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-xs">Linked</Badge>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="blogs" className="space-y-6">
          {competitorsWithBlogs.length === 0 ? (
            <Card className="p-8">
              <div className="text-center">
                <Rss className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No blog content detected</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Blog posts are discovered during website crawls. Competitors with active blogs will appear here.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {competitorsWithBlogs.map((competitor) => (
                <Card key={competitor.id} data-testid={`blog-card-${competitor.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        {competitor.faviconUrl && (
                          <img src={competitor.faviconUrl} alt="" className="h-4 w-4" />
                        )}
                        {competitor.name}
                      </CardTitle>
                      <Badge variant="secondary">
                        {competitor.blogSnapshot?.postCount || 0} posts detected
                      </Badge>
                    </div>
                    {competitor.blogSnapshot?.capturedAt && (
                      <CardDescription className="text-xs">
                        Last scanned {formatTimeAgo(competitor.blogSnapshot.capturedAt)}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    {competitor.blogSnapshot?.latestTitles && competitor.blogSnapshot.latestTitles.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Recent Topics</p>
                        <ul className="space-y-1">
                          {competitor.blogSnapshot.latestTitles.slice(0, 5).map((title, i) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                              <Rss className="h-3 w-3 mt-1 text-muted-foreground flex-shrink-0" />
                              <span className="line-clamp-1">{title}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Blog detected but no specific posts extracted.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="feed" className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Raw Activity Log</h2>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-[200px]" data-testid="filter-company">
                <SelectValue placeholder="Filter by company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="filter-option-all">All Companies</SelectItem>
                {companyProfile && (
                  <SelectItem value="baseline" data-testid="filter-option-baseline">
                    <div className="flex items-center gap-2">
                      <Building className="h-3 w-3" />
                      {companyProfile.name} (Baseline)
                    </div>
                  </SelectItem>
                )}
                {competitors.map((comp) => (
                  <SelectItem key={comp.id} value={comp.id} data-testid={`filter-option-${comp.id}`}>
                    <div className="flex items-center gap-2">
                      <Globe className="h-3 w-3" />
                      {comp.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filteredActivity.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">
                {companyFilter === "all" 
                  ? "No activity yet. Add competitors and they will appear here when crawled."
                  : "No activity for the selected filter."}
              </p>
            </Card>
          ) : (
            <div className="space-y-4 relative border-l border-border ml-4 pl-8">
              {filteredActivity.map((item) => {
                const sourceType = item.sourceType || "competitor";
                const isBaseline = sourceType === "baseline";
                const companyName = isBaseline 
                  ? companyProfile?.name || "Your Company"
                  : item.competitorName || "Unknown";
                
                return (
                  <div key={item.id} className="relative" data-testid={`activity-item-${item.id}`}>
                    <div className={`absolute -left-[41px] top-1 h-5 w-5 rounded-full bg-background border-2 ${isBaseline ? "border-blue-500" : "border-primary"}`} />
                    
                    <Card className="mb-4">
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            {isBaseline ? (
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">
                                <Building className="h-3 w-3 mr-1" />
                                {companyName}
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <Globe className="h-3 w-3 mr-1" />
                                {companyName}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {item.type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{item.date}</span>
                          </div>
                          <Badge variant={item.impact === "High" ? "destructive" : "secondary"}>
                            {item.impact} Impact
                          </Badge>
                        </div>
                        <CardTitle className="text-lg mt-2">{item.description}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {item.summary ? (
                          <p className="text-sm text-muted-foreground">{item.summary}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {item.type === 'change' ? "Detected text content change on homepage." : 
                             item.type === 'website_update' ? "Website content update detected." :
                             "Activity recorded."}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
