import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockCompetitors } from "@/lib/mockData";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ExternalLink, Globe, Calendar, RefreshCw, BarChart2, FileText, Activity } from "lucide-react";
import { Link } from "wouter";

export default function CompetitorDetail() {
  const [, params] = useRoute("/app/competitors/:id");
  const id = params?.id ? parseInt(params.id) : null;
  const competitor = mockCompetitors.find((c) => c.id === id);

  if (!competitor) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-[50vh]">
          <h2 className="text-2xl font-bold mb-2">Competitor Not Found</h2>
          <Link href="/app/competitors">
            <a className="text-primary hover:underline flex items-center">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Competitors
            </a>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mb-8">
          <Link href="/app/competitors">
            <a className="text-sm text-muted-foreground hover:text-foreground flex items-center mb-4 transition-colors">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Competitors
            </a>
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-2xl font-bold text-foreground border border-border/50 shadow-sm">
                {competitor.name.charAt(0)}
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{competitor.name}</h1>
                <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                  <a href={competitor.url} target="_blank" rel="noreferrer" className="flex items-center hover:text-primary transition-colors">
                    <Globe className="mr-1 h-3 w-3" /> {competitor.url} <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                  <span className="text-border">|</span>
                  <span className="flex items-center">
                    <Calendar className="mr-1 h-3 w-3" /> Last crawled: {competitor.lastCrawl}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button variant="outline" className="gap-2">
                <RefreshCw className="h-4 w-4" /> Re-crawl
              </Button>
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
