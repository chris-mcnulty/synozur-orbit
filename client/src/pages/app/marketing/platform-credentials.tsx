/**
 * Platform Credentials Page
 *
 * Tenant admins register their own OAuth apps (LinkedIn / Twitter / X /
 * Facebook / Instagram) and paste the client_id + client_secret here.
 * Secrets are encrypted at rest. The page is admin-only; non-admins see
 * a 403 from the API and a friendly notice on the page.
 *
 * Bluesky is intentionally not listed: it uses per-account app passwords
 * managed on the Social Accounts page, not OAuth client credentials.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound, Lock, AlertTriangle, CheckCircle2, ExternalLink, Loader2,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CredMetadata {
  platform: string;
  isConfigured: boolean;
  hasSecret: boolean;
  clientIdPreview: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface PlatformConfig {
  key: string;
  label: string;
  description: string;
  /** True if the OAuth app must be a "confidential client" (server-side
   *  client_secret required). Twitter allows public clients without one. */
  secretRequired: boolean;
  redirectNote: string;
  helpUrl: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    secretRequired: true,
    description: "LinkedIn Developer App. Required scopes: openid, profile, email, w_member_social, w_organization_social, rw_organization_admin.",
    redirectNote: "Add your tenant's `…/api/social-accounts/oauth/callback` URL as an authorized redirect URL on the LinkedIn app.",
    helpUrl: "https://www.linkedin.com/developers/apps",
  },
  {
    key: "twitter",
    label: "X / Twitter",
    secretRequired: false,
    description: "X Developer App with OAuth 2.0 + PKCE. Required scopes: tweet.read, tweet.write, users.read, offline.access. The client_secret is only required for confidential apps.",
    redirectNote: "Add your tenant's `…/api/social-accounts/oauth/callback` URL as a Callback URI on the X app.",
    helpUrl: "https://developer.twitter.com/en/portal/dashboard",
  },
  {
    key: "facebook",
    label: "Facebook (Pages)",
    secretRequired: true,
    description: "Meta Facebook App. Required products: Facebook Login. Required permissions (App Review): pages_show_list, pages_read_engagement, pages_manage_posts.",
    redirectNote: "Add your tenant's `…/api/social-accounts/oauth/callback` URL as a Valid OAuth Redirect URI in the Facebook Login product settings.",
    helpUrl: "https://developers.facebook.com/apps/",
  },
  {
    key: "instagram",
    label: "Instagram",
    secretRequired: true,
    description: "Same Meta app as Facebook. Required permissions (App Review) add: instagram_basic, instagram_content_publish. The IG account must be Business/Creator and linked to a Page.",
    redirectNote: "Use the same Meta app as Facebook. Ensure Instagram is added as a product on the app.",
    helpUrl: "https://developers.facebook.com/docs/instagram-api/getting-started",
  },
];

export default function PlatformCredentialsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PlatformConfig | null>(null);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  // Platform credentials APIs are gated by directPublishing on the backend
  // (and additionally restricted to tenant admins). Match the feature gate
  // here so we don't render the page just to surface a 403; the admin check
  // still happens via the API response, which sets isAdminForbidden below.
  const isAllowed = tenantInfo?.features?.directPublishing === true;

  const { data, isLoading, error } = useQuery<{ items: CredMetadata[] }, { status?: number; message?: string }>({
    queryKey: ["/api/tenant/platform-credentials"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/platform-credentials", { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const e = new Error(body.error || `HTTP ${r.status}`) as any;
        e.status = r.status;
        throw e;
      }
      return r.json();
    },
    enabled: isAllowed,
    retry: false,
  });

  const items = data?.items ?? [];
  const isAdminForbidden = (error as any)?.status === 403;

  const deleteMutation = useMutation({
    mutationFn: async (platform: string) => {
      const r = await fetch(`/api/tenant/platform-credentials/${platform}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/platform-credentials"] });
      toast({ title: "Credentials removed" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Platform Credentials</CardTitle>
              <CardDescription>Available on the Enterprise plan. Register your own OAuth apps for direct social publishing.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Platform Credentials">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (isAdminForbidden) {
    return (
      <AppLayout>
        <div className="p-6 max-w-3xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lock className="w-5 h-5" /> Admins only</CardTitle>
              <CardDescription>
                Only a tenant admin can manage platform OAuth credentials. Ask a Domain Admin in your tenant to configure them.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="w-6 h-6" /> Platform Credentials
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Each platform requires your tenant to register its own OAuth app. Paste the client_id and (when applicable) client_secret below — they're encrypted at rest.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why per-tenant?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Multi-tenant deployments don't share a single SaaS-vendor OAuth app. Each tenant brings its own so the consent screen carries your brand, your rate-limit budget is independent, and your platform review state is yours alone.
            </p>
            <p>
              Bluesky doesn't appear here — it uses per-account app passwords entered on the{" "}
              <Link href="/app/marketing/social-accounts" className="text-primary underline">Social Accounts</Link> page.
            </p>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="grid gap-3">
            {PLATFORMS.map(platform => {
              const meta = items.find(i => i.platform === platform.key);
              const configured = meta?.isConfigured ?? false;
              return (
                <Card key={platform.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base flex items-center gap-2">
                          {platform.label}
                          {configured ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <CheckCircle2 className="w-3 h-3 text-green-600" /> Configured
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <AlertTriangle className="w-3 h-3 text-amber-600" /> Not configured
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">{platform.description}</CardDescription>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          asChild variant="ghost" size="sm" className="text-xs h-7"
                        >
                          <a href={platform.helpUrl} target="_blank" rel="noopener noreferrer" data-testid={`creds-help-${platform.key}`}>
                            <ExternalLink className="w-3 h-3 mr-1" /> Console
                          </a>
                        </Button>
                        <Button
                          size="sm" className="text-xs h-7"
                          onClick={() => setEditing(platform)}
                          data-testid={`creds-edit-${platform.key}`}
                        >
                          {configured ? "Update" : "Configure"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {configured && (
                    <CardContent className="text-xs text-muted-foreground space-y-1">
                      <div>Client ID: <span className="font-mono">{meta?.clientIdPreview ?? "—"}</span></div>
                      <div>Secret: {meta?.hasSecret ? "stored (encrypted)" : "(not stored — public client)"}</div>
                      {meta?.notes && <div>Notes: {meta.notes}</div>}
                      {meta?.updatedAt && (
                        <div>Last updated: {new Date(meta.updatedAt).toLocaleDateString()}</div>
                      )}
                      <div className="pt-2">
                        <Button
                          variant="ghost" size="sm" className="text-xs h-6 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Remove ${platform.label} credentials? Connected social accounts won't be able to publish or refresh tokens until new credentials are configured.`)) {
                              deleteMutation.mutate(platform.key);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          data-testid={`creds-delete-${platform.key}`}
                        >
                          Remove credentials
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <CredentialEditDialog
          platform={editing}
          existingMeta={items.find(i => i.platform === editing.key)}
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
        />
      )}
    </AppLayout>
  );
}

