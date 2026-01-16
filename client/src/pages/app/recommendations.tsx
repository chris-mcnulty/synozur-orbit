import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, EyeOff, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function Recommendations() {
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ["/api/recommendations"],
    queryFn: async () => {
      const response = await fetch("/api/recommendations", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading recommendations...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
            <Sparkles className="text-primary h-8 w-8" />
            AI Recommendations
        </h1>
        <p className="text-muted-foreground">Actionable insights generated from your competitive data.</p>
      </div>

      {recommendations.length === 0 ? (
        <Card className="p-12 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No recommendations yet.</p>
          <p className="text-sm text-muted-foreground">Add competitors and run analysis to generate AI-powered recommendations.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {recommendations.map((rec: any) => (
            <Card key={rec.id} className="group hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-medium text-primary mb-2 uppercase tracking-wide">
                          {rec.area} • {rec.impact} Impact
                      </div>
                      <CardTitle className="text-xl">{rec.title}</CardTitle>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8"><ThumbsUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><ThumbsDown className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><EyeOff className="h-4 w-4" /></Button>
                    </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{rec.description}</p>
                
                {rec.rationale && (
                  <div className="mt-4 p-4 bg-muted/50 rounded-md text-sm border border-border">
                    <span className="font-semibold text-foreground">Rationale:</span> {rec.rationale}
                  </div>
                )}
              </CardContent>
              <CardFooter>
                   <Button variant="outline" size="sm">Apply to Roadmap</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
