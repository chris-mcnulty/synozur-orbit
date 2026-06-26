/**
 * Publish-to-website dialog for a content asset. Posts (or updates) the asset
 * as a blog draft on the Synozur Insights site via the per-tenant website MCP,
 * with author / category / tag / excerpt / hero-image / schedule controls, and
 * shows live traffic once the post exists. The heavy lifting (create vs update,
 * hero upload, scheduling) is server-side in /api/integrations/website.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Loader2, CalendarClock, MousePointerClick, Users, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Asset {
  id: string;
  title: string;
  description?: string;
  leadImageUrl?: string;
  websitePostSlug?: string | null;
  websitePostStatus?: string | null;
  websiteScheduledFor?: string | null;
}
interface Author { id: string; displayName: string }
interface Taxonomy { id: string; name: string }
interface Performance {
  totalViews: number;
  uniqueSessions: number;
  viewsByDay: { date: string; views: number }[];
  topReferrers: { host: string; count: number }[];
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 200, h = 36, peak = Math.max(1, ...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / peak) * h).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="text-primary">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />
      <polyline fill="currentColor" fillOpacity="0.12" stroke="none" points={`0,${h} ${pts} ${w},${h}`} />
    </svg>
  );
}

export function WebsitePublishDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [authorId, setAuthorId] = useState<string>("");
  const [excerpt, setExcerpt] = useState("");
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [useHero, setUseHero] = useState(true);
  const [scheduledFor, setScheduledFor] = useState("");

  const alreadyPosted = !!asset?.websitePostSlug;

  const { data: status } = useQuery<{ connected: boolean; defaultAuthorId?: string | null }>({
    queryKey: ["/api/integrations/website/status"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/status", { credentials: "include" });
      return r.ok ? r.json() : { connected: false };
    },
    enabled: open,
  });
  const { data: authors = [] } = useQuery<Author[]>({
    queryKey: ["/api/integrations/website/authors"],
    queryFn: async () => (await fetch("/api/integrations/website/authors", { credentials: "include" })).json(),
    enabled: open,
  });
  const { data: categories = [] } = useQuery<Taxonomy[]>({
    queryKey: ["/api/integrations/website/categories"],
    queryFn: async () => (await fetch("/api/integrations/website/categories", { credentials: "include" })).json(),
    enabled: open,
  });
  const { data: tags = [] } = useQuery<Taxonomy[]>({
    queryKey: ["/api/integrations/website/tags"],
    queryFn: async () => (await fetch("/api/integrations/website/tags", { credentials: "include" })).json(),
    enabled: open,
  });
  const { data: performance } = useQuery<Performance>({
    queryKey: ["/api/integrations/website/performance", asset?.id],
    queryFn: async () => {
      const r = await fetch(`/api/integrations/website/performance?assetId=${asset!.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("no performance");
      return r.json();
    },
    enabled: open && alreadyPosted,
  });

  // Seed the form when the dialog opens.
  useEffect(() => {
    if (!open || !asset) return;
    setAuthorId(status?.defaultAuthorId ?? "");
    setExcerpt(asset.description ?? "");
    setCategoryIds(new Set());
    setTagIds(new Set());
    setUseHero(!!asset.leadImageUrl);
    setScheduledFor("");
  }, [open, asset, status?.defaultAuthorId]);

  const push = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/integrations/website/push-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assetId: asset!.id,
          authorId: authorId || undefined,
          excerpt: excerpt || undefined,
          categoryIds: categoryIds.size ? Array.from(categoryIds) : undefined,
          tagIds: tagIds.size ? Array.from(tagIds) : undefined,
          useLeadImageAsHero: useHero,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to publish");
      return data.post as { slug: string; status: string };
    },
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/website/performance", asset?.id] });
      toast({
        title: post.status === "scheduled" ? "Scheduled on website" : alreadyPosted ? "Website draft updated" : "Draft posted to website",
        description: `/${post.slug}`,
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Couldn't publish", description: e.message, variant: "destructive" }),
  });

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    apply(next);
  };

  const trend = useMemo(() => (performance?.viewsByDay ?? []).map((d) => d.views), [performance]);

  if (!asset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" /> {alreadyPosted ? "Update website draft" : "Post draft to website"}
          </DialogTitle>
          <DialogDescription className="truncate">{asset.title}</DialogDescription>
        </DialogHeader>

        {alreadyPosted && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs flex items-center gap-2" data-testid="website-current-state">
            <Badge variant="secondary" className="capitalize">{asset.websitePostStatus ?? "draft"}</Badge>
            <span className="text-muted-foreground font-mono">/{asset.websitePostSlug}</span>
            {asset.websiteScheduledFor && (
              <span className="ml-auto text-muted-foreground inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" /> {new Date(asset.websiteScheduledFor).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Live performance once the post exists */}
        {alreadyPosted && performance && (
          <div className="rounded-md border p-3 space-y-2" data-testid="website-performance">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xl font-bold tabular-nums flex items-center gap-1.5"><MousePointerClick className="w-4 h-4 text-muted-foreground" />{performance.totalViews.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Views</div>
              </div>
              <div>
                <div className="text-xl font-bold tabular-nums flex items-center gap-1.5"><Users className="w-4 h-4 text-muted-foreground" />{performance.uniqueSessions.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sessions</div>
              </div>
              <div className="flex-1 min-w-0">
                <Sparkline data={trend} />
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> 30-day views</div>
              </div>
            </div>
            {performance.topReferrers.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Top referrers: {performance.topReferrers.slice(0, 3).map((r) => `${r.host} (${r.count})`).join(" · ")}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {!alreadyPosted && (
            <div>
              <Label className="text-xs text-muted-foreground">Author</Label>
              <Select value={authorId || "none"} onValueChange={(v) => setAuthorId(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1" data-testid="select-website-author"><SelectValue placeholder="Choose an author" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose an author…</SelectItem>
                  {authors.map((a) => <SelectItem key={a.id} value={a.id}>{a.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Excerpt</Label>
            <Textarea rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Short summary shown on listing cards" data-testid="input-website-excerpt" />
          </div>

          {categories.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Categories</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {categories.map((c) => (
                  <button key={c.id} type="button" aria-pressed={categoryIds.has(c.id)} onClick={() => toggle(categoryIds, c.id, setCategoryIds)} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`website-category-${c.id}`}>
                    <Badge variant={categoryIds.has(c.id) ? "default" : "outline"} className="cursor-pointer">{c.name}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tags.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Tags</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {tags.map((t) => (
                  <button key={t.id} type="button" aria-pressed={tagIds.has(t.id)} onClick={() => toggle(tagIds, t.id, setTagIds)} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`website-tag-${t.id}`}>
                    <Badge variant={tagIds.has(t.id) ? "default" : "outline"} className="cursor-pointer">{t.name}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {asset.leadImageUrl && (
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Use lead image as hero</Label>
              <Switch checked={useHero} onCheckedChange={setUseHero} data-testid="switch-website-hero" />
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Schedule for <span className="font-normal">(optional)</span></Label>
            <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} data-testid="input-website-schedule" />
            <p className="text-[11px] text-muted-foreground mt-1">Leave blank to leave it as a draft for manual publish.</p>
          </div>

          <Button
            className={cn("w-full")}
            disabled={push.isPending || (!alreadyPosted && !authorId)}
            onClick={() => push.mutate()}
            data-testid="button-website-publish-confirm"
          >
            {push.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Globe className="w-4 h-4 mr-2" />}
            {scheduledFor ? "Schedule on website" : alreadyPosted ? "Update website draft" : "Post draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
