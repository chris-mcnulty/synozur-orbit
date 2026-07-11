import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import { Link } from "wouter";
import { AppWindow, Plus, Loader2, AlertTriangle, GitBranch, Sparkles } from "lucide-react";
import { VersionStatusBadge, DATA_CLASSIFICATIONS } from "./shared";

interface AppRow {
  id: string;
  name: string;
  productFamily: string | null;
  description: string | null;
  businessOwner: string | null;
  technicalOwner: string | null;
  hostingPlatform: string | null;
  authMethod: string | null;
  dataClassification: string | null;
  aiEnabled: boolean;
  certificationTarget: string | null;
  appUrl: string | null;
  repoUrl: string | null;
  versionCount: number;
  latestVersion: { versionNumber: string; assessmentStatus: string } | null;
  openFindingCount: number;
}

const emptyForm = {
  name: "",
  productFamily: "",
  description: "",
  businessOwner: "",
  technicalOwner: "",
  hostingPlatform: "",
  authMethod: "",
  dataClassification: "internal",
  aiEnabled: false,
  certificationTarget: "",
  appUrl: "",
  repoUrl: "",
};

export default function ObservatoryApplications() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppRow | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: apps, isLoading } = useQuery<AppRow[]>({ queryKey: ["/api/observatory/applications"] });

  const invalidate = () =>
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        productFamily: form.productFamily || null,
        description: form.description || null,
        businessOwner: form.businessOwner || null,
        technicalOwner: form.technicalOwner || null,
        hostingPlatform: form.hostingPlatform || null,
        authMethod: form.authMethod || null,
        certificationTarget: form.certificationTarget || null,
        appUrl: form.appUrl || null,
        repoUrl: form.repoUrl || null,
      };
      const res = editing
        ? await apiRequest("PATCH", `/api/observatory/applications/${editing.id}`, payload)
        : await apiRequest("POST", "/api/observatory/applications", payload);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({ title: editing ? "Application updated" : "Application created" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/observatory/seed-demo")).json(),
    onSuccess: (data: { seeded: boolean }) => {
      invalidate();
      toast({ title: data.seeded ? "Sample data loaded" : "Sample data already present" });
    },
    onError: (err: Error) => toast({ title: "Could not load sample data", description: err.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };
  const openEdit = (a: AppRow) => {
    setEditing(a);
    setForm({
      name: a.name,
      productFamily: a.productFamily ?? "",
      description: a.description ?? "",
      businessOwner: a.businessOwner ?? "",
      technicalOwner: a.technicalOwner ?? "",
      hostingPlatform: a.hostingPlatform ?? "",
      authMethod: a.authMethod ?? "",
      dataClassification: a.dataClassification ?? "internal",
      aiEnabled: a.aiEnabled,
      certificationTarget: a.certificationTarget ?? "",
      appUrl: a.appUrl ?? "",
      repoUrl: a.repoUrl ?? "",
    });
    setDialogOpen(true);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-applications-title">Applications</h1>
            <p className="text-muted-foreground text-sm mt-1">The application portfolio under assurance.</p>
          </div>
          {canWrite && (
            <Button onClick={openCreate} data-testid="button-new-application">
              <Plus className="h-4 w-4 mr-2" /> New Application
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (apps ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-4">
              <AppWindow className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">No applications yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create your first application or load sample data to explore.</p>
              </div>
              {canWrite && (
                <div className="flex gap-3">
                  <Button onClick={openCreate} data-testid="button-create-first-application">
                    <Plus className="h-4 w-4 mr-2" /> New Application
                  </Button>
                  <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-load-sample-data">
                    {seedMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    Load sample data
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(apps ?? []).map((a) => (
              <Link key={a.id} href={`/app/observatory/applications/${a.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full" data-testid={`card-application-${a.id}`}>
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold" data-testid={`text-app-name-${a.id}`}>{a.name}</p>
                        {a.productFamily && <p className="text-xs text-muted-foreground">{a.productFamily}</p>}
                      </div>
                      {a.aiEnabled && <Badge variant="outline" className="bg-purple-500/15 text-purple-400 border-purple-500/30">AI</Badge>}
                    </div>
                    {a.description && <p className="text-sm text-muted-foreground line-clamp-2">{a.description}</p>}
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" />{a.versionCount} version{a.versionCount === 1 ? "" : "s"}</span>
                      <span className="flex items-center gap-1" data-testid={`text-open-findings-${a.id}`}>
                        <AlertTriangle className="h-3.5 w-3.5" />{a.openFindingCount} open
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.latestVersion && (
                        <>
                          <span className="text-xs text-muted-foreground">Latest: v{a.latestVersion.versionNumber}</span>
                          <VersionStatusBadge status={a.latestVersion.assessmentStatus} />
                        </>
                      )}
                      {a.certificationTarget && <Badge variant="secondary" className="text-xs">{a.certificationTarget}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Application" : "New Application"}</DialogTitle>
            <DialogDescription>Applications are the root of the assurance traceability chain.</DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="app-name">Name *</Label>
              <Input id="app-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-app-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-family">Product family</Label>
              <Input id="app-family" value={form.productFamily} onChange={(e) => setForm({ ...form, productFamily: e.target.value })} data-testid="input-app-family" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-cert">Certification target</Label>
              <Input id="app-cert" placeholder="e.g. WCAG 2.2 AA, SOC 2 Type II" value={form.certificationTarget} onChange={(e) => setForm({ ...form, certificationTarget: e.target.value })} data-testid="input-app-cert-target" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="app-desc">Description</Label>
              <Textarea id="app-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-app-description" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-bowner">Business owner</Label>
              <Input id="app-bowner" value={form.businessOwner} onChange={(e) => setForm({ ...form, businessOwner: e.target.value })} data-testid="input-app-business-owner" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-towner">Technical owner</Label>
              <Input id="app-towner" value={form.technicalOwner} onChange={(e) => setForm({ ...form, technicalOwner: e.target.value })} data-testid="input-app-technical-owner" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-hosting">Hosting platform</Label>
              <Input id="app-hosting" placeholder="e.g. Azure App Service" value={form.hostingPlatform} onChange={(e) => setForm({ ...form, hostingPlatform: e.target.value })} data-testid="input-app-hosting" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-auth">Authentication method</Label>
              <Input id="app-auth" placeholder="e.g. Microsoft Entra ID" value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value })} data-testid="input-app-auth" />
            </div>
            <div className="space-y-2">
              <Label>Data classification</Label>
              <Select value={form.dataClassification} onValueChange={(v) => setForm({ ...form, dataClassification: v })}>
                <SelectTrigger data-testid="select-app-classification"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATA_CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex items-end">
              <div className="flex items-center gap-2 pb-1">
                <Switch checked={form.aiEnabled} onCheckedChange={(v) => setForm({ ...form, aiEnabled: v })} data-testid="switch-app-ai" />
                <Label>AI-enabled application</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-url">Application URL</Label>
              <Input id="app-url" value={form.appUrl} onChange={(e) => setForm({ ...form, appUrl: e.target.value })} data-testid="input-app-url" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-repo">Repository URL</Label>
              <Input id="app-repo" value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} data-testid="input-app-repo" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-application">Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.name.trim() || saveMutation.isPending} data-testid="button-save-application">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? "Save changes" : "Create application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

export { emptyForm as applicationEmptyForm };