function CredentialEditDialog({
  platform, existingMeta, open, onOpenChange,
}: {
  platform: PlatformConfig;
  existingMeta?: CredMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [notes, setNotes] = useState(existingMeta?.notes ?? "");
  const [secretMode, setSecretMode] = useState<"keep" | "replace" | "clear">(
    existingMeta?.hasSecret ? "keep" : "replace",
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        clientId: clientId.trim(),
        notes: notes.trim() || null,
      };
      // Tri-state for clientSecret:
      //  - keep   → omit, server preserves existing
      //  - replace → send the new value
      //  - clear  → send null to wipe
      if (secretMode === "replace") body.clientSecret = clientSecret.trim();
      else if (secretMode === "clear") body.clientSecret = null;

      const r = await fetch(`/api/tenant/platform-credentials/${platform.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/platform-credentials"] });
      toast({ title: `${platform.label} credentials saved` });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = clientId.trim().length > 0
    && (
      (secretMode !== "replace") ||
      !platform.secretRequired ||
      clientSecret.trim().length > 0
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existingMeta?.isConfigured ? "Update" : "Configure"} {platform.label} credentials</DialogTitle>
          <DialogDescription className="text-xs">{platform.redirectNote}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Client ID</Label>
            <Input
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              placeholder={existingMeta?.clientIdPreview ?? "abc123…"}
              data-testid={`creds-input-client-id-${platform.key}`}
            />
            {existingMeta?.isConfigured && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Currently stored: {existingMeta.clientIdPreview}. Saving with a new value replaces it.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">
              Client Secret {platform.secretRequired ? "" : <span className="text-muted-foreground font-normal">(public clients can omit)</span>}
            </Label>
            {existingMeta?.hasSecret && (
              <div className="flex gap-2 mt-1 mb-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSecretMode("keep")}
                  className={`px-2 py-1 rounded border ${secretMode === "keep" ? "bg-muted" : ""}`}
                  data-testid={`creds-secret-keep-${platform.key}`}
                >
                  Keep existing
                </button>
                <button
                  type="button"
                  onClick={() => setSecretMode("replace")}
                  className={`px-2 py-1 rounded border ${secretMode === "replace" ? "bg-muted" : ""}`}
                  data-testid={`creds-secret-replace-${platform.key}`}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setSecretMode("clear")}
                  className={`px-2 py-1 rounded border ${secretMode === "clear" ? "bg-muted" : ""}`}
                  data-testid={`creds-secret-clear-${platform.key}`}
                >
                  Clear
                </button>
              </div>
            )}
            {secretMode === "replace" && (
              <Input
                type="password"
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                placeholder="paste secret"
                data-testid={`creds-input-client-secret-${platform.key}`}
              />
            )}
          </div>

          <div>
            <Label className="text-xs">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g., 'Production app — review approved 2026-01'"
              className="text-xs"
              data-testid={`creds-input-notes-${platform.key}`}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} data-testid={`creds-cancel-${platform.key}`}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => saveMutation.mutate()}
              disabled={!canSubmit || saveMutation.isPending}
              data-testid={`creds-save-${platform.key}`}
            >
              {saveMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving...</> : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
