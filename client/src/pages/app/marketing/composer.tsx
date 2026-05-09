/**
 * Composer Page (Phase 3)
 *
 * Direct authoring of social posts outside a campaign. The user picks one
 * or more connected social accounts (one generated_post row per account so
 * each picks up its own voice profile), drafts content, optionally invokes
 * the shared AI Rewrite Panel, then either saves a draft, schedules for
 * later, or publishes immediately.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  PencilLine, Send, Calendar as CalendarIcon, Save, AtSign, Lock, Loader2, Hash, X,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import AIRewritePanel from "@/components/marketing/AIRewritePanel";

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

  type Action = "draft" | "schedule" | "publish";

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
            scheduledDate: action === "schedule" ? new Date(scheduledAt).toISOString() : null,
          }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Create failed");
        const post = await r.json();
        created.push({ id: post.id, accountId, platform: account.platform });

        if (action === "schedule") {
          // Approve so the worker can pick it up at scheduledDate.
          const ar = await fetch(`/api/generated-posts/${post.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ status: "approved" }),
          });
          if (!ar.ok) throw new Error((await ar.json().catch(() => ({}))).error || "Schedule failed");
        }

        if (action === "publish") {
          const ar = await fetch(`/api/generated-posts/${post.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ status: "approved" }),
          });
          if (!ar.ok) throw new Error((await ar.json().catch(() => ({}))).error || "Approve failed");
          const pr = await fetch(`/api/generated-posts/${post.id}/publish`, {
            method: "POST",
            credentials: "include",
          });
          if (!pr.ok) throw new Error((await pr.json().catch(() => ({}))).error || "Publish failed");
        }
      }

      if (action === "draft") {
        toast({ title: `Saved ${created.length} draft${created.length === 1 ? "" : "s"}` });
      } else if (action === "schedule") {
        toast({ title: `Scheduled ${created.length} post${created.length === 1 ? "" : "s"}` });
      } else {
        toast({ title: `Published ${created.length} post${created.length === 1 ? "" : "s"}` });
      }
      // Clear drafts so the user can compose another batch.
      setDrafts({});
      setHashtagInputs({});
      setSelectedAccountIds([]);
      setScheduledAt("");
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
              <CardContent className="pt-6 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-xs">Schedule for <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={e => setScheduledAt(e.target.value)}
                      data-testid="composer-schedule-input"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
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
                    <Button
                      type="button"
                      onClick={() => submit("publish")}
                      disabled={submitting}
                      data-testid="composer-publish"
                    >
                      {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                      Publish now
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Scheduled posts auto-publish when their time arrives, provided the account is connected for direct publishing.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
