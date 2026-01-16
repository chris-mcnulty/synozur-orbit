import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockRecommendations } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, EyeOff, Sparkles } from "lucide-react";

export default function Recommendations() {
  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
            <Sparkles className="text-primary h-8 w-8" />
            AI Recommendations
        </h1>
        <p className="text-muted-foreground">Actionable insights generated from your competitive data.</p>
      </div>

      <div className="grid gap-6">
        {mockRecommendations.map((rec) => (
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
              
              <div className="mt-4 p-4 bg-muted/50 rounded-md text-sm border border-border">
                <span className="font-semibold text-foreground">Rationale:</span> Comparison of your "Features" page vs Competitor A's new landing page indicates a 20% gap in AI-related keywords.
              </div>
            </CardContent>
            <CardFooter>
                 <Button variant="outline" size="sm">Apply to Roadmap</Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
