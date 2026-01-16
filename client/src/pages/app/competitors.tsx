import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MoreHorizontal, ExternalLink, RefreshCw } from "lucide-react";
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

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading competitors...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Competitors</h1>
           <p className="text-muted-foreground">Manage the companies you want to track.</p>
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

      {competitors.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">No competitors tracked yet</p>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Your First Competitor
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700 fill-mode-backwards delay-100">
          {competitors.map((competitor: any) => (
            <div key={competitor.id} className="group">
              <Link href={`/app/competitors/${competitor.id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all duration-300 cursor-pointer">
                  <CardContent className="flex items-center justify-between p-6">
                      <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center font-bold text-lg text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                              {competitor.name.charAt(0)}
                          </div>
                          <div>
                              <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">{competitor.name}</h3>
                              <div className="flex items-center gap-2">
                                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                                      {competitor.url} <ExternalLink size={12} />
                                  </span>
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
                                onClick={(e) => {
                                  e.preventDefault();
                                  crawlCompetitor.mutate(competitor.id);
                                }}
                                disabled={crawlCompetitor.isPending}
                              >
                                  <RefreshCw className="w-4 h-4 mr-2" /> Crawl Now
                              </Button>
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={(e) => e.preventDefault()}>
                                          <MoreHorizontal className="w-4 h-4" />
                                      </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                      <DropdownMenuItem>Edit Settings</DropdownMenuItem>
                                      <DropdownMenuItem>View Analysis</DropdownMenuItem>
                                      <DropdownMenuItem 
                                        className="text-destructive"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          deleteCompetitor.mutate(competitor.id);
                                        }}
                                      >
                                        Remove Competitor
                                      </DropdownMenuItem>
                                  </DropdownMenuContent>
                              </DropdownMenu>
                          </div>
                      </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
