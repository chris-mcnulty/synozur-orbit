import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HardDrive,
  Plus,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Database,
  FileText,
  Search,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { useToast } from "@/hooks/use-toast";

interface TenantSpeInfo {
  id: string;
  domain: string;
  name: string | null;
  plan: string;
  status: string;
  speStorageEnabled: boolean;
  hasContainer: boolean;
  containerId: string | null;
  entraTenantId: string | null;
}

interface SpeStatus {
  configured: boolean;
  message?: string;
  containerId?: string;
  displayName?: string;
  status?: string;
  success?: boolean;
  error?: string;
}

interface StorageStats {
  totalFiles?: number;
  totalSizeBytes?: number;
  folderCount?: number;
  error?: string;
}

interface OrphanReport {
  totalOrphans?: number;
  orphanedFiles?: Array<{ id: string; name: string; size: number }>;
  error?: string;
}

export default function SpeStoragePage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isGlobalAdmin = user?.role === "Global Admin";

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    containerName: "",
    description: "",
    tenantId: "",
  });
  const [showOrphansDialog, setShowOrphansDialog] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<SpeStatus>({
    queryKey: ["/api/admin/spe/status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/spe/status", { credentials: "include" });
      return res.json();
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery<StorageStats>({
    queryKey: ["/api/admin/spe/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/spe/stats", { credentials: "include" });
      return res.json();
    },
    enabled: !!status?.configured,
  });

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery<TenantSpeInfo[]>({
    queryKey: ["/api/admin/spe/tenants"],
    queryFn: async () => {
      const res = await fetch("/api/admin/spe/tenants", { credentials: "include" });
      return res.json();
    },
    enabled: isGlobalAdmin,
  });

  const { data: orphanReport } = useQuery<OrphanReport>({
    queryKey: ["/api/admin/spe/orphans"],
    queryFn: async () => {
      const res = await fetch("/api/admin/spe/orphans", { credentials: "include" });
      return res.json();
    },
    enabled: !!status?.configured,
  });

  const createContainerMutation = useMutation({
    mutationFn: async (data: { containerName: string; description: string; tenantId?: string }) => {
      const res = await fetch("/api/admin/spe/container", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create container");
      if (!result.success) throw new Error(result.message || "Container creation failed");
      return result;
    },
    onSuccess: (result) => {
      toast({ title: "Container Created", description: result.message });
      setShowCreateDialog(false);
      setCreateForm({ containerName: "", description: "", tenantId: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spe/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spe/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spe/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Creation Failed", description: err.message, variant: "destructive" });
    },
  });

  const scanOrphansMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/spe/orphans/scan", {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spe/orphans"] });
    },
  });

  const cleanupOrphansMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await fetch("/api/admin/spe/orphans/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun, maxDelete: 50 }),
      });
      return res.json();
    },
    onSuccess: (result, dryRun) => {
      if (dryRun) {
        toast({ title: "Dry Run Complete", description: `Found ${result.deletedCount || 0} orphaned files that would be removed.` });
      } else {
        toast({ title: "Cleanup Complete", description: `Removed ${result.deletedCount || 0} orphaned files.` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/spe/orphans"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/spe/stats"] });
      }
    },
  });

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const containerTypeConfigured = !!process.env.ORBIT_SPE_CONTAINER_TYPE_ID;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="page-header-gradient-bar rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-spe-title">SharePoint Embedded Storage</h1>
              <p className="text-muted-foreground mt-1">
                Manage document storage containers for tenant isolation
              </p>
            </div>
            <Button
              onClick={() => setShowCreateDialog(true)}
              data-testid="button-create-container"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Container
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Container Status</CardTitle>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : status?.configured ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-lg font-semibold" data-testid="text-container-status">Active</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="text-lg font-semibold" data-testid="text-container-status">Not Configured</span>
                </div>
              )}
              {status?.displayName && (
                <p className="text-sm text-muted-foreground mt-1">{status.displayName}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Files Stored</CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : stats?.totalFiles != null ? (
                <div>
                  <span className="text-lg font-semibold" data-testid="text-file-count">{stats.totalFiles}</span>
                  <p className="text-sm text-muted-foreground mt-1">
                    {stats.totalSizeBytes ? formatBytes(stats.totalSizeBytes) : "0 B"} total
                  </p>
                </div>
              ) : (
                <span className="text-muted-foreground" data-testid="text-file-count">--</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Orphaned Files</CardTitle>
            </CardHeader>
            <CardContent>
              {orphanReport?.totalOrphans != null ? (
                <div className="flex items-center gap-2">
                  {orphanReport.totalOrphans > 0 ? (
                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  <span className="text-lg font-semibold" data-testid="text-orphan-count">{orphanReport.totalOrphans}</span>
                  {orphanReport.totalOrphans > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowOrphansDialog(true)}
                      data-testid="button-view-orphans"
                    >
                      View
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground" data-testid="text-orphan-count">--</span>
              )}
            </CardContent>
          </Card>
        </div>

        {status?.configured && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Your Container Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Container ID</span>
                  <p className="font-mono text-xs mt-1" data-testid="text-container-id">{status.containerId || "--"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Display Name</span>
                  <p className="mt-1" data-testid="text-container-name">{status.displayName || "--"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="mt-1">
                    <Badge variant={status.status === "active" ? "default" : "secondary"}>
                      {status.status || "unknown"}
                    </Badge>
                  </p>
                </div>
                {stats && (
                  <div>
                    <span className="text-muted-foreground">Folders</span>
                    <p className="mt-1">{stats.folderCount ?? "--"}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isGlobalAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                All Tenant Containers
              </CardTitle>
              <CardDescription>
                SPE container status for every tenant in the platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>SPE Enabled</TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Entra Tenant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenants.map((t) => (
                      <TableRow key={t.id} data-testid={`row-tenant-${t.id}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{t.name || t.domain}</p>
                            <p className="text-xs text-muted-foreground">{t.domain}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.plan}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.status === "active" ? "default" : "destructive"}>
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {t.speStorageEnabled ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          {t.hasContainer ? (
                            <span className="font-mono text-xs">{t.containerId}</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.entraTenantId ? (
                            <span className="font-mono text-xs">{t.entraTenantId.substring(0, 12)}...</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">Not set</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create SPE Container</DialogTitle>
              <DialogDescription>
                Create a new SharePoint Embedded container for document storage.
                {!isGlobalAdmin && " This will be created for your tenant."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="containerName">Container Name</Label>
                <Input
                  id="containerName"
                  placeholder="e.g. Acme Corp Documents"
                  value={createForm.containerName}
                  onChange={(e) => setCreateForm({ ...createForm, containerName: e.target.value })}
                  data-testid="input-container-name"
                />
              </div>
              <div>
                <Label htmlFor="containerDescription">Description (optional)</Label>
                <Input
                  id="containerDescription"
                  placeholder="Document storage for..."
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  data-testid="input-container-description"
                />
              </div>
              {isGlobalAdmin && tenants.length > 0 && (
                <div>
                  <Label htmlFor="tenantSelect">Tenant</Label>
                  <Select
                    value={createForm.tenantId}
                    onValueChange={(val) => setCreateForm({ ...createForm, tenantId: val })}
                  >
                    <SelectTrigger data-testid="select-tenant">
                      <SelectValue placeholder="Your tenant (default)" />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name || t.domain} ({t.domain})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Select which tenant this container is for
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  createContainerMutation.mutate({
                    containerName: createForm.containerName,
                    description: createForm.description,
                    ...(isGlobalAdmin && createForm.tenantId ? { tenantId: createForm.tenantId } : {}),
                  })
                }
                disabled={!createForm.containerName || createContainerMutation.isPending}
                data-testid="button-confirm-create"
              >
                {createContainerMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Container"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showOrphansDialog} onOpenChange={setShowOrphansDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Orphaned Files</DialogTitle>
              <DialogDescription>
                Files in SPE that are not referenced by any document record.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => scanOrphansMutation.mutate()}
                  disabled={scanOrphansMutation.isPending}
                  data-testid="button-scan-orphans"
                >
                  {scanOrphansMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Scan Now
                </Button>
                {isGlobalAdmin && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cleanupOrphansMutation.mutate(true)}
                      disabled={cleanupOrphansMutation.isPending}
                      data-testid="button-orphan-dryrun"
                    >
                      Dry Run
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => cleanupOrphansMutation.mutate(false)}
                      disabled={cleanupOrphansMutation.isPending}
                      data-testid="button-orphan-cleanup"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clean Up
                    </Button>
                  </>
                )}
              </div>
              {orphanReport?.orphanedFiles && orphanReport.orphanedFiles.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orphanReport.orphanedFiles.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {f.name}
                        </TableCell>
                        <TableCell>{formatBytes(f.size)}</TableCell>
                        <TableCell className="font-mono text-xs">{f.id.substring(0, 16)}...</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">No orphaned files found.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
