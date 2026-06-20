/**
 * Link Builder tab for campaign-detail.
 *
 * Allows building UTM-tagged short links scoped to a campaign, listing them
 * with click counts, copying the redirect URL, and archiving (soft-deleting)
 * stale links. UTM defaults are pre-filled from the campaign name.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Link2,
  Plus,
  Copy,
  Archive,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";

interface MarketingLink {
  id: string;
  slug: string;
  destinationUrl: string;
  label: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  status: string;
  source: string;
  createdAt: string;
  shortUrl?: string;
}

interface UtmDefaults {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
}

export function LinkBuilderTab({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [label, setLabel] = useState("");
  const [utm, setUtm] = useState<UtmDefaults>({ utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", utmTerm: "" });

  const { data: links = [], isLoading } = useQuery<MarketingLink[]>({
    queryKey: ["/api/marketing-links", { campaignId }],
    queryFn: async () => {
      const r = await fetch(`/api/marketing-links?campaignId=${encodeURIComponent(campaignId)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load links");
      return r.json();
    },
  });

  const { data: defaults } = useQuery<UtmDefaults & { utmCampaign: string }>({
    queryKey: ["/api/campaigns/utm-defaults", campaignId],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${campaignId}/utm-defaults`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load UTM defaults");
      return r.json();
    },
  });

  // When the create dialog opens, seed UTM defaults from the campaign so the
  // user only has to fill in source / medium for their specific channel.
  useEffect(() => {
    if (open && defaults) {
      setUtm(prev => ({
        ...prev,
        utmCampaign: prev.utmCampaign || defaults.utmCampaign || "",
      }));
    }
  }, [open, defaults]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/marketing-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          destinationUrl,
          label: label || `${campaignName} link`,
          campaignId,
          utmSource: utm.utmSource || undefined,
          utmMedium: utm.utmMedium || undefined,
          utmCampaign: utm.utmCampaign || undefined,
          utmContent: utm.utmContent || undefined,
          utmTerm: utm.utmTerm || undefined,
          applyUtmsToDestination: true,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Failed to create link");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-links"] });
      setOpen(false);
      setDestinationUrl("");
      setLabel("");
      setUtm({ utmSource: "", utmMedium: "", utmCampaign: defaults?.utmCampaign || "", utmContent: "", utmTerm: "" });
      toast({ title: "Tracked link created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/marketing-links/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed to archive link");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-links"] });
      toast({ title: "Link archived" });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${campaignId}/marketing-links/cleanup-post-wrap`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Cleanup failed");
      return r.json() as Promise<{ archived: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-links"] });
      toast({ title: data.archived > 0 ? `Cleaned up ${data.archived} orphaned link${data.archived === 1 ? "" : "s"}` : "No orphaned links found" });
    },
    onError: (err: Error) => toast({ title: "Cleanup failed", description: err.message, variant: "destructive" }),
  });

  const activeLinks = links.filter(l => l.status === "active");
  const archivedLinks = links.filter(l => l.status === "archived");
  const postWrapActiveCount = activeLinks.filter(l => l.source === "post-wrap").length;

  const copyToClipboard = (link: MarketingLink) => {
    const url = link.shortUrl || `${window.location.origin}/r/${link.slug}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Copied to clipboard", description: url });
  };

  return (
    <div className="space-y-4" data-testid="links-tab-content">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Tracked Links
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build UTM-tagged short links and track click counts. Use these in posts, emails, or any external touchpoint.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {postWrapActiveCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
              title="Archive auto-generated post links whose posts have been deleted"
              data-testid="button-cleanup-post-links"
            >
              {cleanupMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Clean up auto-links
            </Button>
          )}
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5" data-testid="button-new-link">
            <Plus className="w-3.5 h-3.5" /> New Link
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="links-loading">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeLinks.length === 0 ? (
        <Card>
          <CardContent className="text-center py-10">
            <Link2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No tracked links yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Create one to start measuring traffic from this campaign.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activeLinks.map(link => {
            const shortUrl = link.shortUrl || `${window.location.origin}/r/${link.slug}`;
            return (
              <Card key={link.id} data-testid={`card-link-${link.id}`}>
                <CardContent className="py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium truncate" data-testid={`text-link-label-${link.id}`}>
                          {link.label || link.slug}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {link.source === "manual" ? "Manual" : link.source === "email-wrap" ? "Email" : "Post"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]" data-testid={`text-link-short-${link.id}`}>
                          /r/{link.slug}
                        </code>
                        <span>→</span>
                        <a
                          href={link.destinationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:underline flex items-center gap-1 max-w-md"
                          data-testid={`link-destination-${link.id}`}
                        >
                          {link.destinationUrl}
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      </div>
                      {(link.utmSource || link.utmMedium || link.utmCampaign) && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {link.utmSource && <Badge variant="outline" className="text-[10px]">src: {link.utmSource}</Badge>}
                          {link.utmMedium && <Badge variant="outline" className="text-[10px]">med: {link.utmMedium}</Badge>}
                          {link.utmCampaign && <Badge variant="outline" className="text-[10px]">camp: {link.utmCampaign}</Badge>}
                          {link.utmContent && <Badge variant="outline" className="text-[10px]">cnt: {link.utmContent}</Badge>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="text-right">
                        <div className="text-lg font-bold leading-none" data-testid={`text-link-clicks-${link.id}`}>{link.clickCount}</div>
                        <div className="text-[10px] text-muted-foreground">clicks</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => copyToClipboard(link)} className="h-7 px-2" data-testid={`button-copy-link-${link.id}`}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => archiveMutation.mutate(link.id)} className="h-7 px-2" data-testid={`button-archive-link-${link.id}`}>
                        <Archive className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {archivedLinks.length > 0 && (
        <details className="text-xs text-muted-foreground" data-testid="archived-links-section">
          <summary className="cursor-pointer">{archivedLinks.length} archived link{archivedLinks.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {archivedLinks.map(l => (
              <li key={l.id} className="flex items-center gap-2">
                <code className="bg-muted px-1.5 py-0.5 rounded">/r/{l.slug}</code>
                <span>{l.label}</span>
                <span>· {l.clickCount} clicks</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Tracked Link</DialogTitle>
            <DialogDescription>
              Build a UTM-tagged short link. The redirect URL is safe to paste anywhere — it appends the UTM params to your destination on click.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="link-destination">Destination URL</Label>
              <Input
                id="link-destination"
                value={destinationUrl}
                onChange={e => setDestinationUrl(e.target.value)}
                placeholder="https://example.com/landing-page"
                data-testid="input-link-destination"
              />
            </div>
            <div>
              <Label htmlFor="link-label">Label (optional)</Label>
              <Input
                id="link-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={`${campaignName} – LinkedIn`}
                data-testid="input-link-label"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="utm-source" className="text-xs">UTM Source</Label>
                <Input id="utm-source" value={utm.utmSource} onChange={e => setUtm(p => ({ ...p, utmSource: e.target.value }))} placeholder="linkedin" data-testid="input-utm-source" />
              </div>
              <div>
                <Label htmlFor="utm-medium" className="text-xs">UTM Medium</Label>
                <Input id="utm-medium" value={utm.utmMedium} onChange={e => setUtm(p => ({ ...p, utmMedium: e.target.value }))} placeholder="social" data-testid="input-utm-medium" />
              </div>
              <div>
                <Label htmlFor="utm-campaign" className="text-xs">UTM Campaign</Label>
                <Input id="utm-campaign" value={utm.utmCampaign} onChange={e => setUtm(p => ({ ...p, utmCampaign: e.target.value }))} placeholder="spring-launch" data-testid="input-utm-campaign" />
              </div>
              <div>
                <Label htmlFor="utm-content" className="text-xs">UTM Content</Label>
                <Input id="utm-content" value={utm.utmContent} onChange={e => setUtm(p => ({ ...p, utmContent: e.target.value }))} placeholder="hero-cta" data-testid="input-utm-content" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="utm-term" className="text-xs">UTM Term</Label>
                <Input id="utm-term" value={utm.utmTerm} onChange={e => setUtm(p => ({ ...p, utmTerm: e.target.value }))} placeholder="optional keyword" data-testid="input-utm-term" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-link">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!destinationUrl.trim() || createMutation.isPending}
              data-testid="button-create-link"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Link"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
