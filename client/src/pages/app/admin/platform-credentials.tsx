/**
 * Global Platform Credentials (Global Admin only)
 *
 * Synozur owns ONE OAuth app per social platform (the Buffer/Hootsuite model).
 * A Global Admin registers each app once here; every tenant then connects
 * accounts one-click from the Social Accounts page and never sees or enters
 * these credentials. Secrets are encrypted at rest.
 *
 * Platforms shown:
 *   - X / Twitter — its own app
 *   - Meta (Facebook + Instagram) — one Meta app powers both
 * LinkedIn is configured via the shared Synozur app env vars and is not listed.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  KeyRound, AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldCheck, ShieldOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CredMetadata {
  platform: string;
  isConfigured: boolean;
  hasSecret: boolean;
  directPublishEnabled: boolean;
  clientIdPreview: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface PlatformConfig {
  key: string;
  label: string;
  description: string;
  /** True if a confidential client (server-side client_secret) is required. */
  secretRequired: boolean;
  redirectNote: string;
  helpUrl: string;
}

// The OAuth callback lives on whatever origin the app is served from. Derive it
// at runtime so the help text is correct in dev / staging / custom domains
// instead of hard-coding production. (Register the prod URL too on the live app.)
const OAUTH_CALLBACK_URL =
  `${typeof window !== "undefined" ? window.location.origin : "https://orbit.synozur.com"}/api/social-accounts/oauth/callback`;

const PLATFORMS: PlatformConfig[] = [
  {
    key: "twitter",
    label: "X / Twitter",
    secretRequired: false,
    description: "X Developer App with OAuth 2.0 + PKCE. Scopes: tweet.read, tweet.write, users.read, offline.access. client_secret is only needed for confidential apps.",
    redirectNote: `Register \`${OAUTH_CALLBACK_URL}\` as a Callback URI on the X app.`,
    helpUrl: "https://developer.twitter.com/en/portal/dashboard",
  },
  {
    key: "facebook",
    label: "Meta (Facebook + Instagram)",
    secretRequired: true,
    description: "One Meta app powers both Facebook Pages and Instagram. Products: Facebook Login + Instagram. App Review permissions: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish.",
    redirectNote: `Register \`${OAUTH_CALLBACK_URL}\` as a Valid OAuth Redirect URI in Facebook Login settings.`,
    helpUrl: "https://developers.facebook.com/apps/",
  },
];

export default function GlobalPlatformCredentialsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PlatformConfig | null>(null);

  const { data, isLoading } = useQuery<{ items: CredMetadata[] }>({
    queryKey: ["/api/admin/platform-credentials"],
    queryFn: async () => {
      const r = await fetch("/api/admin/platform-credentials", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const items = data?.items ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (platform: string) => {
      const r = await fetch(`/api/admin/platform-credentials/${platform}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-credentials"] });
      toast({ title: "Credentials removed" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="page-global-platform-credentials">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <KeyRound className="w-6 h-6" /> Platform Credentials
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Synozur-owned OAuth apps for direct social publishing. Configured once here; every tenant connects accounts one-click and never registers their own app.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">How this works</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            One shared app per platform (the Buffer / Hootsuite model). Tenants click Connect on the Social Accounts page, log into their own account, and a per-account token is stored for that tenant only. The shared app's client_id / client_secret never leave this page.
          </p>
          <p>
            Posting scopes on Meta and X require platform app review. Keep <strong>Direct publishing</strong> off until each app is approved, then flip it on — no redeploy.
          </p>
          <p>
            <strong>Meta</strong> powers both Facebook and Instagram from one app. <strong>LinkedIn</strong> uses its own shared Synozur app and isn't listed here.
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
            const live = meta?.directPublishEnabled ?? false;
            return (
              <Card key={platform.key}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
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
                        {configured && (
                          live ? (
                            <Badge className="gap-1 text-[10px] bg-green-600">
                              <ShieldCheck className="w-3 h-3" /> Direct publishing on
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <ShieldOff className="w-3 h-3" /> Publishing off
                            </Badge>
                          )
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">{platform.description}</CardDescription>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button asChild variant="ghost" size="sm" className="text-xs h-7">
                        <a href={platform.helpUrl} target="_blank" rel="noopener noreferrer" data-testid={`creds-help-${platform.key}`}>
                          <ExternalLink className="w-3 h-3 mr-1" /> Console
                        </a>
                      </Button>
                      <Button size="sm" className="text-xs h-7" onClick={() => setEditing(platform)} data-testid={`creds-edit-${platform.key}`}>
                        {configured ? "Update" : "Configure"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {configured && (
                  <CardContent className="text-xs text-muted-foreground space-y-2">
                    <div>Client ID: <span className="font-mono">{meta?.clientIdPreview ?? "—"}</span></div>
                    <div>Secret: {meta?.hasSecret ? "stored (encrypted)" : "(not stored — public client)"}</div>
                    {meta?.notes && <div>Notes: {meta.notes}</div>}
                    {meta?.updatedAt && <div>Last updated: {new Date(meta.updatedAt).toLocaleDateString()}</div>}
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        checked={live}
                        onCheckedChange={(checked) => {
                          if (!meta) return;
                          // The PUT endpoint requires a clientId; toggling the
                          // live switch alone isn't possible without re-entering
                          // it, so route the admin through the edit dialog where
                          // both fields are present.
                          setEditing(platform);
                          toast({
                            title: checked ? "Turn on direct publishing" : "Turn off direct publishing",
                            description: "Confirm in the dialog and save.",
                          });
                        }}
                        data-testid={`creds-toggle-${platform.key}`}
                      />
                      <span>Direct publishing {live ? "enabled" : "disabled"}</span>
                    </div>
                    <div className="pt-1">
                      <Button
                        variant="ghost" size="sm" className="text-xs h-6 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Remove ${platform.label} credentials? Tenants won't be able to connect or publish to ${platform.label} until they're reconfigured.`)) {
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

      {editing && (
        <CredentialEditDialog
          platform={editing}
          existingMeta={items.find(i => i.platform === editing.key)}
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
        />
      )}
    </div>
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
  const [directPublishEnabled, setDirectPublishEnabled] = useState(existingMeta?.directPublishEnabled ?? false);
  const [secretMode, setSecretMode] = useState<"keep" | "replace" | "clear">(
    existingMeta?.hasSecret ? "keep" : "replace",
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        clientId: clientId.trim(),
        notes: notes.trim() || null,
        directPublishEnabled,
      };
      if (secretMode === "replace") body.clientSecret = clientSecret.trim();
      else if (secretMode === "clear") body.clientSecret = null;

      const r = await fetch(`/api/admin/platform-credentials/${platform.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-credentials"] });
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
          <DialogTitle>{existingMeta?.isConfigured ? "Update" : "Configure"} {platform.label}</DialogTitle>
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
                Currently stored: {existingMeta.clientIdPreview}. Re-enter the full client_id to save changes.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">
              Client Secret {platform.secretRequired ? "" : <span className="text-muted-foreground font-normal">(public clients can omit)</span>}
            </Label>
            {existingMeta?.hasSecret && (
              <div className="flex gap-2 mt-1 mb-2 text-xs">
                {(["keep", "replace", "clear"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSecretMode(mode)}
                    className={`px-2 py-1 rounded border ${secretMode === mode ? "bg-muted" : ""}`}
                    data-testid={`creds-secret-${mode}-${platform.key}`}
                  >
                    {mode === "keep" ? "Keep existing" : mode === "replace" ? "Replace" : "Clear"}
                  </button>
                ))}
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
              placeholder="e.g., 'Production app — Meta review approved 2026-06'"
              className="text-xs"
              data-testid={`creds-input-notes-${platform.key}`}
            />
          </div>

          <div className="flex items-center gap-2 rounded border p-3">
            <Switch
              checked={directPublishEnabled}
              onCheckedChange={setDirectPublishEnabled}
              data-testid={`creds-dialog-toggle-${platform.key}`}
            />
            <div className="text-xs">
              <div className="font-medium">Direct publishing</div>
              <div className="text-muted-foreground">Turn on only after {platform.label} approves the shared app's posting scopes.</div>
            </div>
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
