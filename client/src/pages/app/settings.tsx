import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreditCard, Users, Palette, UserPlus, Trash2, Shield, Loader2, Lock } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

interface TenantInvite {
  id: string;
  email: string;
  invitedRole: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface TenantSettings {
  id: string;
  domain: string;
  name: string;
  plan: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  monitoringFrequency: string;
  competitorLimit: number;
  analysisLimit: number;
  userCount: number;
  entraTenantId: string | null;
  entraEnabled: boolean;
}

export default function Settings() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Standard User");
  const [inviteOpen, setInviteOpen] = useState(false);
  
  const [brandingName, setBrandingName] = useState("");
  const [brandingPrimary, setBrandingPrimary] = useState("");
  const [brandingSecondary, setBrandingSecondary] = useState("");
  const [monitoringFreq, setMonitoringFreq] = useState("");
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  // Entra ID configuration state (simplified - only enable toggle, tenant ID is auto-populated)
  const [entraEnabled, setEntraEnabled] = useState(false);

  const { data: tenant, isLoading: tenantLoading } = useQuery<TenantSettings>({
    queryKey: ["/api/tenant/settings"],
    enabled: !!user,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team/members"],
    enabled: isAdmin,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery<TenantInvite[]>({
    queryKey: ["/api/team/invites"],
    enabled: isAdmin,
  });

  React.useEffect(() => {
    if (tenant) {
      setBrandingName(tenant.name || "");
      setBrandingPrimary(tenant.primaryColor || "#810FFB");
      setBrandingSecondary(tenant.secondaryColor || "#E60CB3");
      setMonitoringFreq(tenant.monitoringFrequency || "weekly");
      setEntraEnabled(tenant.entraEnabled || false);
    }
  }, [tenant]);

  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send invite");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/invites"] });
      setInviteEmail("");
      setInviteRole("Standard User");
      setInviteOpen(false);
      toast.success("Invite sent successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/team/invites/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to revoke invite");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/invites"] });
      toast.success("Invite revoked");
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
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update role");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/members"] });
      toast.success("Role updated");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/team/members/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/members"] });
      toast.success("Member removed");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: brandingName,
          primaryColor: brandingPrimary,
          secondaryColor: brandingSecondary,
          monitoringFrequency: monitoringFreq,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/settings"] });
      toast.success("Settings saved");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) {
        throw new Error("Passwords do not match");
      }
      const res = await fetch("/api/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to change password");
      }
      return data;
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateEntraMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entraEnabled,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update SSO settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/settings"] });
      toast.success("SSO settings saved");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const pendingInvites = invites.filter(i => i.status === "pending");

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your workspace, team, and branding.</p>
      </div>

      <div className="space-y-8">
        {isAdmin && (
          <Card data-testid="card-team-management">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Management
                  </CardTitle>
                  <CardDescription>Manage team members and invitations.</CardDescription>
                </div>
                <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-invite-member">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Invite Member
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite Team Member</DialogTitle>
                      <DialogDescription>
                        Send an invitation to join your organization.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Email Address</Label>
                        <Input
                          type="email"
                          placeholder={`colleague@${tenant?.domain || "company.com"}`}
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
                      <Button
                        onClick={() => sendInviteMutation.mutate()}
                        disabled={!inviteEmail || sendInviteMutation.isPending}
                        data-testid="button-send-invite"
                      >
                        {sendInviteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Send Invite
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-sm font-medium mb-3">Team Members ({members.length})</h4>
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.id} data-testid={`row-member-${member.id}`}>
                          <TableCell className="font-medium">{member.name}</TableCell>
                          <TableCell>{member.email}</TableCell>
                          <TableCell>
                            <Select
                              value={member.role}
                              onValueChange={(role) => updateRoleMutation.mutate({ userId: member.id, role })}
                              disabled={member.id === user?.id || member.role === "Global Admin"}
                            >
                              <SelectTrigger className="w-[140px]" data-testid={`select-role-${member.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Standard User">Standard User</SelectItem>
                                <SelectItem value="Domain Admin">Domain Admin</SelectItem>
                                {member.role === "Global Admin" && (
                                  <SelectItem value="Global Admin">Global Admin</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            {member.id !== user?.id && member.role !== "Global Admin" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMemberMutation.mutate(member.id)}
                                data-testid={`button-remove-${member.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {pendingInvites.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-3">Pending Invitations ({pendingInvites.length})</h4>
                    <div className="space-y-2">
                      {pendingInvites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                          data-testid={`row-invite-${invite.id}`}
                        >
                          <div>
                            <p className="font-medium">{invite.email}</p>
                            <p className="text-sm text-muted-foreground">
                              Role: {invite.invitedRole} · Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revokeInviteMutation.mutate(invite.id)}
                            data-testid={`button-revoke-${invite.id}`}
                          >
                            Revoke
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card data-testid="card-branding">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Branding & Preferences
              </CardTitle>
              <CardDescription>Customize your workspace appearance and settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Organization Name</Label>
                <Input
                  value={brandingName}
                  onChange={(e) => setBrandingName(e.target.value)}
                  data-testid="input-org-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingPrimary}
                      onChange={(e) => setBrandingPrimary(e.target.value)}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-primary-color"
                    />
                    <Input
                      value={brandingPrimary}
                      onChange={(e) => setBrandingPrimary(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Secondary Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingSecondary}
                      onChange={(e) => setBrandingSecondary(e.target.value)}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-secondary-color"
                    />
                    <Input
                      value={brandingSecondary}
                      onChange={(e) => setBrandingSecondary(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Monitoring Frequency</Label>
                <Select value={monitoringFreq} onValueChange={setMonitoringFreq}>
                  <SelectTrigger data-testid="select-monitoring-freq">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  How often Orbit checks your competitors for updates.
                </p>
              </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => updateSettingsMutation.mutate()}
                disabled={updateSettingsMutation.isPending}
                data-testid="button-save-branding"
              >
                {updateSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        )}

        {user?.authProvider !== "entra" && (
          <Card data-testid="card-password">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>Update your account password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="input-current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                />
              </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => changePasswordMutation.mutate()}
                disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Change Password
              </Button>
            </CardFooter>
          </Card>
        )}

        <Card data-testid="card-plan">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Plan & Usage</CardTitle>
                <CardDescription>Your current subscription and usage limits.</CardDescription>
              </div>
              <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/20">
                {tenant?.plan ? tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1) : "Free"} Plan
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Team Members</div>
                <div className="text-2xl font-bold">{tenant?.userCount || 0}</div>
              </div>
              <div className="p-4 border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Competitor Limit</div>
                <div className="text-2xl font-bold">{tenant?.competitorLimit || 3}</div>
              </div>
              <div className="p-4 border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Analysis Limit</div>
                <div className="text-2xl font-bold">{tenant?.analysisLimit || 5}</div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t border-border px-6 py-4 bg-muted/20">
            <Button variant="default" className="w-full sm:w-auto">Upgrade Plan</Button>
          </CardFooter>
        </Card>

        {isAdmin && (
          <Card data-testid="card-entra-config">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Microsoft Entra ID (SSO)
              </CardTitle>
              <CardDescription>Configure enterprise Single Sign-On for your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-muted/50 rounded-lg border border-border">
                <Label className="text-sm font-medium">Redirect URI (copy to Azure Portal)</Label>
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 p-2 bg-background rounded text-sm font-mono break-all">
                    {window.location.origin}/api/auth/entra/callback
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/auth/entra/callback`);
                      toast.success("Redirect URI copied to clipboard");
                    }}
                    data-testid="button-copy-redirect-uri"
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Add this as a "Web" platform redirect URI in your Azure App Registration. No trailing slash.
                </p>
              </div>
              
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="entra-enabled">Enable Microsoft SSO</Label>
                    <p className="text-xs text-muted-foreground">Allow users to sign in with their Microsoft work accounts</p>
                  </div>
                  <Switch
                    id="entra-enabled"
                    checked={entraEnabled}
                    onCheckedChange={setEntraEnabled}
                    data-testid="switch-entra-enabled"
                  />
                </div>
                
                {tenant?.entraTenantId && (
                  <div className="space-y-2">
                    <Label>Azure Tenant ID</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-background rounded text-sm font-mono text-muted-foreground">
                        {tenant.entraTenantId}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auto-detected from your first Microsoft sign-in
                    </p>
                  </div>
                )}
                
                {!tenant?.entraTenantId && entraEnabled && (
                  <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
                    <p className="text-sm text-yellow-500">
                      Tenant ID will be auto-detected when a user signs in with Microsoft for the first time.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => updateEntraMutation.mutate()}
                disabled={updateEntraMutation.isPending}
                data-testid="button-save-entra"
              >
                {updateEntraMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save SSO Settings
              </Button>
            </CardFooter>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Connect Orbit to your existing stack.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">HubSpot</Label>
                <p className="text-sm text-muted-foreground">Sync reports to your CRM.</p>
              </div>
              <Button variant="outline" size="sm">Connect</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
