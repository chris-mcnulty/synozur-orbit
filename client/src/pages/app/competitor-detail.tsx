import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, ExternalLink, Globe, Calendar, RefreshCw, BarChart2, FileText, Linkedin, Instagram, Pencil } from "lucide-react";
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
