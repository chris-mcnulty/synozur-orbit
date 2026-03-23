import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Plus, Trash2, Lock, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PLATFORMS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X / Twitter" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
];

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  accountId?: string;
  profileUrl?: string;
  notes?: string;
  status: string;
}

export default function SocialAccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ platform: "linkedin", accountName: "", accountId: "", profileUrl: "", notes: "" });
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ id: string; platform: string; accountName: string; accountId: string; profileUrl: string; notes: string }>({ id: "", platform: "linkedin", accountName: "", accountId: "", profileUrl: "", notes: "" });

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.socialAccounts === true;

  const { data: accounts = [], isLoading } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      setAddOpen(false);
      setForm({ platform: "linkedin", accountName: "", accountId: "", profileUrl: "", notes: "" });
      toast({ title: "Social account added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      const r = await fetch(`/api/social-accounts/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platform: data.platform, accountName: data.accountName, accountId: data.accountId, profileUrl: data.profileUrl, notes: data.notes }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      setEditOpen(false);
      toast({ title: "Social account updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/social-accounts/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Social account removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const platformLabel = (p: string) => PLATFORMS.find(x => x.value === p)?.label ?? p;

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Social Accounts</CardTitle>
              <CardDescription>Available on the Enterprise plan. Connect your social media accounts to campaigns and export AI-generated posts directly.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Social Accounts">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AtSign className="w-6 h-6" /> Social Accounts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Manage social media accounts for use in campaigns and post generation.</p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Social Account</DialogTitle>
                <DialogDescription>Add a social media account to use in campaigns and post exports.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Platform</Label>
                  <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                    <SelectTrigger data-testid="select-add-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Account Name</Label>
                  <Input value={form.accountName} onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))} placeholder="Synozur Alliance" data-testid="input-add-account-name" />
                </div>
                <div>
                  <Label>Account ID</Label>
                  <Input value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} placeholder="SocialPilot account number" data-testid="input-add-account-id" />
                </div>
                <div className="flex gap-4 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)} data-testid="button-cancel-add-account">Cancel</Button>
                  <Button
                    className="flex-1"
                    disabled={!form.accountName.trim() || createMutation.isPending}
                    onClick={() => createMutation.mutate(form)}
                    data-testid="button-submit-add-account"
                  >
                    {createMutation.isPending ? "Adding..." : "Add Account"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : accounts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No social accounts yet. Add an account to link it to your campaigns.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {accounts.map(account => (
              <Card key={account.id} className="group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge className="mb-2">{platformLabel(account.platform)}</Badge>
                      <CardTitle className="text-base">{account.accountName}</CardTitle>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 h-7 w-7 shrink-0"
                        onClick={() => {
                          setEditForm({ id: account.id, platform: account.platform, accountName: account.accountName, accountId: account.accountId || "", profileUrl: account.profileUrl || "", notes: account.notes || "" });
                          setEditOpen(true);
                        }}
                        data-testid={`button-edit-account-${account.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 h-7 w-7 shrink-0"
                        onClick={() => removeMutation.mutate(account.id)}
                        data-testid={`button-delete-account-${account.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  {account.accountId && (
                    <p className="text-xs text-muted-foreground">ID: <span className="font-mono">{account.accountId}</span></p>
                  )}
                  {account.profileUrl && (
                    <a href={account.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">
                      {account.profileUrl}
                    </a>
                  )}
                  {account.notes && <p className="text-xs text-muted-foreground">{account.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Social Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Platform</Label>
                <Select value={editForm.platform} onValueChange={v => setEditForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger data-testid="select-edit-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Account Name</Label>
                <Input value={editForm.accountName} onChange={e => setEditForm(f => ({ ...f, accountName: e.target.value }))} data-testid="input-edit-account-name" />
              </div>
              <div>
                <Label>Account ID</Label>
                <Input value={editForm.accountId} onChange={e => setEditForm(f => ({ ...f, accountId: e.target.value }))} placeholder="SocialPilot account number" data-testid="input-edit-account-id" />
              </div>
              <div className="flex gap-4 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit-account">Cancel</Button>
                <Button
                  className="flex-1"
                  disabled={!editForm.accountName.trim() || editMutation.isPending}
                  onClick={() => editMutation.mutate(editForm)}
                  data-testid="button-save-edit-account"
                >
                  {editMutation.isPending ? "Saving..." : "Update"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
