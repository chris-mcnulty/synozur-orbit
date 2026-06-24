import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Layers, Plus, Pencil, Trash2, Loader2, Lock, Target } from "lucide-react";
import { useLocation } from "wouter";

interface SolutionArea {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
}

const PRESET_COLORS = [
  "#810FFB", "#6366F1", "#3B82F6", "#06B6D4", "#10B981",
  "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6", "#64748B",
];

const emptyForm = { name: "", description: "", color: "#810FFB", sortOrder: 0 };

export default function SolutionAreasPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editArea, setEditArea] = useState<SolutionArea | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SolutionArea | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.contentLibrary === true;

  const { data: areas = [], isLoading } = useQuery<SolutionArea[]>({
    queryKey: ["/api/solution-areas"],
    queryFn: async () => {
      const r = await fetch("/api/solution-areas", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch("/api/solution-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/solution-areas"] });
      setAddOpen(false);
      setForm(emptyForm);
      toast({ title: "Solution area created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      const r = await fetch(`/api/solution-areas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/solution-areas"] });
      setEditArea(null);
      toast({ title: "Solution area updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/solution-areas/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/solution-areas"] });
      setDeleteTarget(null);
      toast({ title: "Solution area deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (area: SolutionArea) => {
    setEditForm({
      name: area.name,
      description: area.description || "",
      color: area.color || "#810FFB",
      sortOrder: area.sortOrder,
    });
    setEditArea(area);
  };

  if (!isAllowed && tenantInfo !== undefined) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Solution Areas</CardTitle>
              <CardDescription>Available on the Enterprise plan. Organise your content and brand assets into solution areas for targeted campaign assembly.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Solution Areas">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="page-header-gradient-bar rounded-lg p-6 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-solution-areas-title">
                <Layers className="w-6 h-6" /> Solution Areas
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Group content and brand assets by solution area for campaign targeting and filtering.
              </p>
            </div>
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-solution-area">
              <Plus className="w-4 h-4 mr-2" /> Add Area
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : areas.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center" data-testid="text-empty-solution-areas">
              <Layers className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No solution areas yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first area to start tagging content and brand assets.</p>
              <Button className="mt-4" onClick={() => setAddOpen(true)} data-testid="button-create-first-area">
                <Plus className="w-4 h-4 mr-2" /> Create First Area
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {areas.map(area => (
              <Card key={area.id} className="group" data-testid={`card-solution-area-${area.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-3 h-3 rounded-full shrink-0 ring-2 ring-offset-1"
                        style={{ backgroundColor: area.color || "#810FFB", ringColor: area.color || "#810FFB" }}
                      />
                      <CardTitle className="text-base leading-tight truncate">{area.name}</CardTitle>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => navigate(`/app/marketing/planning-hub?scope=theme&id=${area.id}`)}
                        data-testid={`button-plan-area-${area.id}`}
                        title="Open in Themes Hub"
                      >
                        <Target className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => openEdit(area)}
                        data-testid={`button-edit-area-${area.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(area)}
                        data-testid={`button-delete-area-${area.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  {area.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{area.description}</p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <Badge variant="outline" className="text-xs font-mono">{area.slug}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setForm(emptyForm); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Solution Area</DialogTitle>
            <DialogDescription>Define a new area to group your content and brand assets.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. AI Platform, Security, Healthcare"
                data-testid="input-area-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of this solution area…"
                rows={3}
                data-testid="input-area-description"
              />
            </div>
            <div>
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${form.color === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    data-testid={`color-swatch-${c.replace("#", "")}`}
                  />
                ))}
                <input
                  type="color"
                  value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-7 h-7 rounded cursor-pointer border"
                  title="Custom colour"
                />
              </div>
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                className="w-24"
                data-testid="input-area-sort-order"
              />
              <p className="text-xs text-muted-foreground mt-1">Lower numbers appear first.</p>
            </div>
            <Button
              className="w-full"
              disabled={!form.name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
              data-testid="button-save-area"
            >
              {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : "Create Area"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editArea} onOpenChange={v => { if (!v) setEditArea(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Solution Area</DialogTitle>
            <DialogDescription>Update the details for this solution area.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-edit-area-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                data-testid="input-edit-area-description"
              />
            </div>
            <div>
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${editForm.color === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEditForm(f => ({ ...f, color: c }))}
                  />
                ))}
                <input
                  type="color"
                  value={editForm.color}
                  onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                  className="w-7 h-7 rounded cursor-pointer border"
                  title="Custom colour"
                />
              </div>
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={editForm.sortOrder}
                onChange={e => setEditForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                className="w-24"
                data-testid="input-edit-area-sort-order"
              />
            </div>
            <Button
              className="w-full"
              disabled={!editForm.name.trim() || updateMutation.isPending}
              onClick={() => editArea && updateMutation.mutate({ id: editArea.id, data: editForm })}
              data-testid="button-save-edit-area"
            >
              {updateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the solution area. Any content or brand assets tagged with this area will lose the association, but the assets themselves will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete-area"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
