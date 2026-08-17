import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, ThumbsUp, Trash2, Sparkles, Rocket, Link2, Copy, Check, Lock, MessagesSquare, Filter, Mail } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getTabMarketId } from "@/lib/tabContext";
import { useUser } from "@/lib/userContext";

type FeedbackStatus = "new" | "planned" | "shipped" | "declined";
type FeedbackStatusFilter = "all" | FeedbackStatus;
type FeedbackSort = "votes" | "newest";

interface FeedbackItem {
  id: string;
  productId: string;
  title: string;
  description: string | null;
  category: string | null;
  status: FeedbackStatus;
  source: "internal" | "public";
  submitterUserId: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  promotedFeatureId: string | null;
  promotedFeature: { id: string; name: string; status: string | null } | null;
  voteCount: number;
  hasVoted: boolean;
  createdAt: string;
}

const STATUS_FILTERS: readonly FeedbackStatusFilter[] = ["all", "new", "planned", "shipped", "declined"];
const SORT_VALUES: readonly FeedbackSort[] = ["votes", "newest"];

function isStatusFilter(v: string): v is FeedbackStatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v);
}
function isSortValue(v: string): v is FeedbackSort {
  return (SORT_VALUES as readonly string[]).includes(v);
}

interface FeedbackResponse {
  items: FeedbackItem[];
  publicEnabled: boolean;
  publicToken: string | null;
  emailNotificationsEnabled: boolean;
}

interface SimilarGroup {
  label: string;
  feedbackIds: string[];
}

