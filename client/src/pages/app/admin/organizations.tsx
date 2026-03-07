import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Search, RotateCcw, Trash2, AlertCircle, ArrowLeft } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { useLocation } from "wouter";
import type { Organization } from "@shared/schema";

function formatRelativeTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export default function AdminOrganizationsPage() {
  const { user: currentUser } = useUser();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState<Organization | null>(null);

  const { data: organizations = [], isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/admin/organizations"],
    queryFn: async () => {
      const response = await fetch("/api/admin/organizations?status=all", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 403) throw new Error("Access denied - Global Admin only");
        throw new Error("Failed to fetch organizations");
      }
      return response.json();
    },
    enabled: currentUser?.role === "Global Admin",
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/organizations/${id}/reactivate`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to reactivate");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/organizations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to delete");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      setDeleteDialogOpen(false);
      setOrgToDelete(null);
    },
  });

  if (currentUser?.role !== "Global Admin") {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-destructive text-lg font-medium">Access Denied</p>
          <p className="text-muted-foreground text-sm">This page is only accessible to Global Admins.</p>
        </div>
      </AppLayout>
    );
  }

  const activeOrgs = organizations.filter(o => o.status === "active");
  const archivedOrgs = organizations.filter(o => o.status === "archived");

  const filterOrgs = (orgs: Organization[]) => {
    if (!searchQuery.trim()) return orgs;
    const q = searchQuery.toLowerCase();
    return orgs.filter(o =>
      o.name.toLowerCase().includes(q) ||
      o.canonicalDomain.toLowerCase().includes(q)
    );
  };

  const filteredActive = filterOrgs(activeOrgs);
  const filteredArchived = filterOrgs(archivedOrgs);

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="admin-organizations-page">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/app/admin")}
            data-testid="button-back-admin"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Admin
          </Button>
        </div>

        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8 text-primary" />
            Organization Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage all organizations across the platform ({activeOrgs.length} active, {archivedOrgs.length} archived)
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or domain..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-organizations"
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="active" data-testid="tab-active-organizations">
              Active ({filteredActive.length})
            </TabsTrigger>
            <TabsTrigger value="archived" data-testid="tab-archived-organizations">
              Archived ({filteredArchived.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Active Organizations</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-muted-foreground text-center py-8">Loading...</p>
                ) : filteredActive.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-active-orgs">
                    {searchQuery ? "No organizations match your search." : "No active organizations."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ref Count</TableHead>
                        <TableHead>Last Crawl</TableHead>
                        <TableHead>Last Monitor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredActive.map((org) => (
                        <TableRow key={org.id} data-testid={`row-org-${org.id}`}>
                          <TableCell>
                            {org.faviconUrl ? (
                              <img
                                src={org.faviconUrl}
                                alt=""
                                className="h-5 w-5 rounded"
                                data-testid={`img-favicon-${org.id}`}
                              />
                            ) : (
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-name-${org.id}`}>
                            {org.name}
                          </TableCell>
                          <TableCell data-testid={`text-domain-${org.id}`}>
                            {org.canonicalDomain}
                          </TableCell>
                          <TableCell>
                            <Badge variant="default" data-testid={`badge-status-${org.id}`}>
                              {org.status}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-refcount-${org.id}`}>
                            {org.activeReferenceCount}
                          </TableCell>
                          <TableCell data-testid={`text-lastcrawl-${org.id}`}>
                            {formatRelativeTime(org.lastFullCrawl)}
                          </TableCell>
                          <TableCell data-testid={`text-lastmonitor-${org.id}`}>
                            {formatRelativeTime(org.lastWebsiteMonitor)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="archived">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Archived Organizations</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-muted-foreground text-center py-8">Loading...</p>
                ) : filteredArchived.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-archived-orgs">
                    {searchQuery ? "No organizations match your search." : "No archived organizations."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ref Count</TableHead>
                        <TableHead>Last Crawl</TableHead>
                        <TableHead>Last Monitor</TableHead>
                        <TableHead>Archived At</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredArchived.map((org) => (
                        <TableRow key={org.id} data-testid={`row-org-${org.id}`}>
                          <TableCell>
                            {org.faviconUrl ? (
                              <img
                                src={org.faviconUrl}
                                alt=""
                                className="h-5 w-5 rounded"
                                data-testid={`img-favicon-${org.id}`}
                              />
                            ) : (
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-name-${org.id}`}>
                            {org.name}
                          </TableCell>
                          <TableCell data-testid={`text-domain-${org.id}`}>
                            {org.canonicalDomain}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" data-testid={`badge-status-${org.id}`}>
                              {org.status}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-refcount-${org.id}`}>
                            {org.activeReferenceCount}
                          </TableCell>
                          <TableCell data-testid={`text-lastcrawl-${org.id}`}>
                            {formatRelativeTime(org.lastFullCrawl)}
                          </TableCell>
                          <TableCell data-testid={`text-lastmonitor-${org.id}`}>
                            {formatRelativeTime(org.lastWebsiteMonitor)}
                          </TableCell>
                          <TableCell data-testid={`text-archivedat-${org.id}`}>
                            {formatRelativeTime(org.archivedAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => reactivateMutation.mutate(org.id)}
                                disabled={reactivateMutation.isPending}
                                data-testid={`button-reactivate-${org.id}`}
                              >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                Reactivate
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setOrgToDelete(org);
                                  setDeleteDialogOpen(true);
                                }}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-${org.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Permanently Delete Organization</DialogTitle>
              <DialogDescription>
                Are you sure you want to permanently delete <strong>{orgToDelete?.name}</strong> ({orgToDelete?.canonicalDomain})?
                This action cannot be undone. All crawl data will be erased.
              </DialogDescription>
            </DialogHeader>
            {orgToDelete && orgToDelete.activeReferenceCount > 0 && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                This organization has {orgToDelete.activeReferenceCount} active references and cannot be deleted.
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setOrgToDelete(null);
                }}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => orgToDelete && deleteMutation.mutate(orgToDelete.id)}
                disabled={deleteMutation.isPending || (orgToDelete?.activeReferenceCount ?? 0) > 0}
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
