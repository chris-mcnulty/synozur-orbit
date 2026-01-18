import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Building, Globe } from "lucide-react";

export default function Activity() {
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  const { data: activity = [], isLoading } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const response = await fetch("/api/activity", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: competitors = [] } = useQuery({
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

  const filteredActivity = activity.filter((item: any) => {
    const sourceType = item.sourceType || "competitor";
    if (companyFilter === "all") return true;
    if (companyFilter === "baseline") return sourceType === "baseline";
    return item.competitorId === companyFilter;
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading activity...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Activity Feed</h1>
          <p className="text-muted-foreground">Real-time monitoring of competitor and baseline changes.</p>
        </div>
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
            {competitors.map((comp: any) => (
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
              ? "No activity yet. Add competitors and they will appear here when changes are detected."
              : "No activity for the selected filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-6 relative border-l border-border ml-4 pl-8">
          {filteredActivity.map((item: any) => {
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
                        {item.type === 'change' ? "Detected text content change on homepage." : "Detected new page added to sitemap."}
                      </p>
                    )}
                    {item.diff && (
                      <div className="mt-4 p-4 bg-muted/30 rounded border border-border font-mono text-xs">
                        <div className="text-destructive">- {item.diff.old}</div>
                        <div className="text-green-500">+ {item.diff.new}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
