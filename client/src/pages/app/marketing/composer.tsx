/**
 * Composer Page (Phase 3)
 *
 * Direct authoring of social posts outside a campaign. The user picks one
 * or more connected social accounts (one generated_post row per account so
 * each picks up its own voice profile), drafts content, optionally invokes
 * the shared AI Rewrite Panel, then either saves a draft, schedules for
 * later, or publishes immediately.
 */

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  PencilLine, Send, Calendar as CalendarIcon, Save, AtSign, Lock, Loader2, Hash, X,
  ImagePlus, Zap, FileDown, Megaphone,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import AIRewritePanel from "@/components/marketing/AIRewritePanel";

interface CampaignOption {
  id: string;
  name: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  isConnected?: boolean;
  encryptedAccessToken?: boolean | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  instagram: "Instagram",
  facebook: "Facebook",
  bluesky: "Bluesky",
};

export default function ComposerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  // Per-account draft so per-account voice rewrites don't clobber each other.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [hashtagInputs, setHashtagInputs] = useState<Record<string, string>>({});
  const [scheduledAt, setScheduledAt] = useState<string>(""); // local datetime-input value
  const [submitting, setSubmitting] = useState(false);
  // Optional campaign + how this post goes out. Default is Orbit-direct; the
  // CSV-batch option only applies (and only renders) when a campaign is set.
  const [campaignId, setCampaignId] = useState<string>(""); // "" = standalone
  const [deliveryMode, setDeliveryMode] = useState<"orbit" | "csv">("orbit");
  // One shared image applied to every post in this batch.
  const [attachedImage, setAttachedImage] = useState<{ url: string; name: string } | null>(null);
  const pendingUploadPathRef = useRef<string | null>(null);

  const effectiveDelivery: "orbit" | "csv" = campaignId ? deliveryMode : "orbit";
  const isCsv = effectiveDelivery === "csv";

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  // Composer APIs (rewrite, create, patch, calendar) are gated by socialPosts
  // on the backend; publish is additionally gated by directPublishing. Match
  // the *minimum* gate so the UI doesn't render only to 403 on every call.
  const isAllowed = tenantInfo?.features?.socialPosts === true;

  const { data: accounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: campaigns = [] } = useQuery<CampaignOption[]>({
    queryKey: ["/api/campaigns", "composer-options"],
    queryFn: async () => {
      const r = await fetch("/api/campaigns?pageSize=200", { credentials: "include" });
      if (!r.ok) return [];
      const j = await r.json();
      const items = Array.isArray(j) ? j : j.items ?? [];
      return items.map((c: any) => ({ id: c.id, name: c.name }));
    },
    enabled: isAllowed,
  });

  const accountsById = useMemo(() => {
    const m = new Map<string, SocialAccount>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  const toggleAccount = (id: string) => {
    setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setDrafts(prev => prev[id] ? prev : { ...prev, [id]: "" });
  };

  const setDraft = (accountId: string, value: string) =>
    setDrafts(prev => ({ ...prev, [accountId]: value }));

  const parseHashtags = (input: string): string[] =>
    input.split(/[,\s]+/).map(h => h.replace(/^#/, "").trim()).filter(Boolean);

  // "batch" = approve into the campaign for CSV export (Orbit won't post it).
  type Action = "draft" | "schedule" | "publish" | "batch";

  const submit = async (action: Action) => {
    if (selectedAccountIds.length === 0) {
      toast({ title: "Pick at least one account", variant: "destructive" });
      return;
    }
    const missing = selectedAccountIds.filter(id => !(drafts[id] ?? "").trim());
    if (missing.length > 0) {
      toast({ title: "Add content for every selected account", variant: "destructive" });
      return;
    }
    if (action === "schedule" && !scheduledAt) {
      toast({ title: "Pick a date and time to schedule", variant: "destructive" });
      return;
    }
    if (action === "publish") {
      const unconnected = selectedAccountIds.filter(id => {
        const a = accountsById.get(id);
        return !(a?.isConnected || a?.encryptedAccessToken);
      });
      if (unconnected.length > 0) {
        toast({
          title: "One or more selected accounts aren't connected",
          description: "Connect them on the Social Accounts page or save as draft instead.",
          variant: "destructive",
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const created: Array<{ id: string; accountId: string; platform: string }> = [];
      for (const accountId of selectedAccountIds) {
        const account = accountsById.get(accountId);
        if (!account) continue;
        const content = drafts[accountId].trim();
        const hashtags = parseHashtags(hashtagInputs[accountId] ?? "");
        const r = await fetch("/api/generated-posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            socialAccountId: accountId,
            content,
            hashtags,
            campaignId: campaignId || null,
            scheduledDate: action === "schedule" ? new Date(scheduledAt).toISOString() : null,
          }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Create failed");
        const post = await r.json();
        created.push({ id: post.id, accountId, platform: account.platform });

        // One PATCH carries the attachment, delivery mode, and approval.
        // Everything but a plain draft is approved (scheduling = implicit
        // approval); the delivery mode is only meaningful within a campaign.
        const patch: Record<string, unknown> = {};
        if (attachedImage) patch.overrideImageUrl = attachedImage.url;
        if (campaignId) patch.deliveryMode = isCsv ? "csv" : "orbit";
        if (action !== "draft") patch.status = "approved";
        if (Object.keys(patch).length > 0) {
          const ar = await fetch(`/api/generated-posts/${post.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(patch),
          });
          if (!ar.ok) throw new Error((await ar.json().catch(() => ({}))).error || "Save failed");
        }

        // Only Orbit-direct posts actually publish; batch posts wait for CSV export.
        if (action === "publish") {
          const pr = await fetch(`/api/generated-posts/${post.id}/publish`, {
            method: "POST",
            credentials: "include",
          });
          if (!pr.ok) throw new Error((await pr.json().catch(() => ({}))).error || "Publish failed");
        }
      }

      const n = created.length;
      const s = n === 1 ? "" : "s";
      if (action === "draft") toast({ title: `Saved ${n} draft${s}` });
      else if (action === "schedule") toast({ title: `Scheduled ${n} post${s}` });
      else if (action === "batch") toast({ title: `Added ${n} post${s} to the campaign batch`, description: "Approved for CSV export — Orbit won't post these." });
      else toast({ title: `Published ${n} post${s}` });
      // Clear so the user can compose another batch.
      setDrafts({});
      setHashtagInputs({});
      setSelectedAccountIds([]);
      setScheduledAt("");
      setAttachedImage(null);
      pendingUploadPathRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Composer</CardTitle>
              <CardDescription>Available on the Enterprise plan. Compose, schedule, and publish posts directly to your connected social accounts.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Composer">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PencilLine className="w-6 h-6" /> Composer
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compose a post and publish or schedule it directly to your connected social accounts. Each account uses its own voice profile.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><AtSign className="w-4 h-4" /> Accounts</CardTitle>
            <CardDescription className="text-xs">Choose one or more. A separate post is drafted per account so each picks up its own voice.</CardDescription>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No social accounts yet. <Link href="/app/marketing/social-accounts" className="text-primary underline">Add one →</Link>
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {accounts.map(a => {
                  const checked = selectedAccountIds.includes(a.id);
                  const connected = !!(a.isConnected || a.encryptedAccessToken);
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-muted/50 ${checked ? "bg-muted" : ""}`}
                      data-testid={`composer-account-${a.id}`}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleAccount(a.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.accountName}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Badge variant="secondary" className="text-[10px]">{PLATFORM_LABELS[a.platform] ?? a.platform}</Badge>
                          {!connected && <span className="text-amber-600">not connected</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedAccountIds.length > 0 && (
          <div className="space-y-4">
            {selectedAccountIds.map(accountId => {
              const account = accountsById.get(accountId);
              if (!account) return null;
              return (
                <Card key={accountId}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{PLATFORM_LABELS[account.platform] ?? account.platform}</Badge>
                        {account.accountName}
                      </CardTitle>
                      <Button
                        type="button" variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => toggleAccount(accountId)}
                        data-testid={`composer-remove-${accountId}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-xs">Post content</Label>
                      <Textarea
                        rows={5}
                        value={drafts[accountId] ?? ""}
                        onChange={e => setDraft(accountId, e.target.value)}
                        placeholder={`Write your ${PLATFORM_LABELS[account.platform] ?? account.platform} post...`}
                        data-testid={`composer-content-${accountId}`}
                      />
                      <div className="text-xs text-muted-foreground mt-1">{(drafts[accountId] ?? "").length} characters</div>
                    </div>
                    <div>
                      <Label className="text-xs flex items-center gap-1"><Hash className="w-3 h-3" /> Hashtags</Label>
                      <Input
                        value={hashtagInputs[accountId] ?? ""}
                        onChange={e => setHashtagInputs(prev => ({ ...prev, [accountId]: e.target.value }))}
                        placeholder="tag1, tag2, tag3"
                        className="text-xs"
                        data-testid={`composer-hashtags-${accountId}`}
                      />
                    </div>
                    <AIRewritePanel
                      socialAccountId={accountId}
                      draft={drafts[accountId] ?? ""}
                      onApply={(variant) => setDraft(accountId, variant)}
                    />
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Attachment — applied to every post in this batch */}
                  <div>
                    <Label className="text-xs">Image <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    {attachedImage ? (
                      <div className="flex items-center gap-3 mt-1.5">
                        <img src={attachedImage.url} alt="" className="w-12 h-12 rounded object-cover border" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm truncate">{attachedImage.name}</div>
                          <div className="text-xs text-muted-foreground">Attached to every selected account</div>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setAttachedImage(null); pendingUploadPathRef.current = null; }} data-testid="composer-remove-image">
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-1.5">
                        <ObjectUploader
                          maxNumberOfFiles={1}
                          maxFileSize={10 * 1024 * 1024}
                          buttonClassName="h-9 px-3 text-sm gap-1.5 bg-background border border-input text-foreground hover:bg-muted"
                          onGetUploadParameters={async (file) => {
                            const res = await fetch("/api/uploads/request-url", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                            });
                            const { uploadURL, objectPath } = await res.json();
                            pendingUploadPathRef.current = objectPath;
                            return { method: "PUT" as const, url: uploadURL, headers: { "Content-Type": file.type || "application/octet-stream" } };
                          }}
                          onComplete={(result) => {
                            const f = result.successful?.[0];
                            if (f && pendingUploadPathRef.current) {
                              setAttachedImage({ url: pendingUploadPathRef.current, name: f.name || "image" });
                            }
                          }}
                        >
                          <ImagePlus className="w-4 h-4" /> Attach image
                        </ObjectUploader>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground" title="Video posting is coming soon">Video — coming soon</Badge>
                      </div>
                    )}
                  </div>

                  {/* Optional campaign */}
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Megaphone className="w-3 h-3" /> Campaign <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Select
                      value={campaignId || "none"}
                      onValueChange={(v) => { setCampaignId(v === "none" ? "" : v); if (v === "none") setDeliveryMode("orbit"); }}
                    >
                      <SelectTrigger className="mt-1.5" data-testid="composer-campaign">
                        <SelectValue placeholder="No campaign" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No campaign (standalone)</SelectItem>
                        {campaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Delivery — only meaningful inside a campaign */}
                {campaignId && (
                  <div>
                    <Label className="text-xs">Delivery</Label>
                    <div className="grid sm:grid-cols-2 gap-2 mt-1.5">
                      {([
                        { key: "orbit" as const, Icon: Zap, title: "Orbit posts it", desc: "Published directly to your accounts at the time you choose." },
                        { key: "csv" as const, Icon: FileDown, title: "Add to campaign batch", desc: "Held for CSV export with the campaign — Orbit won't post it." },
                      ]).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setDeliveryMode(opt.key)}
                          className={cn(
                            "text-left rounded-lg border p-3 transition-colors",
                            deliveryMode === opt.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                          )}
                          data-testid={`composer-delivery-${opt.key}`}
                          aria-pressed={deliveryMode === opt.key}
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <opt.Icon className={cn("w-4 h-4", opt.key === "orbit" ? "text-emerald-500" : "text-blue-500")} />
                            {opt.title}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-3 pt-1">
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-xs">Schedule for <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={e => setScheduledAt(e.target.value)}
                      data-testid="composer-schedule-input"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button" variant="outline"
                      onClick={() => submit("draft")}
                      disabled={submitting}
                      data-testid="composer-save-draft"
                    >
                      {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Save draft
                    </Button>
                    <Button
                      type="button" variant="outline"
                      onClick={() => submit("schedule")}
                      disabled={submitting || !scheduledAt}
                      data-testid="composer-schedule"
                    >
                      {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CalendarIcon className="w-3.5 h-3.5 mr-1" />}
                      Schedule
                    </Button>
                    {isCsv ? (
                      <Button
                        type="button"
                        onClick={() => submit("batch")}
                        disabled={submitting}
                        data-testid="composer-add-to-batch"
                      >
                        {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
                        Add to batch
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => submit("publish")}
                        disabled={submitting}
                        data-testid="composer-publish"
                      >
                        {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                        Post now
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isCsv
                    ? "Batch posts are approved and wait in the campaign for CSV export — Orbit won't publish them."
                    : "Post now publishes immediately; scheduling approves the post and Orbit publishes it at that time (account must be connected)."}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
