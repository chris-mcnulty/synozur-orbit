import { useState, useMemo } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Search,
  AlertTriangle,
  Merge,
  ExternalLink,
  Globe,
  Shield,
  Target,
  Clock,
  Link2,
  Link2Off,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface MarketRole {
  marketId: string;
  marketName: string;
  role: "baseline" | "competitor";
  entityId: string;
}

interface RosterEntry {
  id: string;
  name: string;
  canonicalDomain: string;
  url: string;
  organizationId: string | null;
  organizationName: string | null;
  faviconUrl: string | null;
  lastCrawl: string | null;
  lastFullCrawl: string | null;
  lastSocialCrawl: string | null;
  lastWebsiteMonitor: string | null;
  markets: MarketRole[];
  sourceType: "competitor" | "baseline" | "both";
  linkedInUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
}

interface DuplicateGroup {
  reason: string;
  entries: Array<{ canonicalDomain: string; name: string }>;
}

interface RosterResponse {
  roster: RosterEntry[];
  duplicates: DuplicateGroup[];
  totalMarkets: number;
}

function formatRelativeTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Never";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function getCrawlAge(dateStr: string | null | undefined): "fresh" | "stale" | "none" {
  if (!dateStr) return "none";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "none";
  const diffDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 7) return "fresh";
  return "stale";
}

