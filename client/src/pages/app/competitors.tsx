import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockCompetitors } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MoreHorizontal, ExternalLink, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Competitors() {
  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Competitors</h1>
           <p className="text-muted-foreground">Manage the companies you want to track.</p>
        </div>
        <Button>
            <Plus className="w-4 h-4 mr-2" /> Add Competitor
        </Button>
      </div>

      <div className="grid gap-6">
        {mockCompetitors.map((competitor) => (
          <Card key={competitor.id}>
            <CardContent className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center font-bold text-lg text-muted-foreground">
                        {competitor.name.charAt(0)}
                    </div>
                    <div>
                        <h3 className="font-semibold text-lg">{competitor.name}</h3>
                        <a href={competitor.url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1">
                            {competitor.url} <ExternalLink size={12} />
                        </a>
                    </div>
                </div>
                
                <div className="flex items-center gap-6">
                    <div className="text-right hidden md:block">
                        <p className="text-sm font-medium">Last Crawl</p>
                        <p className="text-xs text-muted-foreground">{competitor.lastCrawl}</p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm">
                            <RefreshCw className="w-4 h-4 mr-2" /> Crawl Now
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem>Edit Settings</DropdownMenuItem>
                                <DropdownMenuItem>View Analysis</DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive">Remove Competitor</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
