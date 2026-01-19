import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { TrendingUp, Users, MousePointerClick, ArrowUpRight, Calendar, RefreshCw, Loader2, Globe, Monitor } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";

interface UsageStats {
  totalViews: number;
  uniqueVisitors: number;
  signupPageViews: number;
  conversionRate: number;
  dailyViews: Array<{
    date: string;
    views: number;
    uniqueVisitors: number;
    signupViews: number;
  }>;
  referrers: Array<{
    referrer: string;
    count: number;
  }>;
  utmCampaigns: Array<{
    campaign: string;
    source: string;
    medium: string;
    count: number;
  }>;
  browsers: Array<{
    browser: string;
    count: number;
  }>;
  countries: Array<{
    country: string;
    count: number;
  }>;
}

export default function UsagePage() {
  const [dateRange, setDateRange] = useState("7");

  const { data: stats, isLoading, refetch, isRefetching } = useQuery<UsageStats>({
    queryKey: ["/api/analytics/usage", dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/analytics/usage?days=${dateRange}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch usage data");
      return response.json();
    },
  });

  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Usage & Traffic</h1>
          <p className="text-muted-foreground">Monitor visitor traffic to your public pages.</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[140px]" data-testid="select-date-range">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => refetch()}
            disabled={isRefetching}
            data-testid="button-refresh"
          >
            {isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card data-testid="card-total-views">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Page Views</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.totalViews || 0)}</div>
                <p className="text-xs text-muted-foreground">All tracked pages</p>
              </CardContent>
            </Card>

            <Card data-testid="card-unique-visitors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Unique Visitors</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.uniqueVisitors || 0)}</div>
                <p className="text-xs text-muted-foreground">By session ID</p>
              </CardContent>
            </Card>

            <Card data-testid="card-signup-views">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Signup Page Views</CardTitle>
                <MousePointerClick className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.signupPageViews || 0)}</div>
                <p className="text-xs text-muted-foreground">/auth/signup visits</p>
              </CardContent>
            </Card>

            <Card data-testid="card-conversion">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Signup Intent Rate</CardTitle>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(stats?.conversionRate || 0).toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Landing → Signup page</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card data-testid="card-daily-chart">
              <CardHeader>
                <CardTitle>Daily Traffic</CardTitle>
                <CardDescription>Page views and unique visitors over time</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats?.dailyViews || []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(val) => format(new Date(val), "MMM d")}
                        className="text-xs"
                      />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="views" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        name="Page Views"
                        dot={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="uniqueVisitors" 
                        stroke="hsl(var(--secondary))" 
                        strokeWidth={2}
                        name="Unique Visitors"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-page-breakdown">
              <CardHeader>
                <CardTitle>Signup Page Trend</CardTitle>
                <CardDescription>Daily visits to the signup page</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats?.dailyViews || []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(val) => format(new Date(val), "MMM d")}
                        className="text-xs"
                      />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")}
                      />
                      <Bar 
                        dataKey="signupViews" 
                        fill="hsl(var(--primary))" 
                        radius={[4, 4, 0, 0]}
                        name="Signup Views"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card data-testid="card-referrers">
              <CardHeader>
                <CardTitle>Top Referrers</CardTitle>
                <CardDescription>Where your traffic is coming from</CardDescription>
              </CardHeader>
              <CardContent>
                {stats?.referrers && stats.referrers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Visits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.referrers.map((ref, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {ref.referrer || "Direct / Unknown"}
                          </TableCell>
                          <TableCell className="text-right">{ref.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No referrer data yet</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-browsers">
              <CardHeader>
                <CardTitle>Browsers</CardTitle>
                <CardDescription>Browser distribution of visitors</CardDescription>
              </CardHeader>
              <CardContent>
                {stats?.browsers && stats.browsers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Browser</TableHead>
                        <TableHead className="text-right">Visits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.browsers.map((b, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Monitor className="w-4 h-4 text-muted-foreground" />
                              {b.browser}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{b.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Monitor className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No browser data yet</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-campaigns">
              <CardHeader>
                <CardTitle>UTM Campaigns</CardTitle>
                <CardDescription>Traffic from marketing campaigns</CardDescription>
              </CardHeader>
              <CardContent>
                {stats?.utmCampaigns && stats.utmCampaigns.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Source / Medium</TableHead>
                        <TableHead className="text-right">Visits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.utmCampaigns.map((campaign, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {campaign.campaign || "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {campaign.source || "-"} / {campaign.medium || "-"}
                          </TableCell>
                          <TableCell className="text-right">{campaign.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No campaign data yet</p>
                    <p className="text-xs mt-1">Use UTM parameters in your links</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-countries" className="mt-6">
            <CardHeader>
              <CardTitle>Visitor Countries</CardTitle>
              <CardDescription>Geographic distribution of your traffic</CardDescription>
            </CardHeader>
            <CardContent>
              {stats?.countries && stats.countries.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  {stats.countries.map((c, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{c.country}</span>
                      <span className="text-muted-foreground ml-auto">{c.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No country data yet</p>
                  <p className="text-xs mt-1">Country tracking begins with new page views</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AppLayout>
  );
}