export default function CompanyRosterPage() {
  const { user: currentUser } = useUser();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [crawlFilter, setCrawlFilter] = useState<string>("all");
  const [duplicateFilter, setDuplicateFilter] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{
    primary: RosterEntry;
    secondary: RosterEntry;
  } | null>(null);

  const isAdmin = currentUser?.role === "Domain Admin" || currentUser?.role === "Global Admin";

  const { data, isLoading } = useQuery<RosterResponse>({
    queryKey: ["/api/tenant/company-roster"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/company-roster", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 403) throw new Error("Access denied");
        throw new Error("Failed to fetch company roster");
      }
      return response.json();
    },
    enabled: isAdmin,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({
      primaryDomain,
      secondaryDomain,
    }: {
      primaryDomain: string;
      secondaryDomain: string;
    }) => {
      const response = await fetch("/api/tenant/company-roster/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ primaryDomain, secondaryDomain }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to merge");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/company-roster"] });
      setMergeDialogOpen(false);
      setMergeTarget(null);
      toast({
        title: "Companies merged",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Merge failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const roster = data?.roster || [];
  const duplicates = data?.duplicates || [];

  const duplicateDomains = useMemo(() => {
    const set = new Set<string>();
    for (const group of duplicates) {
      for (const entry of group.entries) {
        set.add(entry.canonicalDomain);
      }
    }
    return set;
  }, [duplicates]);

  const allMarkets = useMemo(() => {
    const marketMap = new Map<string, string>();
    for (const entry of roster) {
      for (const m of entry.markets) {
        if (m.marketId) {
          marketMap.set(m.marketId, m.marketName);
        }
      }
    }
    return Array.from(marketMap.entries()).map(([id, name]) => ({ id, name }));
  }, [roster]);

  const filteredRoster = useMemo(() => {
    let filtered = roster;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.canonicalDomain.toLowerCase().includes(q)
      );
    }

    if (roleFilter !== "all") {
      filtered = filtered.filter((e) => e.sourceType === roleFilter);
    }

    if (marketFilter !== "all") {
      filtered = filtered.filter((e) =>
        e.markets.some((m) => m.marketId === marketFilter)
      );
    }

    if (crawlFilter === "stale") {
      filtered = filtered.filter((e) => getCrawlAge(e.lastCrawl) === "stale");
    } else if (crawlFilter === "never") {
      filtered = filtered.filter((e) => getCrawlAge(e.lastCrawl) === "none");
    }

    if (duplicateFilter) {
      filtered = filtered.filter((e) => duplicateDomains.has(e.canonicalDomain));
    }

    return filtered;
  }, [roster, searchQuery, roleFilter, marketFilter, crawlFilter, duplicateFilter, duplicateDomains]);

  const getDuplicateInfo = (domain: string): DuplicateGroup | undefined => {
    return duplicates.find((g) => g.entries.some((e) => e.canonicalDomain === domain));
  };

  const openMergeDialog = (entry: RosterEntry) => {
    const group = getDuplicateInfo(entry.canonicalDomain);
    if (!group) return;
    const other = group.entries.find((e) => e.canonicalDomain !== entry.canonicalDomain);
    if (!other) return;
    const otherEntry = roster.find((r) => r.canonicalDomain === other.canonicalDomain);
    if (!otherEntry) return;
    setMergeTarget({ primary: entry, secondary: otherEntry });
    setMergeDialogOpen(true);
  };

  const navigateToEntity = (entry: RosterEntry) => {
    const competitorMarket = entry.markets.find((m) => m.role === "competitor");
    const baselineMarket = entry.markets.find((m) => m.role === "baseline");
    if (competitorMarket) {
      setLocation(`/app/competitors/${competitorMarket.entityId}`);
    } else if (baselineMarket) {
      setLocation("/app/company-profile");
    }
  };

  if (!isAdmin) {
    return (
      <AppLayout>
        <div
          className="flex flex-col items-center justify-center h-64"
          data-testid="roster-access-denied"
        >
          <Shield className="h-12 w-12 text-destructive mb-4" />
          <p className="text-destructive text-lg font-medium">Access Denied</p>
          <p className="text-muted-foreground text-sm">
            This page is only accessible to Domain Admins and Global Admins.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="company-roster-page">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8 text-primary" />
            Company Roster
          </h1>
          <p className="text-muted-foreground mt-1">
            All companies tracked across your markets ({roster.length}{" "}
            companies, {data?.totalMarkets || 0} markets)
            {duplicates.length > 0 && (
              <span className="text-amber-500 ml-2">
                — {duplicates.length} potential duplicate
                {duplicates.length !== 1 ? "s" : ""} detected
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-roster"
            />
          </div>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-role-filter">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="baseline">Baseline</SelectItem>
              <SelectItem value="competitor">Competitor</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>

          {allMarkets.length > 1 && (
            <Select value={marketFilter} onValueChange={setMarketFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-market-filter">
                <SelectValue placeholder="Market" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Markets</SelectItem>
                {allMarkets.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={crawlFilter} onValueChange={setCrawlFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-crawl-filter">
              <SelectValue placeholder="Crawl Age" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Crawl Age</SelectItem>
              <SelectItem value="stale">Stale (&gt;7 days)</SelectItem>
              <SelectItem value="never">Never Crawled</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={duplicateFilter ? "default" : "outline"}
            size="sm"
            onClick={() => setDuplicateFilter(!duplicateFilter)}
            disabled={duplicates.length === 0}
            data-testid="button-toggle-duplicates"
          >
            <AlertTriangle className="h-4 w-4 mr-1" />
            Duplicates ({duplicates.length})
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {filteredRoster.length} Compan{filteredRoster.length !== 1 ? "ies" : "y"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-center py-8" data-testid="text-loading">
                Loading company roster...
              </p>
            ) : filteredRoster.length === 0 ? (
              <p className="text-muted-foreground text-center py-8" data-testid="text-no-results">
                {searchQuery || roleFilter !== "all" || marketFilter !== "all" || crawlFilter !== "all" || duplicateFilter
                  ? "No companies match your filters."
                  : "No companies tracked yet. Add competitors or set up your company baseline to get started."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Markets & Roles</TableHead>
                      <TableHead>Last Crawl</TableHead>
                      <TableHead>Social Fetch</TableHead>
                      <TableHead>Org Link</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRoster.map((entry) => {
                      const isDuplicate = duplicateDomains.has(entry.canonicalDomain);
                      const dupInfo = isDuplicate ? getDuplicateInfo(entry.canonicalDomain) : undefined;
                      const crawlAge = getCrawlAge(entry.lastCrawl);
                      const socialAge = getCrawlAge(entry.lastSocialCrawl);

                      return (
                        <TableRow
                          key={entry.canonicalDomain}
                          className={isDuplicate ? "bg-amber-500/5 border-l-2 border-l-amber-500" : ""}
                          data-testid={`row-roster-${entry.canonicalDomain}`}
                        >
                          <TableCell>
                            {entry.faviconUrl ? (
                              <img
                                src={entry.faviconUrl}
                                alt=""
                                className="h-5 w-5 rounded"
                                data-testid={`img-favicon-${entry.canonicalDomain}`}
                              />
                            ) : (
                              <Globe className="h-5 w-5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <button
                                className="font-medium hover:underline text-left"
                                onClick={() => navigateToEntity(entry)}
                                data-testid={`link-company-${entry.canonicalDomain}`}
                              >
                                {entry.name}
                              </button>
                              {isDuplicate && (
                                <Badge
                                  variant="outline"
                                  className="text-amber-600 border-amber-500 text-xs"
                                  data-testid={`badge-duplicate-${entry.canonicalDomain}`}
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  {dupInfo?.reason || "Duplicate"}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-domain-${entry.canonicalDomain}`}>
                            <span className="text-muted-foreground text-sm">
                              {entry.canonicalDomain}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1" data-testid={`badges-markets-${entry.canonicalDomain}`}>
                              {entry.markets.map((m, i) => (
                                <Badge
                                  key={`${m.marketId}-${m.role}-${i}`}
                                  variant={m.role === "baseline" ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {m.role === "baseline" ? (
                                    <Shield className="h-3 w-3 mr-1" />
                                  ) : (
                                    <Target className="h-3 w-3 mr-1" />
                                  )}
                                  {m.marketName}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-lastcrawl-${entry.canonicalDomain}`}>
                            <span
                              className={
                                crawlAge === "stale"
                                  ? "text-amber-500"
                                  : crawlAge === "none"
                                  ? "text-muted-foreground"
                                  : "text-green-500"
                              }
                            >
                              <Clock className="h-3 w-3 inline mr-1" />
                              {formatRelativeTime(entry.lastCrawl)}
                            </span>
                          </TableCell>
                          <TableCell data-testid={`text-social-${entry.canonicalDomain}`}>
                            <span
                              className={
                                socialAge === "stale"
                                  ? "text-amber-500"
                                  : socialAge === "none"
                                  ? "text-muted-foreground"
                                  : "text-green-500"
                              }
                            >
                              {formatRelativeTime(entry.lastSocialCrawl)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {entry.organizationId ? (
                              <Badge variant="outline" className="text-green-600 border-green-500 text-xs" data-testid={`badge-org-linked-${entry.canonicalDomain}`}>
                                <Link2 className="h-3 w-3 mr-1" />
                                Linked
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground text-xs" data-testid={`badge-org-unlinked-${entry.canonicalDomain}`}>
                                <Link2Off className="h-3 w-3 mr-1" />
                                Unlinked
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {isDuplicate && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openMergeDialog(entry)}
                                  title="Merge duplicate"
                                  data-testid={`button-merge-${entry.canonicalDomain}`}
                                >
                                  <Merge className="h-4 w-4 text-amber-500" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => navigateToEntity(entry)}
                                title="View details"
                                data-testid={`button-view-${entry.canonicalDomain}`}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Merge Companies</DialogTitle>
              <DialogDescription>
                Consolidate two company records under a single organization.
                The primary company's organization will be used. All market
                associations from both records will be preserved.
              </DialogDescription>
            </DialogHeader>
            {mergeTarget && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="p-3 border rounded-lg bg-green-500/5 border-green-500/30">
                    <p className="text-xs text-muted-foreground mb-1">
                      Primary (keep this organization)
                    </p>
                    <div className="flex items-center gap-2">
                      {mergeTarget.primary.faviconUrl ? (
                        <img
                          src={mergeTarget.primary.faviconUrl}
                          alt=""
                          className="h-5 w-5 rounded"
                        />
                      ) : (
                        <Globe className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="font-medium" data-testid="text-merge-primary-name">
                        {mergeTarget.primary.name}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        ({mergeTarget.primary.canonicalDomain})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {mergeTarget.primary.markets.map((m, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {m.role === "baseline" ? "Baseline" : "Competitor"} in{" "}
                          {m.marketName}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 border rounded-lg bg-amber-500/5 border-amber-500/30">
                    <p className="text-xs text-muted-foreground mb-1">
                      Secondary (merge into primary)
                    </p>
                    <div className="flex items-center gap-2">
                      {mergeTarget.secondary.faviconUrl ? (
                        <img
                          src={mergeTarget.secondary.faviconUrl}
                          alt=""
                          className="h-5 w-5 rounded"
                        />
                      ) : (
                        <Globe className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="font-medium" data-testid="text-merge-secondary-name">
                        {mergeTarget.secondary.name}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        ({mergeTarget.secondary.canonicalDomain})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {mergeTarget.secondary.markets.map((m, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {m.role === "baseline" ? "Baseline" : "Competitor"} in{" "}
                          {m.marketName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (mergeTarget) {
                      setMergeTarget({
                        primary: mergeTarget.secondary,
                        secondary: mergeTarget.primary,
                      });
                    }
                  }}
                  className="w-full"
                  data-testid="button-swap-merge"
                >
                  Swap Primary / Secondary
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setMergeDialogOpen(false);
                  setMergeTarget(null);
                }}
                data-testid="button-cancel-merge"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (mergeTarget) {
                    mergeMutation.mutate({
                      primaryDomain: mergeTarget.primary.canonicalDomain,
                      secondaryDomain: mergeTarget.secondary.canonicalDomain,
                    });
                  }
                }}
                disabled={mergeMutation.isPending}
                data-testid="button-confirm-merge"
              >
                <Merge className="h-4 w-4 mr-1" />
                {mergeMutation.isPending ? "Merging..." : "Merge Companies"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
