import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockAnalysis } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Minus, ArrowRight, AlertTriangle } from "lucide-react";

export default function Analysis() {
  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Competitive Analysis</h1>
           <p className="text-muted-foreground">Side-by-side comparison of messaging and positioning.</p>
        </div>
      </div>

      <Tabs defaultValue="themes" className="space-y-6">
        <TabsList className="bg-muted/50 p-1 border border-border rounded-lg">
          <TabsTrigger value="themes" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Key Themes</TabsTrigger>
          <TabsTrigger value="messaging" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Messaging Matrix</TabsTrigger>
          <TabsTrigger value="gaps" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Gap Analysis</TabsTrigger>
        </TabsList>
        
        <TabsContent value="themes">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Thematic Presence</CardTitle>
              <CardDescription>How strongly each competitor emphasizes key market themes.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative w-full overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-muted-foreground font-medium border-b border-border/50">
                    <tr>
                      <th className="py-4 px-4 font-semibold w-1/4">Theme</th>
                      <th className="py-4 px-4 font-semibold w-1/4">Us</th>
                      <th className="py-4 px-4 font-semibold w-1/4 text-muted-foreground">Competitor A</th>
                      <th className="py-4 px-4 font-semibold w-1/4 text-muted-foreground">Competitor B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockAnalysis.themes.map((theme, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 font-medium text-foreground">{theme.theme}</td>
                        <td className="py-4 px-4">
                          <Badge 
                            variant={theme.us === 'High' ? "default" : theme.us === 'Medium' ? "secondary" : "outline"}
                            className="w-20 justify-center"
                          >
                            {theme.us}
                          </Badge>
                        </td>
                        <td className="py-4 px-4">
                            <span className={theme.competitorA === 'High' ? "font-medium text-foreground" : "text-muted-foreground"}>
                                {theme.competitorA}
                            </span>
                        </td>
                        <td className="py-4 px-4">
                            <span className={theme.competitorB === 'High' ? "font-medium text-foreground" : "text-muted-foreground"}>
                                {theme.competitorB}
                            </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="messaging">
            <Card className="border-border">
                <CardHeader>
                    <CardTitle>Messaging Matrix</CardTitle>
                    <CardDescription>Direct comparison of copy and tone across key touchpoints.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-8">
                        {mockAnalysis.messaging.map((item, i) => (
                            <div key={i} className="space-y-3">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{item.category}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                                        <div className="text-xs font-semibold text-primary mb-1">Us</div>
                                        <div className="font-medium text-lg">"{item.us}"</div>
                                    </div>
                                    <div className="p-4 rounded-lg bg-muted/50 border border-border">
                                        <div className="text-xs font-semibold text-muted-foreground mb-1">Competitor A</div>
                                        <div className="text-base">"{item.competitorA}"</div>
                                    </div>
                                    <div className="p-4 rounded-lg bg-muted/50 border border-border">
                                        <div className="text-xs font-semibold text-muted-foreground mb-1">Competitor B</div>
                                        <div className="text-base">"{item.competitorB}"</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </TabsContent>

        <TabsContent value="gaps">
            <div className="grid gap-4 md:grid-cols-2">
                {mockAnalysis.gaps.map((gap, i) => (
                    <Card key={i} className="border-l-4 border-l-destructive hover:bg-muted/20 transition-colors">
                        <CardHeader>
                            <div className="flex justify-between items-start gap-4">
                                <div>
                                    <CardTitle className="text-lg">{gap.area}</CardTitle>
                                    <CardDescription className="mt-1 flex items-center gap-2">
                                        <AlertTriangle size={14} className="text-destructive" />
                                        Impact: <span className="text-destructive font-medium">{gap.impact}</span>
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="shrink-0">Gap Detected</Badge>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm leading-relaxed">{gap.observation}</p>
                            <div className="mt-4 flex justify-end">
                                <span className="text-xs text-primary font-medium flex items-center cursor-pointer hover:underline">
                                    View Recommendation <ArrowRight size={12} className="ml-1" />
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
