import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

export default function Activity() {
  const { data: activity = [], isLoading } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const response = await fetch("/api/activity", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
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
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Activity Feed</h1>
        <p className="text-muted-foreground">Real-time monitoring of competitor changes.</p>
      </div>

      {activity.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">No activity yet. Add competitors and they will appear here when changes are detected.</p>
        </Card>
      ) : (
        <div className="space-y-6 relative border-l border-border ml-4 pl-8">
          {activity.map((item: any) => (
              <div key={item.id} className="relative">
                  <div className="absolute -left-[41px] top-1 h-5 w-5 rounded-full bg-background border-2 border-primary" />
                  
                  <Card className="mb-4">
                      <CardHeader className="pb-2">
                          <div className="flex justify-between items-start">
                              <div className="flex items-center gap-2">
                                  <Badge variant="outline">{item.competitor}</Badge>
                                  <span className="text-xs text-muted-foreground">{item.date}</span>
                              </div>
                              <Badge variant={item.impact === "High" ? "destructive" : "secondary"}>
                                  {item.impact} Impact
                              </Badge>
                          </div>
                          <CardTitle className="text-lg mt-2">{item.description}</CardTitle>
                      </CardHeader>
                      <CardContent>
                          <p className="text-sm text-muted-foreground">
                              {item.type === 'change' ? "Detected text content change on homepage." : "Detected new page added to sitemap."}
                          </p>
                          {item.diff && (
                            <div className="mt-4 p-4 bg-muted/30 rounded border border-border font-mono text-xs">
                               <div className="text-destructive">- {item.diff.old}</div>
                               <div className="text-green-500">+ {item.diff.new}</div>
                            </div>
                          )}
                      </CardContent>
                  </Card>
              </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
