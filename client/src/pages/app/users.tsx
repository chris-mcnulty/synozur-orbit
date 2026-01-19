import React, { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, MoreHorizontal, Shield, User, Crown, Loader2, Mail, Search, UserPlus, Building2, Filter } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { toast } from "sonner";

interface Tenant {
  id: string;
  domain: string;
  name: string;
}

interface EntraUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
}

export default function UsersPage() {
  const { user: currentUser } = useUser();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Standard User");
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState("Standard User");
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  
  const [entraOpen, setEntraOpen] = useState(false);
  const [entraSearchQuery, setEntraSearchQuery] = useState("");
  const [entraSearchResults, setEntraSearchResults] = useState<EntraUser[]>([]);
  const [selectedEntraUser, setSelectedEntraUser] = useState<EntraUser | null>(null);
  const [entraRole, setEntraRole] = useState("Standard User");
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [tenantFilter, setTenantFilter] = useState<string>("all");

  const isGlobalAdmin = currentUser?.role === "Global Admin";

  const { data: accessibleTenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/admin/tenants"],
    queryFn: async () => {
      const response = await fetch("/api/admin/tenants", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: isGlobalAdmin,
  });

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch("/api/users", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("You don't have permission to view users");
        }
        throw new Error("Failed to fetch users");
      }
      return response.json();
    },
  });

  const filteredUsers = React.useMemo(() => {
    if (tenantFilter === "all") return users;
    return users.filter((user: any) => user.company === tenantFilter);
  }, [users, tenantFilter]);

  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send invite");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setInviteEmail("");
      setInviteRole("Standard User");
      setInviteOpen(false);
      toast.success("Invite sent successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/team/members/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update role");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditRoleOpen(false);
      setSelectedUser(null);
      toast.success("Role updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/team/members/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setRemoveConfirmOpen(false);
      setSelectedUser(null);
      toast.success("User removed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleVerificationMutation = useMutation({
    mutationFn: async ({ userId, emailVerified }: { userId: string; emailVerified: boolean }) => {
      const res = await fetch(`/api/team/members/${userId}/verification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ emailVerified }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update verification");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast.success("Verification status updated");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const { data: entraStatus } = useQuery({
    queryKey: ["/api/team/entra/status"],
    queryFn: async () => {
      const res = await fetch("/api/team/entra/status", { credentials: "include" });
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });

  const searchEntraUsers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setEntraSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/team/entra/search?q=${encodeURIComponent(query)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Search failed");
      }
      const users = await res.json();
      setEntraSearchResults(users);
    } catch (error: any) {
      toast.error(error.message);
      setEntraSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (entraSearchQuery.length >= 2) {
        searchEntraUsers(entraSearchQuery);
      } else {
        setEntraSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [entraSearchQuery, searchEntraUsers]);

  const provisionEntraUserMutation = useMutation({
    mutationFn: async (entraUser: EntraUser) => {
      const res = await fetch("/api/team/entra/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entraUserId: entraUser.id,
          email: entraUser.mail || entraUser.userPrincipalName,
          displayName: entraUser.displayName,
          jobTitle: entraUser.jobTitle,
          role: entraRole,
          sendWelcomeEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to provision user");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEntraOpen(false);
      setEntraSearchQuery("");
      setEntraSearchResults([]);
      setSelectedEntraUser(null);
      setEntraRole("Standard User");
      setSendWelcomeEmail(true);
      toast.success("User added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "Global Admin":
        return <Crown size={14} className="text-yellow-500" />;
      case "Domain Admin":
        return <Shield size={14} className="text-primary" />;
      default:
        return <User size={14} className="text-muted-foreground" />;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "Global Admin":
        return "default";
      case "Domain Admin":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <p className="text-destructive mb-2">{(error as Error).message}</p>
          <p className="text-muted-foreground text-sm">Only admins can access user management.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">User Management</h1>
           <p className="text-muted-foreground">Manage access and roles for your workspace.</p>
        </div>
        <div className="flex gap-2">
          {entraStatus?.configured && (
            <Button 
              variant="outline" 
              onClick={() => setEntraOpen(true)}
              data-testid="button-add-from-entra"
            >
              <Building2 className="w-4 h-4 mr-2" /> Add from Entra ID
            </Button>
          )}
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-invite-user">
                <Plus className="w-4 h-4 mr-2" /> Invite User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>
                  Send an invitation to add a new member to your team.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    data-testid="input-invite-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger data-testid="select-invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Standard User">Standard User</SelectItem>
                      <SelectItem value="Domain Admin">Domain Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => sendInviteMutation.mutate()}
                  disabled={!inviteEmail || sendInviteMutation.isPending}
                  data-testid="button-send-invite"
                >
                  {sendInviteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Mail className="h-4 w-4 mr-2" />
                  Send Invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}{tenantFilter !== "all" ? " in selected organization" : " total"}.
              </CardDescription>
            </div>
            {isGlobalAdmin && accessibleTenants.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <Select value={tenantFilter} onValueChange={setTenantFilter}>
                  <SelectTrigger className="w-[200px]" data-testid="select-tenant-filter">
                    <SelectValue placeholder="Filter by organization" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {accessibleTenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.domain}>
                        {tenant.name || tenant.domain}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {tenantFilter !== "all" ? "No users found in this organization." : "No users found."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user: any) => (
                  <TableRow key={user.id} className={user.id === currentUser?.id ? "bg-primary/5" : ""}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {user.avatar || user.name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            {user.name}
                            {user.id === currentUser?.id && (
                              <Badge variant="outline" className="text-xs">You</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getRoleIcon(user.role)}
                        <Badge variant={getRoleBadgeVariant(user.role)}>
                          {user.role}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.emailVerified ? "default" : "secondary"} className={user.emailVerified ? "bg-green-600" : "bg-amber-600"}>
                        {user.emailVerified ? "Verified" : "Unverified"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.company || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedUser(user);
                              setNewRole(user.role === "Global Admin" ? "Domain Admin" : user.role);
                              setEditRoleOpen(true);
                            }}
                            disabled={user.role === "Global Admin" || user.id === currentUser?.id}
                            data-testid={`button-edit-role-${user.id}`}
                          >
                            Edit Role
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              toggleVerificationMutation.mutate({
                                userId: user.id,
                                emailVerified: !user.emailVerified,
                              });
                            }}
                            disabled={user.id === currentUser?.id}
                            data-testid={`button-toggle-verify-${user.id}`}
                          >
                            {user.emailVerified ? "Mark as Unverified" : "Mark as Verified"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setSelectedUser(user);
                              setRemoveConfirmOpen(true);
                            }}
                            disabled={user.role === "Global Admin" || user.id === currentUser?.id}
                            data-testid={`button-remove-user-${user.id}`}
                          >
                            Remove User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Role</DialogTitle>
            <DialogDescription>
              Change the role for {selectedUser?.name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>New Role</Label>
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger data-testid="select-new-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Standard User">Standard User</SelectItem>
                <SelectItem value="Domain Admin">Domain Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedUser) {
                  updateRoleMutation.mutate({ userId: selectedUser.id, role: newRole });
                }
              }}
              disabled={updateRoleMutation.isPending}
              data-testid="button-save-role"
            >
              {updateRoleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {selectedUser?.name || selectedUser?.email} from your organization? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedUser) {
                  removeUserMutation.mutate(selectedUser.id);
                }
              }}
              disabled={removeUserMutation.isPending}
              data-testid="button-confirm-remove"
            >
              {removeUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entraOpen} onOpenChange={(open) => {
        setEntraOpen(open);
        if (!open) {
          setEntraSearchQuery("");
          setEntraSearchResults([]);
          setSelectedEntraUser(null);
          setEntraRole("Standard User");
          setSendWelcomeEmail(true);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add User from Entra ID</DialogTitle>
            <DialogDescription>
              Search your organization's directory and add users directly.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={entraSearchQuery}
                onChange={(e) => setEntraSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-entra-search"
              />
            </div>

            {isSearching && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isSearching && entraSearchResults.length > 0 && (
              <div className="border rounded-lg max-h-60 overflow-y-auto">
                {entraSearchResults.map((entraUser) => (
                  <div
                    key={entraUser.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                      selectedEntraUser?.id === entraUser.id ? "bg-primary/10 border-l-2 border-primary" : ""
                    }`}
                    onClick={() => setSelectedEntraUser(entraUser)}
                    data-testid={`entra-user-${entraUser.id}`}
                  >
                    <Avatar>
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {entraUser.displayName?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{entraUser.displayName}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {entraUser.mail || entraUser.userPrincipalName}
                      </div>
                      {entraUser.jobTitle && (
                        <div className="text-xs text-muted-foreground truncate">
                          {entraUser.jobTitle}{entraUser.department && ` • ${entraUser.department}`}
                        </div>
                      )}
                    </div>
                    {selectedEntraUser?.id === entraUser.id && (
                      <Badge variant="secondary">Selected</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!isSearching && entraSearchQuery.length >= 2 && entraSearchResults.length === 0 && (
              <div className="text-center py-4 text-muted-foreground">
                No users found matching "{entraSearchQuery}"
              </div>
            )}

            {entraSearchQuery.length > 0 && entraSearchQuery.length < 2 && (
              <div className="text-center py-2 text-sm text-muted-foreground">
                Type at least 2 characters to search
              </div>
            )}

            {selectedEntraUser && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <Avatar>
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {selectedEntraUser.displayName?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{selectedEntraUser.displayName}</div>
                    <div className="text-sm text-muted-foreground">
                      {selectedEntraUser.mail || selectedEntraUser.userPrincipalName}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={entraRole} onValueChange={setEntraRole}>
                      <SelectTrigger data-testid="select-entra-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Standard User">Standard User</SelectItem>
                        <SelectItem value="Domain Admin">Domain Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Welcome Email</Label>
                    <div className="flex items-center gap-2 h-10">
                      <Switch
                        checked={sendWelcomeEmail}
                        onCheckedChange={setSendWelcomeEmail}
                        data-testid="switch-welcome-email"
                      />
                      <span className="text-sm text-muted-foreground">
                        {sendWelcomeEmail ? "Send welcome email" : "Skip email"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEntraOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedEntraUser) {
                  provisionEntraUserMutation.mutate(selectedEntraUser);
                }
              }}
              disabled={!selectedEntraUser || provisionEntraUserMutation.isPending}
              data-testid="button-add-entra-user"
            >
              {provisionEntraUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
