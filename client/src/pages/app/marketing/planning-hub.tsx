import { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Layers, Plus, Link2, Loader2, ExternalLink, Sparkles,
} from "lucide-react";
import {
  type HubResponse, type Scope, type ItemType, type Stage,
  RollupStat, HubItemsList, AttachDialog, CreateActionDialog,
  STAGE_META, STAGE_ORDER,
} from "./hub-components";

interface ScopesResponse {
  campaigns: { id: string; name: string; status: string }[];
  themes: { id: string; name: string; color: string | null }[];
}

export default function PlanningHubPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = new URLSearchParams(search);
  const scopeParam = params.get("scope");
  const id = params.get("id") || "";

  // Redirect campaign scope URLs to the campaign detail Hub tab
  useEffect(() => {
    if (scopeParam === "campaign" && id) {
      navigate(`/app/marketing/campaigns/${id}#hub`, { replace: true });
    }
  }, [scopeParam, id, navigate]);

  const scope: Scope = "theme";

  const setScopeParam = (newId: string) => {
    navigate(`/app/marketing/planning-hub?scope=theme&id=${newId}`);
  };

  const { data: scopes, isLoading: scopesLoading } = useQuery<ScopesResponse>({
    queryKey: ["/api/planning-hub/scopes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/planning-hub/scopes");
      return res.json();
    },
  });

  // Auto-select the first theme if none chosen.
  useEffect(() => {
    if (id || !scopes) return;
    if (scopes.themes.length > 0) setScopeParam(scopes.themes[0].id);
  }, [scopes, id]);

  const { data: hub, isLoading: hubLoading } = useQuery<HubResponse>({
    queryKey: ["/api/planning-hub", scope, id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/planning-hub?scope=${scope}&id=${id}`);
      return res.json();
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/planning-hub", scope, id] });
    queryClient.invalidateQueries({ queryKey: ["/api/planning-hub/available", scope, id] });
  };

  // ── Detach ──
  const detachMutation = useMutation({
    mutationFn: async (item: { type: ItemType; id: string }) => {
      const res = await apiRequest("POST", "/api/planning-hub/detach", { scope, id, items: [item] });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Removed", description: "Item detached from this plan." });
      refresh();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const [attachOpen, setAttachOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeCreateOpen, setScopeCreateOpen] = useState(false);

  const scopeList = scopes?.themes ?? [];

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="page-header-gradient-bar rounded-lg p-6 bg-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-planning-hub-title">
                <Layers className="w-6 h-6" /> Themes Hub
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                One place to see and plan every piece of marketing for a solution-area theme.
              </p>
            </div>
          </div>

          {/* Theme picker */}
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <Select value={id} onValueChange={(v) => setScopeParam(v)}>
              <SelectTrigger className="w-72" data-testid="select-scope-target">
                <SelectValue placeholder={scopesLoading ? "Loading..." : "Select a theme"} />
              </SelectTrigger>
              <SelectContent>
                {scopeList.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No themes yet
                  </div>
                ) : scopeList.map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`option-scope-${s.id}`}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setScopeCreateOpen(true)} data-testid="button-create-scope">
              <Plus className="w-3.5 h-3.5" /> New Theme
            </Button>
          </div>
        </div>

        {!id ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="empty-no-scope">
              Select a theme above to start planning.
            </CardContent>
          </Card>
        ) : hubLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : hub ? (
          <>
            {/* Scope summary + rollup */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2" data-testid="text-scope-name">
                      <Layers className="w-5 h-5" />
                      {hub.name}
                    </CardTitle>
                    {hub.description && (
                      <CardDescription className="mt-1">{hub.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild className="gap-1.5">
                      <Link href="/app/marketing/solution-areas" data-testid="link-open-themes">
                        <ExternalLink className="w-3.5 h-3.5" /> Manage Themes
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <RollupStat label="Total" value={hub.rollup.total} testId="rollup-total" highlight />
                  {STAGE_ORDER.map((st) => (
                    <RollupStat
                      key={st}
                      label={STAGE_META[st].label}
                      value={hub.rollup.byStage[st]}
                      testId={`rollup-stage-${st}`}
                    />
                  ))}
                  <RollupStat label="Types" value={Object.values(hub.rollup.byType).filter((n) => n > 0).length} testId="rollup-types" />
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button onClick={() => setAttachOpen(true)} variant="outline" className="gap-1.5" data-testid="button-attach-items">
                <Link2 className="w-4 h-4" /> Attach Existing
              </Button>
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5" data-testid="button-create-action">
                <Plus className="w-4 h-4" /> New Action
              </Button>
            </div>

            {/* Items grouped by type */}
            <HubItemsList
              hub={hub}
              scope={scope}
              id={id}
              onDetach={(item) => detachMutation.mutate(item)}
              detachPending={detachMutation.isPending}
            />
          </>
        ) : null}
      </div>

      {id && (
        <>
          <AttachDialog open={attachOpen} onOpenChange={setAttachOpen} scope={scope} id={id} onDone={refresh} />
          <CreateActionDialog open={createOpen} onOpenChange={setCreateOpen} scope={scope} id={id} onDone={refresh} />
        </>
      )}
      <CreateThemeDialog
        open={scopeCreateOpen}
        onOpenChange={setScopeCreateOpen}
        onCreated={(newId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/planning-hub/scopes"] });
          setScopeParam(newId);
        }}
      />
    </AppLayout>
  );
}

function CreateThemeDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => { if (!open) { setName(""); setDescription(""); } }, [open]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/solution-areas", { name, description: description || undefined });
      return res.json();
    },
    onSuccess: (row: any) => {
      toast({ title: "Created", description: "Theme created." });
      onOpenChange(false);
      if (row?.id) onCreated(row.id);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Theme</DialogTitle>
          <DialogDescription>
            Create a theme and start planning right away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cloud Security" data-testid="input-scope-name" />
          </div>
          <div>
            <Label className="mb-1.5 block">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-scope-description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-scope">Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} data-testid="button-confirm-scope">
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
