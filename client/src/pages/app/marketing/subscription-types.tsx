import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Tag, Shield } from "lucide-react";

interface SubscriptionType {
  id: string;
  tenantDomain: string;
  name: string;
  description: string | null;
  isTransactional: boolean;
  hubspotTypeId: string | null;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface TypeForm {
  name: string;
  description: string | null;
  isTransactional: boolean;
  hubspotTypeId: string | null;
  isEnabled: boolean;
}

const FORM_EMPTY_DESCRIPTION = "";
const FORM_EMPTY_HUBSPOT = "";

const EMPTY_FORM: TypeForm = {
  name: "",
  description: null,
  isTransactional: false,
  hubspotTypeId: null,
  isEnabled: true,
};

export default function SubscriptionTypesPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<SubscriptionType | null>(null);
  const [form, setForm] = useState<TypeForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const isDomainAdmin =
    user?.role === "Domain Admin" ||
    user?.role === "Global Admin" ||
    user?.role === "Consultant";

  const { data: types = [], isLoading } = useQuery<SubscriptionType[]>({
    queryKey: ["/api/email-subscription-types"],
    queryFn: async () => {
      const r = await fetch("/api/email-subscription-types", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TypeForm) => {
      const r = await fetch("/api/email-subscription-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to create");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-subscription-types"] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      toast({ title: "Subscription type created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TypeForm> }) => {
      const r = await fetch(`/api/email-subscription-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to update");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-subscription-types"] });
      setDialogOpen(false);
      setEditingType(null);
      setForm(EMPTY_FORM);
      toast({ title: "Subscription type updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/email-subscription-types/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-subscription-types"] });
      setDeleteId(null);
      toast({ title: "Subscription type deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingType(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(t: SubscriptionType) {
    setEditingType(t);
    setForm({
      name: t.name,
      description: t.description ?? null,
      isTransactional: t.isTransactional,
      hubspotTypeId: t.hubspotTypeId ?? null,
      isEnabled: t.isEnabled,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    const payload: TypeForm = {
      ...form,
      hubspotTypeId: form.hubspotTypeId?.trim() || null,
      description: form.description?.trim() || null,
    };
    if (editingType) {
      updateMutation.mutate({ id: editingType.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function toggleEnabled(t: SubscriptionType) {
    updateMutation.mutate({ id: t.id, data: { isEnabled: !t.isEnabled } });
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Subscription Types</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Define categories for email preferences — recipients can opt in or out per type in the preference center.
            </p>
          </div>
          {isDomainAdmin && (
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Add type
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Email subscription types
            </CardTitle>
            <CardDescription>
              Tag each email campaign with one or more types. Contacts who opt out of a type are excluded at send time.
              Transactional types (receipts, security) are never suppressed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : types.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No subscription types yet.</p>
                {isDomainAdmin && (
                  <p className="text-xs mt-1">
                    Click <strong>Add type</strong> to create your first one (e.g. "Monthly Newsletter", "Product Updates").
                  </p>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {types.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{t.name}</span>
                        {t.isTransactional && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Shield className="h-3 w-3" />
                            Transactional
                          </Badge>
                        )}
                        {!t.isEnabled && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Disabled
                          </Badge>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                      )}
                      {t.hubspotTypeId && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          HubSpot ID: <code className="font-mono">{t.hubspotTypeId}</code>
                        </p>
                      )}
                    </div>
                    {isDomainAdmin && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Switch
                          checked={t.isEnabled}
                          onCheckedChange={() => toggleEnabled(t)}
                          aria-label={t.isEnabled ? "Disable" : "Enable"}
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(t.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) { setEditingType(null); setForm(EMPTY_FORM); } }}>
          <DialogContent className="sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>{editingType ? "Edit subscription type" : "Add subscription type"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Monthly Newsletter"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={form.description ?? ""}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value || null }))}
                  placeholder="Shown in the preference center so recipients understand what they're opting out of."
                  rows={2}
                />
              </div>
              <div>
                <Label>HubSpot subscription type ID</Label>
                <Input
                  value={form.hubspotTypeId ?? ""}
                  onChange={e => setForm(f => ({ ...f, hubspotTypeId: e.target.value || null }))}
                  placeholder="Optional — syncs opt-outs to HubSpot"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Find this in HubSpot → Settings → Email → Subscription Types.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="is-transactional"
                  checked={form.isTransactional}
                  onCheckedChange={v => setForm(f => ({ ...f, isTransactional: v }))}
                />
                <div>
                  <Label htmlFor="is-transactional" className="cursor-pointer">Transactional</Label>
                  <p className="text-xs text-muted-foreground">
                    Transactional types are always delivered regardless of recipient preferences.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="is-enabled"
                  checked={form.isEnabled}
                  onCheckedChange={v => setForm(f => ({ ...f, isEnabled: v }))}
                />
                <Label htmlFor="is-enabled" className="cursor-pointer">Enabled</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={!form.name.trim() || isPending}
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingType ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <Dialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
          <DialogContent className="sm:max-w-[380px]">
            <DialogHeader>
              <DialogTitle>Delete subscription type?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              This will remove the type and all associated contact preferences. Existing sends tagged with this type will no longer enforce per-type suppression.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
