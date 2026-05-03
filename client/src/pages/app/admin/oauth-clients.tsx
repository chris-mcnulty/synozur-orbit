import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Copy, Trash2, RefreshCw, ShieldOff, Key, Plus } from "lucide-react";

type OauthClient = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  status: string;
  createdAt: string;
};

type ScopeOption = { scope: string; label: string };

type Token = {
  id: string;
  clientId: string;
  clientName: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  tenantDomain: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type AuditRow = {
  id: string;
  clientId: string | null;
  userId: string | null;
  route: string;
  method: string;
  status: number;
  scope: string | null;
  createdAt: string;
};

export default function OAuthClientsAdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const clientsQ = useQuery<OauthClient[]>({ queryKey: ["/api/admin/oauth/clients"] });
  const scopesQ = useQuery<ScopeOption[]>({ queryKey: ["/api/admin/oauth/scopes"] });
  const tokensQ = useQuery<Token[]>({ queryKey: ["/api/admin/oauth/tokens"] });
  const auditQ = useQuery<AuditRow[]>({ queryKey: ["/api/admin/oauth/audit"] });

  const [createOpen, setCreateOpen] = useState(false);
  const [secretReveal, setSecretReveal] = useState<{ id: string; secret: string } | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    logoUrl: "",
    contactEmail: "",
    redirectUris: "",
    isConfidential: false,
    selectedScopes: [] as string[],
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        contactEmail: form.contactEmail || undefined,
        redirectUris: form.redirectUris.split(/\s+/).filter(Boolean),
        allowedScopes: form.selectedScopes,
        isConfidential: form.isConfidential,
      };
      const res = await apiRequest("POST", "/api/admin/oauth/clients", body);
      return res.json();
    },
    onSuccess: (data: OauthClient & { clientSecret?: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/oauth/clients"] });
      setCreateOpen(false);
      if (data?.clientSecret) {
        setSecretReveal({ id: data.id, secret: data.clientSecret });
      }
      setForm({ name: "", description: "", logoUrl: "", contactEmail: "", redirectUris: "", isConfidential: false, selectedScopes: [] });
      toast({ title: "Client created" });
    },
    onError: (err: Error) => toast({ title: "Failed to create", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/oauth/clients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/oauth/clients"] });
      toast({ title: "Client deleted" });
    },
  });

  const rotateMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/oauth/clients/${id}/rotate-secret`);
      return res.json();
    },
    onSuccess: (data: { id: string; clientSecret: string }) => {
      setSecretReveal({ id: data.id, secret: data.clientSecret });
      toast({ title: "Secret rotated" });
    },
  });

  const toggleStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/admin/oauth/clients/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/oauth/clients"] }),
  });

  const revokeTokenMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/oauth/tokens/${id}/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/oauth/tokens"] });
      toast({ title: "Token revoked" });
    },
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-oauth-admin">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">OAuth & Partner API</h1>
          <p className="text-muted-foreground">Manage third-party developer apps and access tokens.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-client"><Plus className="w-4 h-4 mr-2" />New client app</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Register OAuth client</DialogTitle>
              <DialogDescription>Create a developer app that can request tokens via Authorization Code + PKCE.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input data-testid="input-client-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea data-testid="input-client-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <Label>Logo URL</Label>
                <Input data-testid="input-client-logo" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />
              </div>
              <div>
                <Label>Contact email</Label>
                <Input data-testid="input-client-email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </div>
              <div>
                <Label>Redirect URIs (whitespace separated)</Label>
                <Textarea data-testid="input-client-redirects" value={form.redirectUris} onChange={(e) => setForm({ ...form, redirectUris: e.target.value })} placeholder="https://galaxy.example.com/oauth/callback" />
              </div>
              <div>
                <Label>Scopes</Label>
                <div className="grid grid-cols-1 gap-1 max-h-48 overflow-auto border rounded p-2">
                  {(scopesQ.data || []).map((s) => (
                    <label key={s.scope} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        data-testid={`checkbox-scope-${s.scope}`}
                        checked={form.selectedScopes.includes(s.scope)}
                        onCheckedChange={(checked) => {
                          setForm({
                            ...form,
                            selectedScopes: checked
                              ? [...form.selectedScopes, s.scope]
                              : form.selectedScopes.filter((x) => x !== s.scope),
                          });
                        }}
                      />
                      <span><code className="text-xs">{s.scope}</code> — {s.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox data-testid="checkbox-confidential" checked={form.isConfidential} onCheckedChange={(c) => setForm({ ...form, isConfidential: !!c })} />
                <span>Confidential client (issue a client secret)</span>
              </label>
              <Button data-testid="button-create-client" onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name || form.selectedScopes.length === 0}>
                {createMut.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {secretReveal && (
        <Card className="border-amber-500" data-testid="card-secret-reveal">
          <CardHeader>
            <CardTitle>Save your client secret</CardTitle>
            <CardDescription>This will only be shown once. Store it in a secure location.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <code className="bg-muted px-2 py-1 rounded font-mono text-xs flex-1 break-all" data-testid="text-secret">{secretReveal.secret}</code>
            <Button variant="outline" size="sm" onClick={() => copy(secretReveal.secret)} data-testid="button-copy-secret"><Copy className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setSecretReveal(null)} data-testid="button-dismiss-secret">Dismiss</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Registered apps</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(clientsQ.data || []).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-empty-clients">No clients registered yet.</p>
          ) : (
            (clientsQ.data || []).map((c) => (
              <div key={c.id} className="border rounded p-3 flex items-start justify-between gap-3" data-testid={`row-client-${c.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium" data-testid={`text-client-name-${c.id}`}>{c.name}</span>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
                  </div>
                  {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                  <div className="text-xs text-muted-foreground mt-1">
                    <div>client_id: <code>{c.id}</code></div>
                    <div>redirect: {c.redirectUris.join(", ")}</div>
                    <div>scopes: {c.allowedScopes.join(", ")}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Button size="sm" variant="outline" onClick={() => copy(c.id)} data-testid={`button-copy-id-${c.id}`}><Copy className="w-3 h-3 mr-1" />ID</Button>
                  <Button size="sm" variant="outline" onClick={() => rotateMut.mutate(c.id)} data-testid={`button-rotate-${c.id}`}><Key className="w-3 h-3 mr-1" />Rotate</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleStatusMut.mutate({ id: c.id, status: c.status === "active" ? "disabled" : "active" })} data-testid={`button-toggle-${c.id}`}>
                    <ShieldOff className="w-3 h-3 mr-1" />{c.status === "active" ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(c.id)} data-testid={`button-delete-${c.id}`}><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active access tokens</CardTitle></CardHeader>
        <CardContent>
          {(tokensQ.data || []).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-empty-tokens">No tokens issued.</p>
          ) : (
            <div className="space-y-2">
              {(tokensQ.data || []).map((t) => (
                <div key={t.id} className="flex items-center justify-between border rounded p-2 text-sm" data-testid={`row-token-${t.id}`}>
                  <div>
                    <div><strong>{t.clientName}</strong> — {t.userEmail || t.userId}</div>
                    <div className="text-xs text-muted-foreground">scopes: {t.scopes.join(", ")} • expires {new Date(t.expiresAt).toLocaleString()}</div>
                  </div>
                  <div>
                    {t.revokedAt ? (
                      <Badge variant="secondary">revoked</Badge>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => revokeTokenMut.mutate(t.id)} data-testid={`button-revoke-${t.id}`}>Revoke</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent API calls</CardTitle></CardHeader>
        <CardContent>
          {(auditQ.data || []).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-empty-audit">No partner API activity yet.</p>
          ) : (
            <div className="space-y-1 text-sm font-mono">
              {(auditQ.data || []).slice(0, 50).map((a) => (
                <div key={a.id} data-testid={`row-audit-${a.id}`}>
                  <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>{" "}
                  <Badge variant={a.status >= 400 ? "destructive" : "default"}>{a.status}</Badge>{" "}
                  {a.method} {a.route} {a.scope ? <span className="text-xs">[{a.scope}]</span> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
