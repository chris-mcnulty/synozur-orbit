import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreHorizontal, Building2, Edit2, Loader2, Trash2, FolderOpen, Users, ExternalLink, Archive, CheckCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

interface ClientProject {
  id: string;
  name: string;
  clientName: string;
  clientDomain: string | null;
  description: string | null;
  status: string;
  tenantDomain: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  competitors?: any[];
}

export default function Projects() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ClientProject | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    clientName: "",
    clientDomain: "",
    description: "",
  });

  const { data: projects = [], isLoading, error } = useQuery<ClientProject[]>({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects", {
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        if (data.upgradeRequired) {
          throw new Error("UPGRADE_REQUIRED");
        }
        throw new Error(data.error || "Failed to fetch projects");
      }
      return response.json();
    },
    retry: false,
  });

  const createProject = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create project");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setIsDialogOpen(false);
      setFormData({ name: "", clientName: "", clientDomain: "", description: "" });
      toast({
        title: "Project Created",
        description: "Your client project has been created.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateProject = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ClientProject> }) => {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update project");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setIsEditDialogOpen(false);
      setEditingProject(null);
      toast({
        title: "Project Updated",
        description: "Your project has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/projects/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to delete project");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Project Deleted",
        description: "The project has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createProject.mutate(formData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProject) {
      updateProject.mutate({
        id: editingProject.id,
        data: {
          name: formData.name,
          clientName: formData.clientName,
          clientDomain: formData.clientDomain || null,
          description: formData.description || null,
        },
      });
    }
  };

  const openEditDialog = (project: ClientProject) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      clientName: project.clientName,
      clientDomain: project.clientDomain || "",
      description: project.description || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleStatusChange = (project: ClientProject, newStatus: string) => {
    updateProject.mutate({ id: project.id, data: { status: newStatus } });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge data-testid={`badge-status-active`} className="bg-green-500/20 text-green-400 border-green-500/50">Active</Badge>;
      case "completed":
        return <Badge data-testid={`badge-status-completed`} className="bg-blue-500/20 text-blue-400 border-blue-500/50">Completed</Badge>;
      case "archived":
        return <Badge data-testid={`badge-status-archived`} className="bg-gray-500/20 text-gray-400 border-gray-500/50">Archived</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const isUpgradeRequired = error instanceof Error && error.message === "UPGRADE_REQUIRED";

  if (isUpgradeRequired) {
    return (
      <AppLayout>
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            <Card className="border-dashed border-2 bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">Client Projects</h3>
                <p className="text-muted-foreground text-center max-w-md mb-6">
                  Client Projects allow you to analyze client companies and their competitors 
                  without creating separate tenants. This feature is available on Professional 
                  and Enterprise plans.
                </p>
                <Link href="/app/settings">
                  <Button data-testid="button-upgrade">
                    Upgrade Your Plan
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Client Projects</h1>
              <p className="text-muted-foreground">
                Analyze client companies and competitors without creating new tenants
              </p>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-project">
                  <Plus className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleSubmit}>
                  <DialogHeader>
                    <DialogTitle>Create Client Project</DialogTitle>
                    <DialogDescription>
                      Create a new project to analyze a client's competitive landscape.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="name">Project Name</Label>
                      <Input
                        id="name"
                        data-testid="input-project-name"
                        placeholder="e.g., Rightpoint Q1 2026 Analysis"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="clientName">Client Name</Label>
                      <Input
                        id="clientName"
                        data-testid="input-client-name"
                        placeholder="e.g., Rightpoint"
                        value={formData.clientName}
                        onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="clientDomain">Client Domain (optional)</Label>
                      <Input
                        id="clientDomain"
                        data-testid="input-client-domain"
                        placeholder="e.g., rightpoint.com"
                        value={formData.clientDomain}
                        onChange={(e) => setFormData({ ...formData, clientDomain: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="description">Description (optional)</Label>
                      <Textarea
                        id="description"
                        data-testid="input-description"
                        placeholder="Brief description of the project scope..."
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" data-testid="button-create-project" disabled={createProject.isPending}>
                      {createProject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Project
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <Card className="border-dashed border-2 bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Projects Yet</h3>
                <p className="text-muted-foreground text-center max-w-md mb-4">
                  Create your first client project to start analyzing their competitive landscape.
                </p>
                <Button data-testid="button-create-first-project" onClick={() => setIsDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Project
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Card key={project.id} className="hover:border-primary/50 transition-colors" data-testid={`card-project-${project.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-base" data-testid={`text-project-name-${project.id}`}>
                            {project.name}
                          </CardTitle>
                          <CardDescription className="text-sm" data-testid={`text-client-name-${project.id}`}>
                            {project.clientName}
                          </CardDescription>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-menu-${project.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(project)} data-testid={`menu-edit-${project.id}`}>
                            <Edit2 className="mr-2 h-4 w-4" />
                            Edit Project
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {project.status !== "active" && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project, "active")}>
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Mark Active
                            </DropdownMenuItem>
                          )}
                          {project.status !== "completed" && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project, "completed")}>
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Mark Completed
                            </DropdownMenuItem>
                          )}
                          {project.status !== "archived" && (
                            <DropdownMenuItem onClick={() => handleStatusChange(project, "archived")}>
                              <Archive className="mr-2 h-4 w-4" />
                              Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive" data-testid={`menu-delete-${project.id}`}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Project
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will delete the project "{project.name}". Competitors will be unlinked but not deleted. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteProject.mutate(project.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  data-testid={`button-confirm-delete-${project.id}`}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      {getStatusBadge(project.status)}
                      {project.clientDomain && (
                        <a 
                          href={`https://${project.clientDomain}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                        >
                          {project.clientDomain}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {project.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-xs text-muted-foreground">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                      <Link href={`/app/projects/${project.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-view-${project.id}`}>
                          View Project
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Project</DialogTitle>
              <DialogDescription>
                Update the project details.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Project Name</Label>
                <Input
                  id="edit-name"
                  data-testid="input-edit-project-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-clientName">Client Name</Label>
                <Input
                  id="edit-clientName"
                  data-testid="input-edit-client-name"
                  value={formData.clientName}
                  onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-clientDomain">Client Domain (optional)</Label>
                <Input
                  id="edit-clientDomain"
                  data-testid="input-edit-client-domain"
                  value={formData.clientDomain}
                  onChange={(e) => setFormData({ ...formData, clientDomain: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-description">Description (optional)</Label>
                <Textarea
                  id="edit-description"
                  data-testid="input-edit-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="button-save-project" disabled={updateProject.isPending}>
                {updateProject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
