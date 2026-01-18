import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, Plus, Eye, Trash2, Scale, Calendar, Building2, User, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { JOB_ROLES, INDUSTRIES, COMPANY_SIZES, COUNTRIES } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Assessment } from "@shared/schema";

export default function Assessments() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [isProxy, setIsProxy] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    proxyName: "",
    proxyCompany: "",
    proxyJobTitle: "",
    proxyIndustry: "",
    proxyCompanySize: "",
    proxyCountry: "",
  });

  const isAdmin = user?.role === "Global Admin" || user?.role === "Domain Admin";

  const { data: assessments = [], isLoading } = useQuery<Assessment[]>({
    queryKey: ["/api/assessments"],
    queryFn: async () => {
      const response = await fetch("/api/assessments", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const createAssessment = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create assessment");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({ title: "Assessment Created", description: "Your analysis snapshot has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteAssessment = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/assessments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete assessment");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
      toast({ title: "Deleted", description: "Assessment has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete assessment", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      proxyName: "",
      proxyCompany: "",
      proxyJobTitle: "",
      proxyIndustry: "",
      proxyCompanySize: "",
      proxyCountry: "",
    });
    setIsProxy(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAssessment.mutate({
      name: formData.name,
      description: formData.description,
      isProxy,
      ...(isProxy && {
        proxyName: formData.proxyName,
        proxyCompany: formData.proxyCompany,
        proxyJobTitle: formData.proxyJobTitle,
        proxyIndustry: formData.proxyIndustry,
        proxyCompanySize: formData.proxyCompanySize,
        proxyCountry: formData.proxyCountry,
      }),
    });
  };

  const viewAssessment = (assessment: Assessment) => {
    setSelectedAssessment(assessment);
    setIsViewDialogOpen(true);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
            <ClipboardList className="text-primary h-8 w-8" />
            Assessments
          </h1>
          <p className="text-muted-foreground">Save snapshots of your competitive analysis to track changes over time.</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-assessment">
              <Plus className="h-4 w-4 mr-2" />
              New Assessment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Assessment</DialogTitle>
              <DialogDescription>
                Save a snapshot of your current competitive analysis for future comparison.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Assessment Name</Label>
                  <Input
                    id="name"
                    placeholder="Q1 2026 Competitive Review"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    data-testid="input-assessment-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Notes about this assessment..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    data-testid="input-assessment-description"
                  />
                </div>

                {isAdmin && (
                  <>
                    <div className="flex items-center justify-between border-t pt-4">
                      <div>
                        <Label htmlFor="isProxy" className="text-base">On Behalf Of</Label>
                        <p className="text-sm text-muted-foreground">Create this assessment for a client or prospect</p>
                      </div>
                      <Switch
                        id="isProxy"
                        checked={isProxy}
                        onCheckedChange={setIsProxy}
                        data-testid="switch-proxy"
                      />
                    </div>

                    {isProxy && (
                      <div className="grid gap-4 border rounded-lg p-4 bg-muted/30">
                        <div className="grid gap-2">
                          <Label htmlFor="proxyName">Client Name</Label>
                          <Input
                            id="proxyName"
                            placeholder="John Smith"
                            value={formData.proxyName}
                            onChange={(e) => setFormData({ ...formData, proxyName: e.target.value })}
                            required={isProxy}
                            data-testid="input-proxy-name"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="proxyCompany">Client Company</Label>
                          <Input
                            id="proxyCompany"
                            placeholder="Acme Corp"
                            value={formData.proxyCompany}
                            onChange={(e) => setFormData({ ...formData, proxyCompany: e.target.value })}
                            required={isProxy}
                            data-testid="input-proxy-company"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>Job Title</Label>
                            <Select value={formData.proxyJobTitle} onValueChange={(v) => setFormData({ ...formData, proxyJobTitle: v })}>
                              <SelectTrigger data-testid="select-proxy-job-title">
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                              <SelectContent>
                                {JOB_ROLES.map((role) => (
                                  <SelectItem key={role} value={role}>{role}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label>Industry</Label>
                            <Select value={formData.proxyIndustry} onValueChange={(v) => setFormData({ ...formData, proxyIndustry: v })}>
                              <SelectTrigger data-testid="select-proxy-industry">
                                <SelectValue placeholder="Select industry" />
                              </SelectTrigger>
                              <SelectContent>
                                {INDUSTRIES.map((ind) => (
                                  <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>Company Size</Label>
                            <Select value={formData.proxyCompanySize} onValueChange={(v) => setFormData({ ...formData, proxyCompanySize: v })}>
                              <SelectTrigger data-testid="select-proxy-company-size">
                                <SelectValue placeholder="Select size" />
                              </SelectTrigger>
                              <SelectContent>
                                {COMPANY_SIZES.map((size) => (
                                  <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label>Country</Label>
                            <Select value={formData.proxyCountry} onValueChange={(v) => setFormData({ ...formData, proxyCountry: v })}>
                              <SelectTrigger data-testid="select-proxy-country">
                                <SelectValue placeholder="Select country" />
                              </SelectTrigger>
                              <SelectContent>
                                {COUNTRIES.map((country) => (
                                  <SelectItem key={country} value={country}>{country}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createAssessment.isPending} data-testid="button-submit-assessment">
                  {createAssessment.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Assessment"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {assessments.length === 0 ? (
        <Card className="p-12 text-center">
          <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No assessments yet.</p>
          <p className="text-sm text-muted-foreground">Create your first assessment to save a snapshot of your competitive analysis.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assessments.map((assessment) => (
            <Card key={assessment.id} className="group hover:border-primary/50 transition-colors" data-testid={`card-assessment-${assessment.id}`}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{assessment.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(assessment.createdAt)}
                    </CardDescription>
                  </div>
                  {assessment.isProxy && (
                    <Badge variant="secondary" className="text-xs">
                      <User className="h-3 w-3 mr-1" />
                      Proxy
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {assessment.description && (
                  <p className="text-sm text-muted-foreground mb-3">{assessment.description}</p>
                )}
                {assessment.isProxy && assessment.proxyCompany && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {assessment.proxyName} at {assessment.proxyCompany}
                  </div>
                )}
                <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                  <span>{(assessment.competitorsSnapshot as any[])?.length || 0} competitors</span>
                  <span>{(assessment.recommendationsSnapshot as any[])?.length || 0} recommendations</span>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => viewAssessment(assessment)} data-testid={`button-view-${assessment.id}`}>
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" data-testid={`button-delete-${assessment.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Assessment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove this assessment snapshot. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAssessment.mutate(assessment.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedAssessment?.name}</DialogTitle>
            <DialogDescription>
              Created on {selectedAssessment && formatDateTime(selectedAssessment.createdAt)}
            </DialogDescription>
          </DialogHeader>
          {selectedAssessment && (
            <div className="grid gap-4 py-4">
              {selectedAssessment.description && (
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="mt-1">{selectedAssessment.description}</p>
                </div>
              )}

              {selectedAssessment.isProxy && (
                <div className="border rounded-lg p-4 bg-muted/30">
                  <Label className="text-muted-foreground mb-2 block">Proxy Assessment For</Label>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="font-medium">Name:</span> {selectedAssessment.proxyName}</div>
                    <div><span className="font-medium">Company:</span> {selectedAssessment.proxyCompany}</div>
                    <div><span className="font-medium">Title:</span> {selectedAssessment.proxyJobTitle}</div>
                    <div><span className="font-medium">Industry:</span> {selectedAssessment.proxyIndustry}</div>
                    <div><span className="font-medium">Size:</span> {selectedAssessment.proxyCompanySize}</div>
                    <div><span className="font-medium">Country:</span> {selectedAssessment.proxyCountry}</div>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-muted-foreground">Competitors Snapshot</Label>
                <div className="mt-2 space-y-2">
                  {(selectedAssessment.competitorsSnapshot as any[])?.map((comp: any, i: number) => (
                    <div key={i} className="flex justify-between items-center p-2 border rounded text-sm">
                      <span className="font-medium">{comp.name}</span>
                      <span className="text-muted-foreground">{comp.url}</span>
                    </div>
                  )) || <p className="text-sm text-muted-foreground">No competitors at time of snapshot</p>}
                </div>
              </div>

              {selectedAssessment.companyProfileSnapshot ? (
                <div>
                  <Label className="text-muted-foreground">Company Profile Snapshot</Label>
                  <div className="mt-2 p-2 border rounded text-sm">
                    <span className="font-medium">{(selectedAssessment.companyProfileSnapshot as any).companyName}</span>
                    <span className="text-muted-foreground ml-2">{(selectedAssessment.companyProfileSnapshot as any).websiteUrl}</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
