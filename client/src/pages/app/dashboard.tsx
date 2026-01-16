import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { mockCompetitors, mockActivity, mockAnalysis } from "@/lib/mockData";
import { ArrowUpRight, ArrowDownRight, Users, Eye, Target } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Overview</h1>
        <p className="text-muted-foreground">Welcome back, John. Here's what's happening in your market.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Competitors Tracked</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockCompetitors.length}</div>
            <p className="text-xs text-muted-foreground">+1 from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Market Gaps Identified</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{mockAnalysis.gaps.length}</div>
            <p className="text-xs text-muted-foreground">2 High Priority</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Changes Detected</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockActivity.length}</div>
            <p className="text-xs text-muted-foreground">In the last 7 days</p>
          </CardContent>
        </Card>
        <Card>
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7 mb-8">
        {/* Main Chart Area Placeholder */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Market Positioning Map</CardTitle>
            <CardDescription>Your brand vs competitors on key axes.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center bg-muted/20 rounded-md border border-dashed border-border m-4">
             <div className="text-center text-muted-foreground">
               <p>Interactive Vega Chart Placeholder</p>
               <p className="text-xs mt-2">X: Innovation | Y: Market Presence</p>
             </div>
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
