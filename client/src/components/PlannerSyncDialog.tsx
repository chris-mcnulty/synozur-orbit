import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, RefreshCw, AlertCircle, Plus } from "lucide-react";
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

interface PlannerSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketingPlanId: string;
  currentMapping?: {
    plannerGroupId?: string | null;
    plannerGroupName?: string | null;
    plannerPlanId?: string | null;
    plannerPlanName?: string | null;
    plannerBucketId?: string | null;
    plannerBucketName?: string | null;
  };
}

interface PlannerGroup { id: string; displayName: string; description?: string | null }
interface PlannerPlan { id: string; title: string }
interface PlannerBucket { id: string; name: string; planId: string }

export function PlannerSyncDialog({
  open,
  onOpenChange,
  marketingPlanId,
  currentMapping,
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

  useEffect(() => {
    if (open) {
      setGroupId(currentMapping?.plannerGroupId || "");
      setPlanId(currentMapping?.plannerPlanId || "");
      setBucketChoice(currentMapping?.plannerBucketId || "_default");
      setNewBucketName("");
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
      const res = await apiRequest("POST", `/api/marketing-plans/${marketingPlanId}/planner/connect`, {
        groupId,
        groupName: group?.displayName || "",
        planId,
        planName: plan?.title || "",
        bucketId: bucket?.id || null,
        bucketName: bucket?.name || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/marketing-plans/${marketingPlanId}`] });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Microsoft Planner Integration
          </DialogTitle>
          <DialogDescription>
            Push Orbit marketing tasks into a Microsoft Planner plan. You choose the
            target Microsoft 365 group, plan, and the bucket where Orbit tasks land.
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
              <Select value={groupId} onValueChange={(v) => { setGroupId(v); setPlanId(""); setBucketChoice("_default"); }}>
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
              <Select value={planId} onValueChange={(v) => { setPlanId(v); setBucketChoice("_default"); }} disabled={!groupId}>
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
              <Label>Bucket (where Orbit tasks land)</Label>
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
                Choose an existing bucket or create a dedicated "Orbit" bucket below.
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
                    placeholder="e.g. Orbit Marketing"
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