const STATUS_OPTIONS: { value: FeedbackItem["status"]; label: string; tone: string }[] = [
  { value: "new", label: "New", tone: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  { value: "planned", label: "Planned", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  { value: "shipped", label: "Shipped", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  { value: "declined", label: "Declined", tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
];

function statusBadge(status: FeedbackItem["status"]) {
  const opt = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
  return <Badge variant="outline" className={opt.tone} data-testid={`status-feedback-${status}`}>{opt.label}</Badge>;
}

interface FeedbackTabProps {
  productId: string;
  productName: string;
}

export default function FeedbackTab({ productId, productName }: FeedbackTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";

  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>("all");
  const [sortBy, setSortBy] = useState<FeedbackSort>("votes");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ title: "", description: "", category: "" });
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [similarGroups, setSimilarGroups] = useState<SimilarGroup[] | null>(null);
  const [isGroupingLoading, setIsGroupingLoading] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<FeedbackResponse>({
    queryKey: ["/api/products", getTabMarketId(), productId, "feedback"],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/feedback`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load feedback");
      return res.json();
    },
  });

  const items = data?.items ?? [];
  const filteredItems = useMemo(() => {
    let arr = items;
    if (statusFilter !== "all") arr = arr.filter(i => i.status === statusFilter);
    if (sortBy === "newest") {
      arr = [...arr].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      arr = [...arr].sort((a, b) => b.voteCount - a.voteCount || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return arr;
  }, [items, statusFilter, sortBy]);

  const createMutation = useMutation({
    mutationFn: async (payload: typeof formData) => {
      const res = await fetch(`/api/products/${productId}/feedback`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title.trim(),
          description: payload.description.trim() || null,
          category: payload.category.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit feedback");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] });
      setFormData({ title: "", description: "", category: "" });
      setIsAddOpen(false);
      toast({ title: "Feedback submitted" });
    },
    onError: (err: any) => toast({ title: "Submission failed", description: err.message, variant: "destructive" }),
  });

  const voteMutation = useMutation({
    mutationFn: async (feedbackId: string) => {
      const res = await fetch(`/api/products/${productId}/feedback/${feedbackId}/vote`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to vote");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] }),
    onError: (err: any) => toast({ title: "Vote failed", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: FeedbackItem["status"] }) => {
      const res = await fetch(`/api/products/${productId}/feedback/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update status");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] });
      toast({ title: "Status updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/products/${productId}/feedback/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] });
      toast({ title: "Feedback deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const promoteMutation = useMutation({
    mutationFn: async (feedbackId: string) => {
      const res = await fetch(`/api/products/${productId}/feedback/${feedbackId}/promote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "medium", status: "planned" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to promote");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "roadmap"] });
      toast({ title: "Promoted to feature", description: "This idea now appears on the product feature list and roadmap source." });
    },
    onError: (err: any) => toast({ title: "Promotion failed", description: err.message, variant: "destructive" }),
    onSettled: () => setPromotingId(null),
  });

  const notificationsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`/api/products/${productId}/feedback/notifications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update notification setting");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] });
      toast({ title: "Notification setting updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const shareMutation = useMutation({
    mutationFn: async (action: "enable" | "disable" | "rotate") => {
      const res = await fetch(`/api/products/${productId}/feedback/share-token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update public link");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", getTabMarketId(), productId, "feedback"] });
      toast({ title: "Public link updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const handleGroupSimilar = async () => {
    setIsGroupingLoading(true);
    setSimilarGroups(null);
    try {
      const res = await fetch(`/api/products/${productId}/feedback/group-similar`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to group items");
      }
      const json = await res.json();
      setSimilarGroups(json.groups || []);
      if (!json.groups || json.groups.length === 0) {
        toast({ title: "No duplicate clusters found", description: "All items appear to be distinct." });
      }
    } catch (err: any) {
      toast({ title: "Grouping failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGroupingLoading(false);
    }
  };

  const publicUrl = data?.publicToken ? `${window.location.origin}/feedback/${data.publicToken}` : "";

  const copyPublicLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please copy the link manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="h-5 w-5" />
                Customer Feedback
              </CardTitle>
              <CardDescription>
                Capture customer requests for {productName}, let your team upvote, and promote popular ideas to the product roadmap.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGroupSimilar}
                disabled={isGroupingLoading || items.length < 2}
                data-testid="button-group-similar"
              >
                {isGroupingLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Group similar items
              </Button>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setIsShareOpen(true)} data-testid="button-share-feedback">
                  <Link2 className="h-4 w-4 mr-2" />
                  Public link
                </Button>
              )}
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-add-feedback">
                    <Plus className="h-4 w-4 mr-2" />
                    Submit feedback
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Submit feedback</DialogTitle>
                    <DialogDescription>Share an idea, request, or issue. Your team will be able to upvote it.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div>
                      <Label htmlFor="fb-title">Title</Label>
                      <Input
                        id="fb-title"
                        data-testid="input-feedback-title"
                        value={formData.title}
                        onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                        placeholder="Short summary of the request"
                        maxLength={200}
                      />
                    </div>
                    <div>
                      <Label htmlFor="fb-description">Details</Label>
                      <Textarea
                        id="fb-description"
                        data-testid="input-feedback-description"
                        value={formData.description}
                        onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                        placeholder="What problem does this solve? Who benefits?"
                        rows={5}
                        maxLength={4000}
                      />
                    </div>
                    <div>
                      <Label htmlFor="fb-category">Category (optional)</Label>
                      <Input
                        id="fb-category"
                        data-testid="input-feedback-category"
                        value={formData.category}
                        onChange={e => setFormData(f => ({ ...f, category: e.target.value }))}
                        placeholder="e.g. Reporting, Mobile, Integrations"
                        maxLength={60}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                    <Button
                      onClick={() => createMutation.mutate(formData)}
                      disabled={!formData.title.trim() || createMutation.isPending}
                      data-testid="button-submit-feedback"
                    >
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Submit
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b">
            <Tabs value={statusFilter} onValueChange={(v) => { if (isStatusFilter(v)) setStatusFilter(v); }}>
              <TabsList>
                <TabsTrigger value="all" data-testid="tab-feedback-all">All ({items.length})</TabsTrigger>
                {STATUS_OPTIONS.map(s => (
                  <TabsTrigger key={s.value} value={s.value} data-testid={`tab-feedback-${s.value}`}>
                    {s.label} ({items.filter(i => i.status === s.value).length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2 text-sm">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={sortBy} onValueChange={(v) => { if (isSortValue(v)) setSortBy(v); }}>
                <SelectTrigger className="h-8 w-[160px]" data-testid="select-feedback-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="votes">Most upvoted</SelectItem>
                  <SelectItem value="newest">Newest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {similarGroups && similarGroups.length > 0 && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI-suggested duplicate clusters
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSimilarGroups(null)} data-testid="button-dismiss-groups">Dismiss</Button>
              </div>
              {similarGroups.map((g, idx) => {
                const groupItems = items.filter(i => g.feedbackIds.includes(i.id));
                return (
                  <div key={idx} className="rounded-md border bg-background/40 p-2" data-testid={`group-similar-${idx}`}>
                    <p className="text-sm font-medium mb-1">{g.label}</p>
                    <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                      {groupItems.map(it => <li key={it.id}>{it.title}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading feedback...
              </div>
            )}
            {!isLoading && filteredItems.length === 0 && (
              <div className="text-center py-12 text-muted-foreground" data-testid="empty-feedback">
                No feedback yet. Be the first to share an idea.
              </div>
            )}
            {filteredItems.map(item => {
              const canEditOwn = item.submitterUserId === user?.id;
              return (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-lg border p-3 hover:border-primary/30 transition-colors"
                  data-testid={`card-feedback-${item.id}`}
                >
                  <div className="flex flex-col items-center gap-1 min-w-[3.5rem]">
                    <Button
                      variant={item.hasVoted ? "default" : "outline"}
                      size="sm"
                      className="h-12 w-12 flex-col gap-0.5"
                      onClick={() => voteMutation.mutate(item.id)}
                      disabled={voteMutation.isPending}
                      data-testid={`button-vote-${item.id}`}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      <span className="text-xs font-semibold" data-testid={`text-votes-${item.id}`}>{item.voteCount}</span>
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-2 items-start justify-between">
                      <div className="min-w-0">
                        <h4 className="font-semibold leading-snug" data-testid={`text-feedback-title-${item.id}`}>{item.title}</h4>
                        {item.description && (
                          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{item.description}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground items-center">
                          {statusBadge(item.status)}
                          {item.category && <Badge variant="secondary">{item.category}</Badge>}
                          {item.source === "public" && <Badge variant="outline" className="border-purple-500/30 text-purple-300">Public</Badge>}
                          {item.promotedFeature ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 text-emerald-300"
                              data-testid={`badge-promoted-${item.id}`}
                              title={`Promoted to feature: ${item.promotedFeature.name}`}
                            >
                              <Rocket className="h-3 w-3 mr-1" />
                              Promoted to: {item.promotedFeature.name}
                            </Badge>
                          ) : item.promotedFeatureId ? (
                            <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">Promoted</Badge>
                          ) : null}
                          <span>By {item.submitterName || item.submitterEmail || "Anonymous"}</span>
                          <span>· {new Date(item.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {isAdmin && (
                          <Select
                            value={item.status}
                            onValueChange={(v) => updateStatusMutation.mutate({ id: item.id, status: v as FeedbackItem["status"] })}
                          >
                            <SelectTrigger className="h-8 w-[130px]" data-testid={`select-status-${item.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map(s => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {isAdmin && !item.promotedFeatureId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setPromotingId(item.id); promoteMutation.mutate(item.id); }}
                            disabled={promoteMutation.isPending && promotingId === item.id}
                            data-testid={`button-promote-${item.id}`}
                          >
                            {promoteMutation.isPending && promotingId === item.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Rocket className="h-4 w-4 mr-1" />
                            )}
                            Promote
                          </Button>
                        )}
                        {(isAdmin || canEditOwn) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(item.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Public feedback link</DialogTitle>
            <DialogDescription>
              Share a tokenized URL so customers and prospects can submit feedback and vote without logging in. Public traffic is rate limited and uses a simple captcha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="font-medium text-sm flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Enable public submissions
                </p>
                <p className="text-xs text-muted-foreground">When off, the public URL will return 404.</p>
              </div>
              <Switch
                checked={!!data?.publicEnabled}
                onCheckedChange={(checked) => shareMutation.mutate(checked ? "enable" : "disable")}
                disabled={shareMutation.isPending}
                data-testid="switch-public-feedback"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="font-medium text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email submitters & voters on status changes
                </p>
                <p className="text-xs text-muted-foreground">
                  Send an email when feedback moves to Planned or Shipped. Recipients are the original submitter and anyone who upvoted.
                </p>
              </div>
              <Switch
                checked={!!data?.emailNotificationsEnabled}
                onCheckedChange={(checked) => notificationsMutation.mutate(checked)}
                disabled={notificationsMutation.isPending}
                data-testid="switch-feedback-email-notifications"
              />
            </div>
            {data?.publicEnabled && publicUrl && (
              <div className="space-y-2">
                <Label>Shareable URL</Label>
                <div className="flex gap-2">
                  <Input value={publicUrl} readOnly data-testid="input-public-url" />
                  <Button variant="outline" onClick={copyPublicLink} data-testid="button-copy-link">
                    {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => shareMutation.mutate("rotate")}
                  disabled={shareMutation.isPending}
                  data-testid="button-rotate-link"
                >
                  Rotate link (invalidates the current URL)
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsShareOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
