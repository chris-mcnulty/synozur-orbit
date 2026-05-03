import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, AlertCircle, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CategoryMapping {
  activityCategory: string;
  bucketId: string;
  bucketName: string;
}

interface PlannerSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketingPlanId: string;
  /** Categories used by this marketing plan (for the per-category bucket UI). */
  activityCategories?: Array<{ value: string; label: string }>;
  currentMapping?: {
    plannerGroupId?: string | null;
    plannerGroupName?: string | null;
    plannerPlanId?: string | null;
    plannerPlanName?: string | null;
    plannerBucketId?: string | null;
    plannerBucketName?: string | null;
  };
  /** Existing per-category mappings for this plan (Phase 2). */
  currentCategoryMappings?: CategoryMapping[];
}

interface PlannerGroup { id: string; displayName: string; description?: string | null }
interface PlannerPlan { id: string; title: string }
interface PlannerBucket { id: string; name: string; planId: string }

export function PlannerSyncDialog({
  open,
  onOpenChange,
  marketingPlanId,
  activityCategories = [],
  currentMapping,
  currentCategoryMappings = [],
}: PlannerSyncDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [groupId, setGroupId] = useState<string>(currentMapping?.plannerGroupId || "");
  const [planId, setPlanId] = useState<string>(currentMapping?.plannerPlanId || "");
  const [bucketChoice, setBucketChoice] = useState<string>(
    currentMapping?.plannerBucketId
      ? currentMapping.plannerBucketId
      : "_default",
  );
  const [newBucketName, setNewBucketName] = useState("");
  const [creatingBucket, setCreatingBucket] = useState(false);

  // Per-category bucket overrides — keyed by activityCategory
  const [categoryBucketOverrides, setCategoryBucketOverrides] = useState<Record<string, string>>(
    () => {
      const m: Record<string, string> = {};
      for (const c of currentCategoryMappings) m[c.activityCategory] = c.bucketId;
      return m;
    },
  );

  useEffect(() => {
    if (open) {
      setGroupId(currentMapping?.plannerGroupId || "");
      setPlanId(currentMapping?.plannerPlanId || "");
      setBucketChoice(currentMapping?.plannerBucketId || "_default");
      setNewBucketName("");
      const overrides: Record<string, string> = {};
      for (const c of currentCategoryMappings) overrides[c.activityCategory] = c.bucketId;
      setCategoryBucketOverrides(overrides);
    }
  }, [open]);

  const authStatus = useQuery({
    queryKey: ["/api/planner/auth/status"],
    queryFn: async () => {
      const res = await fetch("/api/planner/auth/status", { credentials: "include" });
      if (!res.ok) return { connected: false };
      return res.json();
    },
    enabled: open,
  });

  const groups = useQuery<PlannerGroup[]>({
    queryKey: ["/api/planner/groups"],
    queryFn: async () => {
      const res = await fetch("/api/planner/groups", { credentials: "include" });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({}));
        if (body.needsConsent) return [];
        throw new Error(body.error || "Failed to load groups");
      }
      if (!res.ok) throw new Error("Failed to load groups");
      return res.json();
    },
    enabled: open && !!authStatus.data?.connected,
  });

  const plans = useQuery<PlannerPlan[]>({
    queryKey: ["/api/planner/groups", groupId, "plans"],
    queryFn: async () => {
      const res = await fetch(`/api/planner/groups/${groupId}/plans`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json();
    },
    enabled: open && !!authStatus.data?.connected && !!groupId,
  });

  const buckets = useQuery<PlannerBucket[]>({
    queryKey: ["/api/planner/plans", planId, "buckets"],
    queryFn: async () => {
      const res = await fetch(`/api/planner/plans/${planId}/buckets`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load buckets");
      return res.json();
    },
    enabled: open && !!authStatus.data?.connected && !!planId,
  });

  const startConsent = async () => {
    const res = await fetch(`/api/planner/auth/url?returnTo=${encodeURIComponent(window.location.pathname)}`, { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Could not start consent", description: body.error || "Unknown error", variant: "destructive" });
      return;
    }
    const { url } = await res.json();
    window.location.href = url;
  };

  const createBucketMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/planner/plans/${planId}/buckets`, { name: newBucketName });
      return res.json();
    },
    onSuccess: (bucket: PlannerBucket) => {
      queryClient.invalidateQueries({ queryKey: ["/api/planner/plans", planId, "buckets"] });
      setBucketChoice(bucket.id);
      setNewBucketName("");
      setCreatingBucket(false);
      toast({ title: "Bucket created", description: `Created bucket "${bucket.name}"` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create bucket", description: err.message, variant: "destructive" });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const group = groups.data?.find(g => g.id === groupId);
      const plan = plans.data?.find(p => p.id === planId);
      const bucket = bucketChoice && bucketChoice !== "_default"
        ? buckets.data?.find(b => b.id === bucketChoice)
        : null;

      const categoryMappings: CategoryMapping[] = [];
      for (const [activityCategory, bucketId] of Object.entries(categoryBucketOverrides)) {
        if (!bucketId || bucketId === "_default") continue;
        const b = buckets.data?.find(x => x.id === bucketId);
        if (!b) continue;
        categoryMappings.push({ activityCategory, bucketId: b.id, bucketName: b.name });
      }

      const res = await apiRequest("POST", `/api/marketing-plans/${marketingPlanId}/planner/connect`, {
        groupId,
        groupName: group?.displayName || "",
        planId,
        planName: plan?.title || "",
        bucketId: bucket?.id || null,
        bucketName: bucket?.name || null,
        categoryMappings,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${marketingPlanId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${marketingPlanId}/planner/status`] });
      toast({ title: "Connected to Microsoft Planner" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Connect failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/marketing-plans/${marketingPlanId}/planner/disconnect`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${marketingPlanId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${marketingPlanId}/planner/status`] });
      toast({ title: "Disconnected from Planner" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    },
  });

  const isConnected = !!currentMapping?.plannerPlanId;
  const showConsent = open && authStatus.isFetched && !authStatus.data?.connected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Microsoft Planner Integration
          </DialogTitle>
          <DialogDescription>
            Push Orbit marketing tasks into a Microsoft Planner plan. Choose the
            target Microsoft 365 group, plan, the default bucket, and optionally
            route each marketing category into its own bucket.
          </DialogDescription>
        </DialogHeader>

        {showConsent ? (
          <div className="space-y-4 py-4">
            <div className="flex gap-2 p-3 border border-border rounded-md bg-muted/30">
              <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-sm">
                Orbit needs your permission to read your Microsoft 365 groups and create
                Planner tasks on your behalf. You'll be redirected to Microsoft to grant
                consent for the <code>Tasks.ReadWrite</code> and <code>Group.Read.All</code>{" "}
                scopes.
              </div>
            </div>
            <Button onClick={startConsent} className="w-full" data-testid="button-planner-consent">
              Connect to Microsoft Planner
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {authStatus.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking Planner connection…
              </div>
            )}

            <div className="space-y-2">
              <Label>Microsoft 365 Group / Team</Label>
              <Select value={groupId} onValueChange={(v) => { setGroupId(v); setPlanId(""); setBucketChoice("_default"); setCategoryBucketOverrides({}); }}>
                <SelectTrigger data-testid="select-planner-group">
                  <SelectValue placeholder={groups.isLoading ? "Loading groups…" : "Select a group"} />
                </SelectTrigger>
                <SelectContent>
                  {(groups.data || []).map(g => (
                    <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={(v) => { setPlanId(v); setBucketChoice("_default"); setCategoryBucketOverrides({}); }} disabled={!groupId}>
                <SelectTrigger data-testid="select-planner-plan">
                  <SelectValue placeholder={!groupId ? "Pick a group first" : (plans.isLoading ? "Loading plans…" : "Select a plan")} />
                </SelectTrigger>
                <SelectContent>
                  {(plans.data || []).map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Default bucket</Label>
              <Select value={bucketChoice} onValueChange={setBucketChoice} disabled={!planId}>
                <SelectTrigger data-testid="select-planner-bucket">
                  <SelectValue placeholder={!planId ? "Pick a plan first" : (buckets.isLoading ? "Loading buckets…" : "Select a bucket")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_default">Plan default (no bucket)</SelectItem>
                  {(buckets.data || []).map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Tasks land here unless a category-specific bucket is set below.
              </p>
              {!creatingBucket ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  disabled={!planId}
                  onClick={() => setCreatingBucket(true)}
                  data-testid="button-show-create-bucket"
                >
                  <Plus className="w-3 h-3 mr-1" /> Create new bucket
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. Orbit Events"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="input-new-bucket-name"
                  />
                  <Button
                    size="sm"
                    disabled={!newBucketName.trim() || createBucketMutation.isPending}
                    onClick={() => createBucketMutation.mutate()}
                    data-testid="button-create-bucket"
                  >
                    {createBucketMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCreatingBucket(false); setNewBucketName(""); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {planId && activityCategories.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label>Per-category buckets (optional)</Label>
                  <span className="text-xs text-muted-foreground">Overrides the default for the selected category.</span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {activityCategories.map(cat => {
                    const value = categoryBucketOverrides[cat.value] || "_default";
                    return (
                      <div key={cat.value} className="flex items-center gap-2" data-testid={`row-category-bucket-${cat.value}`}>
                        <div className="flex-1 text-sm">{cat.label}</div>
                        <Select
                          value={value}
                          onValueChange={(v) => {
                            setCategoryBucketOverrides(prev => {
                              const next = { ...prev };
                              if (v === "_default") delete next[cat.value];
                              else next[cat.value] = v;
                              return next;
                            });
                          }}
                        >
                          <SelectTrigger className="w-56 h-8 text-sm" data-testid={`select-category-bucket-${cat.value}`}>
                            <SelectValue placeholder="Use default bucket" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_default">Use default bucket</SelectItem>
                            {(buckets.data || []).map(b => (
                              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {value !== "_default" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setCategoryBucketOverrides(prev => {
                              const next = { ...prev };
                              delete next[cat.value];
                              return next;
                            })}
                            data-testid={`button-clear-category-bucket-${cat.value}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {isConnected && !showConsent && (
            <Button
              variant="ghost"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="text-destructive"
              data-testid="button-planner-disconnect"
            >
              Disconnect
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!showConsent && (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={!planId || connectMutation.isPending}
              data-testid="button-planner-connect"
            >
              {connectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save mapping"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
