import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockActivity } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Activity() {
  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Activity Feed</h1>
        <p className="text-muted-foreground">Real-time monitoring of competitor changes.</p>
      </div>

      <div className="space-y-6 relative border-l border-border ml-4 pl-8">
        {mockActivity.map((activity) => (
            <div key={activity.id} className="relative">
                <div className="absolute -left-[41px] top-1 h-5 w-5 rounded-full bg-background border-2 border-primary" />
                
                <Card className="mb-4">
                    <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">{activity.competitor}</Badge>
                                <span className="text-xs text-muted-foreground">{activity.date}</span>
                            </div>
                            <Badge variant={activity.impact === "High" ? "destructive" : "secondary"}>
                                {activity.impact} Impact
                            </Badge>
                        </div>
                        <CardTitle className="text-lg mt-2">{activity.description}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            {activity.type === 'change' ? "Detected text content change on homepage." : "Detected new page added to sitemap."}
                        </p>
                        <div className="mt-4 p-4 bg-muted/30 rounded border border-border font-mono text-xs">
                           {/* Fake Diff */}
                           <div className="text-destructive">- "The #1 CRM for Sales"</div>
                           <div className="text-green-500">+ "The #1 AI-Powered CRM for Sales"</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        ))}
      </div>
    </AppLayout>
  );
}
