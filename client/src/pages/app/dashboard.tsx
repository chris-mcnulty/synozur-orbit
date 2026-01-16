import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Target, Eye, ArrowUpRight } from "lucide-react";
import { mockCompetitors, mockAnalysis, mockActivity } from "@/lib/mockData";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const positioningData = [
  { x: 85, y: 75, name: 'Orbit (Us)', type: 'us' },
  { x: 60, y: 80, name: 'Competitor A', type: 'competitor' },
  { x: 90, y: 40, name: 'Competitor B', type: 'competitor' },
  { x: 30, y: 60, name: 'Competitor C', type: 'competitor' },
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border p-2 rounded shadow-sm text-xs">
        <p className="font-semibold">{payload[0].payload.name}</p>
        <p>Innovation: {payload[0].value}</p>
        <p>Market Presence: {payload[1].value}</p>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  return (
    <AppLayout>
      <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Overview</h1>
        <p className="text-muted-foreground">Welcome back, John. Here's what's happening in your market.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100 fill-mode-backwards">
        <Card className="hover:border-primary/50 transition-colors duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Competitors Tracked</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockCompetitors.length}</div>
            <p className="text-xs text-muted-foreground">+1 from last month</p>
          </CardContent>
        </Card>
        <Card className="hover:border-primary/50 transition-colors duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Market Gaps Identified</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{mockAnalysis.gaps.length}</div>
            <p className="text-xs text-muted-foreground">2 High Priority</p>
          </CardContent>
        </Card>
        <Card className="hover:border-primary/50 transition-colors duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Changes Detected</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockActivity.length}</div>
            <p className="text-xs text-muted-foreground">In the last 7 days</p>
          </CardContent>
        </Card>
        <Card className="hover:border-primary/50 transition-colors duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Orbit Score</CardTitle>
            <div className="h-4 w-4 text-muted-foreground">✨</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">85/100</div>
            <p className="text-xs text-muted-foreground">+5% vs competitors</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7 mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200 fill-mode-backwards">
        {/* Main Chart Area */}
        <Card className="col-span-4 hover:border-primary/20 transition-colors duration-300">
          <CardHeader>
            <CardTitle>Market Positioning Map</CardTitle>
            <CardDescription>Your brand vs competitors on key axes.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] w-full pt-4">
             <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" dataKey="x" name="Innovation" unit="%" domain={[0, 100]} label={{ value: 'Innovation Score', position: 'insideBottom', offset: -10, fontSize: 12, fill: 'currentColor', opacity: 0.5 }} tick={{fontSize: 12, opacity: 0.5}} />
                  <YAxis type="number" dataKey="y" name="Market Presence" unit="%" domain={[0, 100]} label={{ value: 'Market Presence', angle: -90, position: 'insideLeft', offset: 0, fontSize: 12, fill: 'currentColor', opacity: 0.5 }} tick={{fontSize: 12, opacity: 0.5}} />
                  <Tooltip content={<CustomTooltip />} />
                  <Scatter name="Competitors" data={positioningData}>
                    {positioningData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.type === 'us' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'} />
                    ))}
                    <LabelList dataKey="name" position="top" style={{ fill: 'currentColor', fontSize: '10px', opacity: 0.8 }} />
                  </Scatter>
                </ScatterChart>
             </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest changes from competitors.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-4 pb-4 border-b border-border last:border-0 last:pb-0">
                  <div className={cn(
                    "w-2 h-2 mt-2 rounded-full",
                    activity.impact === "High" ? "bg-destructive" : "bg-primary"
                  )} />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{activity.competitor}</p>
                    <p className="text-sm text-muted-foreground">{activity.description}</p>
                    <p className="text-xs text-muted-foreground pt-1">{activity.date}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border">
                <Link href="/app/activity">
                    <a className="text-sm text-primary hover:underline flex items-center">View full feed <ArrowUpRight className="ml-1 h-3 w-3" /></a>
                </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
