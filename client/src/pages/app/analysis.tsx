import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockAnalysis } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Minus } from "lucide-react";

export default function Analysis() {
  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Competitive Analysis</h1>
           <p className="text-muted-foreground">Side-by-side comparison of messaging and positioning.</p>
        </div>
      </div>

      <Tabs defaultValue="themes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="themes">Key Themes</TabsTrigger>
          <TabsTrigger value="gaps">Gap Analysis</TabsTrigger>
          <TabsTrigger value="messaging">Messaging Matrix</TabsTrigger>
        </TabsList>
        
        <TabsContent value="themes">
          <Card>
            <CardHeader>
              <CardTitle>Thematic Presence</CardTitle>
              <CardDescription>How strongly each competitor emphasizes key market themes.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative w-full overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-muted-foreground font-medium border-b border-border">
                    <tr>
                      <th className="py-3 px-4">Theme</th>
                      <th className="py-3 px-4">Us</th>
                      <th className="py-3 px-4">Competitor A</th>
                      <th className="py-3 px-4">Competitor B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockAnalysis.themes.map((theme, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-4 px-4 font-medium">{theme.theme}</td>
                        <td className="py-4 px-4"><Badge variant={theme.us === 'High' ? "default" : "secondary"}>{theme.us}</Badge></td>
                        <td className="py-4 px-4"><Badge variant="outline">{theme.competitorA}</Badge></td>
                        <td className="py-4 px-4"><Badge variant="outline">{theme.competitorB}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gaps">
            <div className="grid gap-4 md:grid-cols-2">
                {mockAnalysis.gaps.map((gap, i) => (
                    <Card key={i} className="border-l-4 border-l-destructive">
                        <CardHeader>
                            <CardTitle className="text-lg">{gap.area}</CardTitle>
                            <CardDescription>Impact: <span className="text-destructive font-medium">{gap.impact}</span></CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm">{gap.observation}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
