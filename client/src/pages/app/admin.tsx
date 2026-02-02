import React, { useState, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ObjectUploader } from "@/components/ObjectUploader";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Users, Crown, Edit, AlertCircle, Palette, Ban, Plus, Trash2, FileText, Upload, ToggleLeft, ToggleRight, Brain, CreditCard, Check, Clock, Play, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { AiUsageDashboard } from "@/components/admin/AiUsageDashboard";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import type { Tenant } from "@shared/schema";

type TenantWithCounts = Tenant & { actualUserCount: number };
type BlockedDomain = {
  id: string;
  domain: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
};
type GlobalDocument = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  fileType: string;
  originalFileName: string;
  wordCount: number;
  isActive: boolean;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
};

type ServicePlan = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  competitorLimit: number;
  analysisLimit: number;
  adminUserLimit: number;
  readWriteUserLimit: number;
  readOnlyUserLimit: number;
  multiMarketEnabled: boolean;
  marketLimit: number | null;
  monitoringFrequency: string | null;
  socialMonitoringEnabled: boolean | null;
  websiteMonitorEnabled: boolean | null;
  productMonitorEnabled: boolean | null;
  trialDays: number | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type JobStatusInfo = {
  lastRun: string | null;
  isRunning: boolean;
  nextRun: string | null;
  description: string;
  interval: string;
};

type ScheduledJobRun = {
  id: string;
  jobType: string;
  tenantDomain: string | null;
  targetId: string | null;
  targetName: string | null;
  status: string;
  result: Record<string, any> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

const JOB_TYPE_LABELS: Record<string, string> = {
  websiteCrawl: "Website Crawl",
  socialMonitor: "Social Monitor",
  websiteMonitor: "Website Monitor",
  productMonitor: "Product Monitor",
  trialReminder: "Trial Reminders",
  weeklyDigest: "Weekly Digest",
};

const GLOBAL_DOC_CATEGORIES = [
  { value: "brand_voice", label: "Brand Voice" },
  { value: "marketing_guidelines", label: "Marketing Guidelines" },
  { value: "digital_assets", label: "Digital Assets" },
  { value: "methodology", label: "Methodology" },
] as const;

export default function AdminPage() {
  const { user: currentUser } = useUser();
  const queryClient = useQueryClient();
  const [selectedTenant, setSelectedTenant] = useState<TenantWithCounts | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [newBlockedDomain, setNewBlockedDomain] = useState("");
  const [newBlockedReason, setNewBlockedReason] = useState("");
  const [globalDocDialogOpen, setGlobalDocDialogOpen] = useState(false);
  const [newGlobalDoc, setNewGlobalDoc] = useState({
    name: "",
    description: "",
    category: "brand_voice" as string,
    content: "",
  });
  const [uploadedGlobalDocFile, setUploadedGlobalDocFile] = useState<{ name: string; url: string; size: number } | null>(null);
  const [isExtractingText, setIsExtractingText] = useState(false);
  const pendingGlobalDocPathRef = useRef<string | null>(null);
  const [editForm, setEditForm] = useState({
    domain: "",
    name: "",
    plan: "",
    status: "",
    competitorLimit: 0,
    analysisLimit: 0,
    adminUserLimit: 1,
    readWriteUserLimit: 2,
    readOnlyUserLimit: 5,
    multiMarketEnabled: false,
    marketLimit: null as number | null,
    logoUrl: "",
    faviconUrl: "",
    primaryColor: "#810FFB",
    secondaryColor: "#E60CB3",
  });
  const [addTenantOpen, setAddTenantOpen] = useState(false);
  const [newTenant, setNewTenant] = useState({
    domain: "",
    name: "",
    plan: "trial",
    status: "active",
  });
  const [servicePlanDialogOpen, setServicePlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ServicePlan | null>(null);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("all");
  const [jobStatusFilter, setJobStatusFilter] = useState<string>("all");
  const [jobTargetFilter, setJobTargetFilter] = useState<string>("");
  const [planForm, setPlanForm] = useState({
    name: "",
    displayName: "",
    description: "",
    competitorLimit: 3,
    analysisLimit: 5,
    adminUserLimit: 1,
    readWriteUserLimit: 2,
    readOnlyUserLimit: 5,
    multiMarketEnabled: false,
    marketLimit: null as number | null,
    socialMonitoringEnabled: false,
    websiteMonitorEnabled: false,
    productMonitorEnabled: false,
    trialDays: null as number | null,
    monthlyPrice: null as number | null,
    annualPrice: null as number | null,
    isActive: true,
    isDefault: false,
    sortOrder: 0,
  });

  const { data: tenants = [], isLoading, error } = useQuery<TenantWithCounts[]>({
    queryKey: ["/api/tenants"],
    queryFn: async () => {
      const response = await fetch("/api/tenants", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Access denied - Global Admin only");
        }
        throw new Error("Failed to fetch tenants");
      }
      return response.json();
    },
  });

  const updateTenantMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Tenant> }) => {
      const response = await fetch(`/api/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update tenant");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setEditDialogOpen(false);
    },
  });

  const createTenantMutation = useMutation({
    mutationFn: async (data: { domain: string; name: string; plan: string; status: string }) => {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create tenant");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setAddTenantOpen(false);
      setNewTenant({ domain: "", name: "", plan: "trial", status: "active" });
    },
  });

  const deleteTenantMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const response = await fetch(`/api/tenants/${tenantId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete tenant");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setEditDialogOpen(false);
      setSelectedTenant(null);
    },
  });

  const { data: blockedDomains = [] } = useQuery<BlockedDomain[]>({
    queryKey: ["/api/admin/domain-blocklist"],
    queryFn: async () => {
      const response = await fetch("/api/admin/domain-blocklist", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch blocklist");
      return response.json();
    },
  });

  const addBlockedDomainMutation = useMutation({
    mutationFn: async ({ domain, reason }: { domain: string; reason: string }) => {
      const response = await fetch("/api/admin/domain-blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain, reason: reason || null }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add domain");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domain-blocklist"] });
      setNewBlockedDomain("");
      setNewBlockedReason("");
    },
  });

  const removeBlockedDomainMutation = useMutation({
    mutationFn: async (domain: string) => {
      const response = await fetch(`/api/admin/domain-blocklist/${encodeURIComponent(domain)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to remove domain");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domain-blocklist"] });
    },
  });

  const { data: globalDocuments = [] } = useQuery<GlobalDocument[]>({
    queryKey: ["/api/admin/global-documents"],
    queryFn: async () => {
      const response = await fetch("/api/admin/global-documents", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch global documents");
      return response.json();
    },
  });

  const uploadGlobalDocMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; category: string; content: string; fileUrl?: string; originalFileName?: string; fileSize?: number }) => {
      const response = await fetch("/api/admin/global-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          category: data.category,
          content: data.content,
          fileType: data.originalFileName ? (data.originalFileName.endsWith(".pdf") ? "pdf" : data.originalFileName.endsWith(".docx") ? "docx" : "txt") : "txt",
          originalFileName: data.originalFileName || `${data.name}.txt`,
          fileUrl: data.fileUrl || null,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload document");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/global-documents"] });
      setGlobalDocDialogOpen(false);
      setNewGlobalDoc({ name: "", description: "", category: "brand_voice", content: "" });
      setUploadedGlobalDocFile(null);
      pendingGlobalDocPathRef.current = null;
    },
  });

  const toggleGlobalDocMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const response = await fetch(`/api/admin/global-documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
      if (!response.ok) throw new Error("Failed to update document");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/global-documents"] });
    },
  });

  const deleteGlobalDocMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/global-documents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete document");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/global-documents"] });
    },
  });

  const { data: servicePlans = [] } = useQuery<ServicePlan[]>({
    queryKey: ["/api/admin/service-plans"],
    queryFn: async () => {
      const response = await fetch("/api/admin/service-plans", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch service plans");
      return response.json();
    },
  });

  // Scheduled Jobs queries
  const { data: jobStatus, refetch: refetchJobStatus } = useQuery<Record<string, JobStatusInfo>>({
    queryKey: ["/api/admin/jobs/status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/jobs/status", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch job status");
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: jobHistory = [], refetch: refetchJobHistory } = useQuery<ScheduledJobRun[]>({
    queryKey: ["/api/admin/jobs/history"],
    queryFn: async () => {
      const response = await fetch("/api/admin/jobs/history?limit=50", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch job history");
      return response.json();
    },
  });

  const resetStuckJobsMutation = useMutation({
    mutationFn: async (jobType?: string) => {
      const response = await fetch("/api/admin/jobs/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jobType }),
      });
      if (!response.ok) throw new Error("Failed to reset jobs");
      return response.json();
    },
    onSuccess: () => {
      refetchJobStatus();
    },
  });

  const createServicePlanMutation = useMutation({
    mutationFn: async (data: Partial<ServicePlan>) => {
      const response = await fetch("/api/admin/service-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create plan");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/service-plans"] });
      setServicePlanDialogOpen(false);
      resetPlanForm();
    },
  });

  const updateServicePlanMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServicePlan> }) => {
      const response = await fetch(`/api/admin/service-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update plan");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/service-plans"] });
      setServicePlanDialogOpen(false);
      setEditingPlan(null);
      resetPlanForm();
    },
  });

  const deleteServicePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/service-plans/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete plan");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/service-plans"] });
    },
  });

  const resetPlanForm = () => {
    setPlanForm({
      name: "",
      displayName: "",
      description: "",
      competitorLimit: 3,
      analysisLimit: 5,
      adminUserLimit: 1,
      readWriteUserLimit: 2,
      readOnlyUserLimit: 5,
      multiMarketEnabled: false,
      marketLimit: null,
      socialMonitoringEnabled: false,
      websiteMonitorEnabled: false,
      productMonitorEnabled: false,
      trialDays: null,
      monthlyPrice: null,
      annualPrice: null,
      isActive: true,
      isDefault: false,
      sortOrder: 0,
    });
  };

  const openEditPlanDialog = (plan: ServicePlan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name,
      displayName: plan.displayName,
      description: plan.description || "",
      competitorLimit: plan.competitorLimit,
      analysisLimit: plan.analysisLimit,
      adminUserLimit: plan.adminUserLimit,
      readWriteUserLimit: plan.readWriteUserLimit,
      readOnlyUserLimit: plan.readOnlyUserLimit,
      multiMarketEnabled: plan.multiMarketEnabled,
      marketLimit: plan.marketLimit,
      socialMonitoringEnabled: plan.socialMonitoringEnabled || false,
      websiteMonitorEnabled: plan.websiteMonitorEnabled || false,
      productMonitorEnabled: plan.productMonitorEnabled || false,
      trialDays: plan.trialDays,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      isActive: plan.isActive,
      isDefault: plan.isDefault,
      sortOrder: plan.sortOrder,
    });
    setServicePlanDialogOpen(true);
  };

  const handleSavePlan = () => {
    if (editingPlan) {
      updateServicePlanMutation.mutate({ id: editingPlan.id, data: planForm });
    } else {
      createServicePlanMutation.mutate(planForm);
    }
  };

  const getPlanBadge = (plan: string) => {
    switch (plan) {
      case "enterprise":
        return <Badge className="bg-gradient-to-r from-purple-500 to-pink-500">Enterprise</Badge>;
      case "pro":
        return <Badge className="bg-primary">Pro</Badge>;
      case "trial":
        return <Badge className="bg-amber-500">Trial</Badge>;
      case "free":
        return <Badge variant="outline">Free</Badge>;
      default:
        return <Badge variant="outline">{plan}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>;
      case "suspended":
        return <Badge variant="destructive">Suspended</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleEditClick = (tenant: TenantWithCounts) => {
    setSelectedTenant(tenant);
    setEditForm({
      domain: tenant.domain,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      competitorLimit: tenant.competitorLimit,
      analysisLimit: tenant.analysisLimit,
      adminUserLimit: (tenant as any).adminUserLimit ?? 1,
      readWriteUserLimit: (tenant as any).readWriteUserLimit ?? 2,
      readOnlyUserLimit: (tenant as any).readOnlyUserLimit ?? 5,
      multiMarketEnabled: (tenant as any).multiMarketEnabled ?? false,
      marketLimit: (tenant as any).marketLimit ?? null,
      logoUrl: tenant.logoUrl || "",
      faviconUrl: tenant.faviconUrl || "",
      primaryColor: tenant.primaryColor || "#810FFB",
      secondaryColor: tenant.secondaryColor || "#E60CB3",
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTenant) return;
    
    const changedFields: Partial<Tenant> = {};
    if (editForm.domain !== selectedTenant.domain && editForm.domain.trim()) {
      changedFields.domain = editForm.domain.trim().toLowerCase();
    }
    if (editForm.name !== selectedTenant.name && editForm.name.trim()) {
      changedFields.name = editForm.name.trim();
    }
    if (editForm.plan !== selectedTenant.plan && editForm.plan) {
      changedFields.plan = editForm.plan;
    }
    if (editForm.status !== selectedTenant.status && editForm.status) {
      changedFields.status = editForm.status;
    }
    if (editForm.logoUrl !== (selectedTenant.logoUrl || "")) {
      changedFields.logoUrl = editForm.logoUrl || null;
    }
    if (editForm.faviconUrl !== (selectedTenant.faviconUrl || "")) {
      changedFields.faviconUrl = editForm.faviconUrl || null;
    }
    if (editForm.primaryColor !== (selectedTenant.primaryColor || "#810FFB")) {
      changedFields.primaryColor = editForm.primaryColor;
    }
    if (editForm.secondaryColor !== (selectedTenant.secondaryColor || "#E60CB3")) {
      changedFields.secondaryColor = editForm.secondaryColor;
    }
    if (editForm.multiMarketEnabled !== ((selectedTenant as any).multiMarketEnabled ?? false)) {
      (changedFields as any).multiMarketEnabled = editForm.multiMarketEnabled;
    }
    if (editForm.marketLimit !== ((selectedTenant as any).marketLimit ?? null)) {
      (changedFields as any).marketLimit = editForm.marketLimit;
    }

    if (Object.keys(changedFields).length === 0) {
      setEditDialogOpen(false);
      return;
    }

    updateTenantMutation.mutate({
      id: selectedTenant.id,
      data: changedFields,
    });
  };

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

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading tenants...</p>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <p className="text-destructive mb-2">{(error as Error).message}</p>
        </div>
      </AppLayout>
    );
  }

  const totalUsers = tenants.reduce((sum, t) => sum + t.actualUserCount, 0);
  const activeTenants = tenants.filter(t => t.status === "active").length;
  const proTenants = tenants.filter(t => t.plan === "pro" || t.plan === "enterprise").length;

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="admin-page">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Crown className="h-8 w-8 text-yellow-500" />
            Global Admin Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage all tenants across the Orbit platform
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Tenants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {tenants.length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Tenants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{activeTenants}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                {totalUsers}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Paid Plans</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{proTenants}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>All Tenants</CardTitle>
              <CardDescription>
                View and manage organizations using Orbit
              </CardDescription>
            </div>
            <Dialog open={addTenantOpen} onOpenChange={setAddTenantOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-tenant">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Tenant
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Tenant</DialogTitle>
                  <DialogDescription>
                    Create a new organization. Users will be able to register with the specified domain.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="tenant-domain">Domain *</Label>
                    <Input
                      id="tenant-domain"
                      placeholder="company.com"
                      value={newTenant.domain}
                      onChange={(e) => setNewTenant({ ...newTenant, domain: e.target.value })}
                      data-testid="input-tenant-domain"
                    />
                    <p className="text-xs text-muted-foreground">
                      Users with this email domain will belong to this tenant
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-name">Organization Name</Label>
                    <Input
                      id="tenant-name"
                      placeholder="Company Inc."
                      value={newTenant.name}
                      onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                      data-testid="input-tenant-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="tenant-plan">Plan</Label>
                      <Select
                        value={newTenant.plan}
                        onValueChange={(value) => setNewTenant({ ...newTenant, plan: value })}
                      >
                        <SelectTrigger data-testid="select-tenant-plan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="trial">Trial</SelectItem>
                          <SelectItem value="free">Free</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tenant-status">Status</Label>
                      <Select
                        value={newTenant.status}
                        onValueChange={(value) => setNewTenant({ ...newTenant, status: value })}
                      >
                        <SelectTrigger data-testid="select-tenant-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddTenantOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createTenantMutation.mutate(newTenant)}
                    disabled={!newTenant.domain || createTenantMutation.isPending}
                    data-testid="button-create-tenant"
                  >
                    {createTenantMutation.isPending ? "Creating..." : "Create Tenant"}
                  </Button>
                </DialogFooter>
                {createTenantMutation.isError && (
                  <p className="text-sm text-destructive mt-2">
                    {createTenantMutation.error.message}
                  </p>
                )}
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {tenants.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No tenants yet. Tenants are created automatically when users register.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Users</TableHead>
                    <TableHead className="text-center">Limits</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.id} data-testid={`tenant-row-${tenant.id}`}>
                      <TableCell className="font-medium">{tenant.name}</TableCell>
                      <TableCell className="text-muted-foreground">{tenant.domain}</TableCell>
                      <TableCell>{getPlanBadge(tenant.plan)}</TableCell>
                      <TableCell>{getStatusBadge(tenant.status)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{tenant.actualUserCount}</Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {tenant.competitorLimit} comp / {tenant.analysisLimit} analysis
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(tenant)}
                          data-testid={`edit-tenant-${tenant.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Domain Blocklist
            </CardTitle>
            <CardDescription>
              Prevent users from these domains from self-registering and creating new tenants
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="domain.com"
                value={newBlockedDomain}
                onChange={(e) => setNewBlockedDomain(e.target.value)}
                className="max-w-xs"
                data-testid="input-blocked-domain"
              />
              <Input
                placeholder="Reason (optional)"
                value={newBlockedReason}
                onChange={(e) => setNewBlockedReason(e.target.value)}
                className="flex-1"
                data-testid="input-blocked-reason"
              />
              <Button
                onClick={() => {
                  if (newBlockedDomain.trim()) {
                    addBlockedDomainMutation.mutate({
                      domain: newBlockedDomain.trim(),
                      reason: newBlockedReason.trim(),
                    });
                  }
                }}
                disabled={!newBlockedDomain.trim() || addBlockedDomainMutation.isPending}
                data-testid="btn-add-blocked-domain"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>

            {addBlockedDomainMutation.isError && (
              <p className="text-sm text-destructive">
                {(addBlockedDomainMutation.error as Error).message}
              </p>
            )}

            {blockedDomains.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">
                No domains blocked. Add domains above to prevent self-registration.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blockedDomains.map((entry) => (
                    <TableRow key={entry.id} data-testid={`blocked-domain-${entry.domain}`}>
                      <TableCell className="font-medium">{entry.domain}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.reason || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBlockedDomainMutation.mutate(entry.domain)}
                          disabled={removeBlockedDomainMutation.isPending}
                          data-testid={`remove-blocked-${entry.domain}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-service-plans">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Service Plans
                </CardTitle>
                <CardDescription>
                  Define subscription plans with their limits and features
                </CardDescription>
              </div>
              <Button 
                onClick={() => {
                  setEditingPlan(null);
                  resetPlanForm();
                  setServicePlanDialogOpen(true);
                }}
                data-testid="btn-add-service-plan"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Plan
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {servicePlans.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No service plans defined yet.</p>
                <p className="text-sm">Create plans to define subscription tiers and limits.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Limits</TableHead>
                    <TableHead>Multi-Market</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servicePlans.map((plan) => (
                    <TableRow key={plan.id} data-testid={`service-plan-${plan.name}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {plan.displayName}
                              {plan.isDefault && (
                                <Badge variant="outline" className="text-xs">Default</Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">{plan.name}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm space-y-1">
                          <div>{plan.competitorLimit} competitors, {plan.analysisLimit} analyses</div>
                          <div className="text-muted-foreground">
                            Users: {plan.adminUserLimit}A / {plan.readWriteUserLimit}RW / {plan.readOnlyUserLimit}RO
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {plan.multiMarketEnabled ? (
                          <div className="flex items-center gap-1 text-green-500">
                            <Check className="h-4 w-4" />
                            <span className="text-sm">{plan.marketLimit === null ? "Unlimited" : `${plan.marketLimit} markets`}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Disabled</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={plan.isActive ? "default" : "secondary"}>
                          {plan.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditPlanDialog(plan)}
                            data-testid={`edit-plan-${plan.name}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteServicePlanMutation.mutate(plan.id)}
                            disabled={deleteServicePlanMutation.isPending || plan.isDefault}
                            data-testid={`delete-plan-${plan.name}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Global AI Documents
                </CardTitle>
                <CardDescription>
                  Platform-wide documents used to ground all AI analysis across tenants
                </CardDescription>
              </div>
              <Button onClick={() => setGlobalDocDialogOpen(true)} data-testid="btn-add-global-doc">
                <Upload className="h-4 w-4 mr-2" />
                Upload Document
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {globalDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No global documents yet.</p>
                <p className="text-sm">Upload documents to provide AI grounding context across all tenants.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center">Words</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {globalDocuments.map((doc) => (
                    <TableRow key={doc.id} data-testid={`global-doc-${doc.id}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{doc.name}</div>
                          <div className="text-sm text-muted-foreground">{doc.originalFileName}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {GLOBAL_DOC_CATEGORIES.find(c => c.value === doc.category)?.label || doc.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {doc.wordCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleGlobalDocMutation.mutate({ id: doc.id, isActive: !doc.isActive })}
                          data-testid={`toggle-doc-${doc.id}`}
                        >
                          {doc.isActive ? (
                            <ToggleRight className="h-5 w-5 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteGlobalDocMutation.mutate(doc.id)}
                          disabled={deleteGlobalDocMutation.isPending}
                          data-testid={`delete-global-doc-${doc.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-ai-usage">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              AI Usage Tracking
            </CardTitle>
            <CardDescription>
              Monitor AI API usage across all tenants (costs, tokens, operations)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AiUsageDashboard />
          </CardContent>
        </Card>

        {/* Scheduled Jobs */}
        <Card data-testid="card-scheduled-jobs">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Scheduled Jobs
            </CardTitle>
            <CardDescription>
              Monitor background job schedules and execution history
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Job Schedule */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Job Schedule</h3>
                <div className="flex gap-2">
                  {jobStatus && Object.values(jobStatus).some(j => j.isRunning) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetStuckJobsMutation.mutate(undefined)}
                      disabled={resetStuckJobsMutation.isPending}
                      data-testid="reset-stuck-jobs"
                      className="text-orange-600 border-orange-600 hover:bg-orange-50"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reset Stuck
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      refetchJobStatus();
                      refetchJobHistory();
                    }}
                    data-testid="refresh-jobs"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </div>
              {jobStatus && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(jobStatus).map(([key, job]) => (
                    <div
                      key={key}
                      className="border rounded-lg p-3 bg-muted/30"
                      data-testid={`job-status-${key}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">
                          {JOB_TYPE_LABELS[key] || key}
                        </span>
                        {job.isRunning ? (
                          <Badge variant="default" className="bg-blue-500">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Running
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Idle</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{job.description}</p>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Interval:</span>
                          <span>{job.interval}</span>
                        </div>
                        {job.lastRun && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Last run:</span>
                            <span>{new Date(job.lastRun).toLocaleString()}</span>
                          </div>
                        )}
                        {job.nextRun && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Next run:</span>
                            <span>{new Date(job.nextRun).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Job History */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Recent Job Runs</h3>
                <div className="flex items-center gap-2">
                  <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
                    <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-job-type">
                      <SelectValue placeholder="Job Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
                    <SelectTrigger className="w-[120px] h-8 text-xs" data-testid="filter-job-status">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="running">Running</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input 
                    placeholder="Search target..." 
                    value={jobTargetFilter}
                    onChange={(e) => setJobTargetFilter(e.target.value)}
                    className="w-[150px] h-8 text-xs"
                    data-testid="filter-job-target"
                  />
                  {(jobTypeFilter !== "all" || jobStatusFilter !== "all" || jobTargetFilter) && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2 text-xs"
                      onClick={() => {
                        setJobTypeFilter("all");
                        setJobStatusFilter("all");
                        setJobTargetFilter("");
                      }}
                      data-testid="clear-job-filters"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              {(() => {
                const filteredJobs = jobHistory.filter((run) => {
                  if (jobTypeFilter !== "all" && run.jobType !== jobTypeFilter) return false;
                  if (jobStatusFilter !== "all" && run.status !== jobStatusFilter) return false;
                  if (jobTargetFilter) {
                    const target = (run.targetName || run.tenantDomain || "").toLowerCase();
                    if (!target.includes(jobTargetFilter.toLowerCase())) return false;
                  }
                  return true;
                });
                const hasFilters = jobTypeFilter !== "all" || jobStatusFilter !== "all" || jobTargetFilter;
                
                if (jobHistory.length === 0) {
                  return <p className="text-sm text-muted-foreground">No job runs recorded yet.</p>;
                }
                
                if (filteredJobs.length === 0 && hasFilters) {
                  return (
                    <div className="border rounded-lg p-6 text-center">
                      <p className="text-sm text-muted-foreground">No job runs match the current filters.</p>
                    </div>
                  );
                }
                
                return (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job Type</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredJobs.slice(0, 50).map((run) => {
                        const duration = run.startedAt && run.completedAt
                          ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                          : null;
                        const resultDetails = run.result ? (
                          run.jobType === "websiteCrawl" && run.result.pagesCrawled
                            ? `${run.result.pagesCrawled} pages, ${run.result.totalWordCount?.toLocaleString() || 0} words`
                            : run.jobType === "socialMonitor"
                            ? `${run.result.entityType || "entity"}`
                            : run.jobType === "websiteMonitor"
                            ? `${run.result.entityType || "entity"}`
                            : run.result.status || "-"
                        ) : run.errorMessage
                          ? run.errorMessage.substring(0, 50)
                          : "-";
                        return (
                          <TableRow key={run.id} data-testid={`job-run-${run.id}`}>
                            <TableCell className="font-medium">
                              {JOB_TYPE_LABELS[run.jobType] || run.jobType}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div>
                                {run.targetName || "-"}
                                {run.tenantDomain && (
                                  <div className="text-xs text-muted-foreground">
                                    {run.tenantDomain}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {run.status === "completed" ? (
                                <Badge variant="outline" className="text-green-600 border-green-600">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Completed
                                </Badge>
                              ) : run.status === "failed" ? (
                                <Badge variant="outline" className="text-red-600 border-red-600">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Failed
                                </Badge>
                              ) : run.status === "running" ? (
                                <Badge variant="outline" className="text-blue-600 border-blue-600">
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Running
                                </Badge>
                              ) : (
                                <Badge variant="secondary">{run.status}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={typeof resultDetails === 'string' ? resultDetails : undefined}>
                              {resultDetails}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {run.startedAt ? new Date(run.startedAt).toLocaleString() : "-"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {duration !== null ? `${duration}s` : "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        <Dialog open={servicePlanDialogOpen} onOpenChange={(open) => {
          setServicePlanDialogOpen(open);
          if (!open) {
            setEditingPlan(null);
            resetPlanForm();
          }
        }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPlan ? "Edit Service Plan" : "Create Service Plan"}</DialogTitle>
              <DialogDescription>
                Define the limits and features for this subscription tier.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan Name (ID)</Label>
                  <Input
                    placeholder="e.g., enterprise"
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                    disabled={!!editingPlan}
                    data-testid="input-plan-name"
                  />
                  <p className="text-xs text-muted-foreground">Lowercase, no spaces</p>
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    placeholder="e.g., Enterprise"
                    value={planForm.displayName}
                    onChange={(e) => setPlanForm({ ...planForm, displayName: e.target.value })}
                    data-testid="input-plan-display-name"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Brief description of this plan..."
                  value={planForm.description}
                  onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                  data-testid="input-plan-description"
                />
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-medium">Usage Limits</Label>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Competitors</Label>
                    <Input
                      type="number"
                      min={0}
                      value={planForm.competitorLimit}
                      onChange={(e) => setPlanForm({ ...planForm, competitorLimit: parseInt(e.target.value) || 0 })}
                      data-testid="input-plan-competitors"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Analyses</Label>
                    <Input
                      type="number"
                      min={0}
                      value={planForm.analysisLimit}
                      onChange={(e) => setPlanForm({ ...planForm, analysisLimit: parseInt(e.target.value) || 0 })}
                      data-testid="input-plan-analyses"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-medium">User Limits</Label>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Admin Users</Label>
                    <Input
                      type="number"
                      min={1}
                      value={planForm.adminUserLimit}
                      onChange={(e) => setPlanForm({ ...planForm, adminUserLimit: parseInt(e.target.value) || 1 })}
                      data-testid="input-plan-admin-users"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Read/Write Users</Label>
                    <Input
                      type="number"
                      min={0}
                      value={planForm.readWriteUserLimit}
                      onChange={(e) => setPlanForm({ ...planForm, readWriteUserLimit: parseInt(e.target.value) || 0 })}
                      data-testid="input-plan-rw-users"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Read-Only Users</Label>
                    <Input
                      type="number"
                      min={0}
                      value={planForm.readOnlyUserLimit}
                      onChange={(e) => setPlanForm({ ...planForm, readOnlyUserLimit: parseInt(e.target.value) || 0 })}
                      data-testid="input-plan-ro-users"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-medium">Multi-Market Settings</Label>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Multi-Market</Label>
                    <Select
                      value={planForm.multiMarketEnabled ? "true" : "false"}
                      onValueChange={(value) => setPlanForm({ ...planForm, multiMarketEnabled: value === "true" })}
                    >
                      <SelectTrigger data-testid="select-plan-multi-market">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">Disabled</SelectItem>
                        <SelectItem value="true">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Market Limit</Label>
                    <Select
                      value={planForm.marketLimit === null ? "unlimited" : String(planForm.marketLimit)}
                      onValueChange={(value) => setPlanForm({ 
                        ...planForm, 
                        marketLimit: value === "unlimited" ? null : parseInt(value) 
                      })}
                      disabled={!planForm.multiMarketEnabled}
                    >
                      <SelectTrigger data-testid="select-plan-market-limit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unlimited">Unlimited</SelectItem>
                        <SelectItem value="1">1 market</SelectItem>
                        <SelectItem value="5">5 markets</SelectItem>
                        <SelectItem value="10">10 markets</SelectItem>
                        <SelectItem value="25">25 markets</SelectItem>
                        <SelectItem value="50">50 markets</SelectItem>
                        <SelectItem value="100">100 markets</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-medium">Monitoring Features</Label>
                <p className="text-xs text-muted-foreground mb-2">Control which automated monitoring features are available for this plan</p>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Social Monitoring</Label>
                    <Select
                      value={planForm.socialMonitoringEnabled ? "true" : "false"}
                      onValueChange={(value) => setPlanForm({ ...planForm, socialMonitoringEnabled: value === "true" })}
                    >
                      <SelectTrigger data-testid="select-plan-social-monitoring">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">Disabled</SelectItem>
                        <SelectItem value="true">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Website Monitor</Label>
                    <Select
                      value={planForm.websiteMonitorEnabled ? "true" : "false"}
                      onValueChange={(value) => setPlanForm({ ...planForm, websiteMonitorEnabled: value === "true" })}
                    >
                      <SelectTrigger data-testid="select-plan-website-monitoring">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">Disabled</SelectItem>
                        <SelectItem value="true">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Product Monitor</Label>
                    <Select
                      value={planForm.productMonitorEnabled ? "true" : "false"}
                      onValueChange={(value) => setPlanForm({ ...planForm, productMonitorEnabled: value === "true" })}
                    >
                      <SelectTrigger data-testid="select-plan-product-monitoring">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">Disabled</SelectItem>
                        <SelectItem value="true">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Sort Order</Label>
                    <Input
                      type="number"
                      min={0}
                      value={planForm.sortOrder}
                      onChange={(e) => setPlanForm({ ...planForm, sortOrder: parseInt(e.target.value) || 0 })}
                      data-testid="input-plan-sort-order"
                    />
                  </div>
                  <div className="space-y-2 flex items-end gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={planForm.isActive}
                        onChange={(e) => setPlanForm({ ...planForm, isActive: e.target.checked })}
                        data-testid="checkbox-plan-active"
                      />
                      <span className="text-sm">Active</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={planForm.isDefault}
                        onChange={(e) => setPlanForm({ ...planForm, isDefault: e.target.checked })}
                        data-testid="checkbox-plan-default"
                      />
                      <span className="text-sm">Default</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setServicePlanDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSavePlan}
                disabled={!planForm.name || !planForm.displayName || createServicePlanMutation.isPending || updateServicePlanMutation.isPending}
                data-testid="btn-save-plan"
              >
                {createServicePlanMutation.isPending || updateServicePlanMutation.isPending ? "Saving..." : (editingPlan ? "Update Plan" : "Create Plan")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={globalDocDialogOpen} onOpenChange={setGlobalDocDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Global Document</DialogTitle>
              <DialogDescription>
                This document will be used to ground AI analysis across all tenants.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Document Name</Label>
                <Input
                  placeholder="e.g., Brand Voice Guidelines"
                  value={newGlobalDoc.name}
                  onChange={(e) => setNewGlobalDoc({ ...newGlobalDoc, name: e.target.value })}
                  data-testid="input-global-doc-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={newGlobalDoc.category}
                  onValueChange={(value) => setNewGlobalDoc({ ...newGlobalDoc, category: value })}
                >
                  <SelectTrigger data-testid="select-global-doc-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GLOBAL_DOC_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description (Optional)</Label>
                <Textarea
                  placeholder="Brief description of this document's purpose..."
                  value={newGlobalDoc.description}
                  onChange={(e) => setNewGlobalDoc({ ...newGlobalDoc, description: e.target.value })}
                  data-testid="input-global-doc-description"
                />
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <div className="flex items-center gap-2 mb-2">
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    maxFileSize={20 * 1024 * 1024}
                    onGetUploadParameters={async (file) => {
                      const res = await fetch("/api/uploads/request-url", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: file.name,
                          size: file.size,
                          contentType: file.type,
                        }),
                        credentials: "include",
                      });
                      const { uploadURL, objectPath } = await res.json();
                      pendingGlobalDocPathRef.current = objectPath;
                      return {
                        method: "PUT" as const,
                        url: uploadURL,
                        headers: { "Content-Type": file.type || "application/octet-stream" },
                      };
                    }}
                    onComplete={async (result) => {
                      const file = result.successful?.[0];
                      if (file && pendingGlobalDocPathRef.current) {
                        setUploadedGlobalDocFile({
                          name: file.name ?? "unknown",
                          url: pendingGlobalDocPathRef.current,
                          size: file.size ?? 0,
                        });
                        setIsExtractingText(true);
                        try {
                          const res = await fetch("/api/documents/extract-text", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({
                              fileUrl: pendingGlobalDocPathRef.current,
                              fileType: file.name?.endsWith(".pdf") ? "pdf" : file.name?.endsWith(".docx") ? "docx" : "txt",
                            }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setNewGlobalDoc(prev => ({ ...prev, content: data.text || "" }));
                          }
                        } catch (err) {
                          console.error("Text extraction failed:", err);
                        } finally {
                          setIsExtractingText(false);
                        }
                      }
                    }}
                    buttonClassName=""
                  >
                    <Upload className="w-4 h-4 mr-2" /> Upload File (.txt, .md, .json, .pdf, .docx)
                  </ObjectUploader>
                  {uploadedGlobalDocFile && (
                    <span className="text-xs text-muted-foreground">{uploadedGlobalDocFile.name}</span>
                  )}
                </div>
                <Textarea
                  placeholder="Enter the grounding document content here. This will be provided to the AI as context for generating responses..."
                  value={newGlobalDoc.content}
                  onChange={(e) => setNewGlobalDoc({ ...newGlobalDoc, content: e.target.value })}
                  rows={8}
                  disabled={isExtractingText}
                  data-testid="input-global-doc-content"
                />
                {isExtractingText && (
                  <p className="text-xs text-muted-foreground">Extracting text from file...</p>
                )}
              </div>
              {uploadGlobalDocMutation.isError && (
                <p className="text-sm text-destructive">
                  {(uploadGlobalDocMutation.error as Error).message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setGlobalDocDialogOpen(false);
                setNewGlobalDoc({ name: "", description: "", category: "brand_voice", content: "" });
                setUploadedGlobalDocFile(null);
                pendingGlobalDocPathRef.current = null;
              }}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (newGlobalDoc.name && newGlobalDoc.content) {
                    uploadGlobalDocMutation.mutate({
                      name: newGlobalDoc.name,
                      description: newGlobalDoc.description,
                      category: newGlobalDoc.category,
                      content: newGlobalDoc.content,
                      fileUrl: uploadedGlobalDocFile?.url,
                      originalFileName: uploadedGlobalDocFile?.name,
                      fileSize: uploadedGlobalDocFile?.size,
                    });
                  }
                }}
                disabled={!newGlobalDoc.name || !newGlobalDoc.content || uploadGlobalDocMutation.isPending}
                data-testid="btn-submit-global-doc"
              >
                {uploadGlobalDocMutation.isPending ? "Saving..." : "Upload Document"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Tenant</DialogTitle>
              <DialogDescription>
                Update settings and branding for {selectedTenant?.domain}
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue="settings" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
                <TabsTrigger value="branding" data-testid="tab-branding">
                  <Palette className="h-4 w-4 mr-2" />
                  Branding
                </TabsTrigger>
              </TabsList>
              <TabsContent value="settings" className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Domain</Label>
                  <Input
                    value={editForm.domain}
                    onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                    placeholder="company.com"
                    data-testid="edit-tenant-domain"
                  />
                  <p className="text-xs text-muted-foreground">
                    Users with this email domain will belong to this tenant
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Organization Name</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    data-testid="edit-tenant-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Select
                      value={editForm.plan}
                      onValueChange={(value) => {
                        const selectedPlan = servicePlans.find(p => p.name === value);
                        if (selectedPlan) {
                          setEditForm({ 
                            ...editForm, 
                            plan: value,
                            competitorLimit: selectedPlan.competitorLimit,
                            analysisLimit: selectedPlan.analysisLimit,
                            adminUserLimit: selectedPlan.adminUserLimit,
                            readWriteUserLimit: selectedPlan.readWriteUserLimit,
                            readOnlyUserLimit: selectedPlan.readOnlyUserLimit,
                            multiMarketEnabled: selectedPlan.multiMarketEnabled,
                            marketLimit: selectedPlan.marketLimit,
                          });
                        }
                      }}
                    >
                      <SelectTrigger data-testid="edit-tenant-plan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {servicePlans.filter(p => p.isActive).map((plan) => (
                          <SelectItem key={plan.id} value={plan.name}>
                            {plan.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={editForm.status}
                      onValueChange={(value) => setEditForm({ ...editForm, status: value })}
                    >
                      <SelectTrigger data-testid="edit-tenant-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2 pt-2">
                  <Label className="text-sm font-medium">Plan Limits</Label>
                  <p className="text-xs text-muted-foreground mb-2">These limits are determined by the selected plan and cannot be edited directly</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Competitor Limit</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-competitor-limit">
                        {editForm.competitorLimit} competitors
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Analysis Limit</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-analysis-limit">
                        {editForm.analysisLimit} AI analyses/month
                      </div>
                      <p className="text-[10px] text-muted-foreground">Max number of AI-powered analyses per month</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Admin Users</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-admin-limit">
                        {editForm.adminUserLimit}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Read-Write Users</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-rw-limit">
                        {editForm.readWriteUserLimit}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Read-Only Users</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-ro-limit">
                        {editForm.readOnlyUserLimit}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 pt-4 border-t">
                  <Label className="text-sm font-medium">Multi-Market Settings</Label>
                  <p className="text-xs text-muted-foreground mb-2">Enterprise feature - controlled by service plan</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Multi-Market</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-multi-market">
                        {editForm.multiMarketEnabled ? "Enabled" : "Disabled"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Market Limit</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm" data-testid="display-tenant-market-limit">
                        {editForm.marketLimit === null ? "Unlimited" : `${editForm.marketLimit} markets`}
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="branding" className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Logo URL</Label>
                  <Input
                    placeholder="https://example.com/logo.png"
                    value={editForm.logoUrl}
                    onChange={(e) => setEditForm({ ...editForm, logoUrl: e.target.value })}
                    data-testid="edit-tenant-logo"
                  />
                  <p className="text-xs text-muted-foreground">Used in reports and app header</p>
                </div>
                <div className="space-y-2">
                  <Label>Favicon URL</Label>
                  <Input
                    placeholder="https://example.com/favicon.ico"
                    value={editForm.faviconUrl}
                    onChange={(e) => setEditForm({ ...editForm, faviconUrl: e.target.value })}
                    data-testid="edit-tenant-favicon"
                  />
                  <p className="text-xs text-muted-foreground">Browser tab icon</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Primary Color</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={editForm.primaryColor}
                        onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })}
                        className="w-12 h-10 p-1 cursor-pointer"
                        data-testid="edit-tenant-primary-color"
                      />
                      <Input
                        value={editForm.primaryColor}
                        onChange={(e) => setEditForm({ ...editForm, primaryColor: e.target.value })}
                        placeholder="#810FFB"
                        className="flex-1"
                        data-testid="edit-tenant-primary-color-text"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Secondary Color</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={editForm.secondaryColor}
                        onChange={(e) => setEditForm({ ...editForm, secondaryColor: e.target.value })}
                        className="w-12 h-10 p-1 cursor-pointer"
                        data-testid="edit-tenant-secondary-color"
                      />
                      <Input
                        value={editForm.secondaryColor}
                        onChange={(e) => setEditForm({ ...editForm, secondaryColor: e.target.value })}
                        placeholder="#E60CB3"
                        className="flex-1"
                        data-testid="edit-tenant-secondary-color-text"
                      />
                    </div>
                  </div>
                </div>
                {editForm.logoUrl && (
                  <div className="space-y-2">
                    <Label>Logo Preview</Label>
                    <div className="border rounded-md p-4 bg-muted/50">
                      <img 
                        src={editForm.logoUrl} 
                        alt="Logo preview" 
                        className="max-h-16 object-contain"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Color Preview</Label>
                  <div className="flex gap-4 p-4 border rounded-md bg-muted/50">
                    <div className="flex flex-col items-center gap-1">
                      <div 
                        className="w-12 h-12 rounded-md shadow-sm" 
                        style={{ backgroundColor: editForm.primaryColor }}
                      />
                      <span className="text-xs text-muted-foreground">Primary</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div 
                        className="w-12 h-12 rounded-md shadow-sm" 
                        style={{ backgroundColor: editForm.secondaryColor }}
                      />
                      <span className="text-xs text-muted-foreground">Secondary</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div 
                        className="w-12 h-12 rounded-md shadow-sm" 
                        style={{ background: `linear-gradient(135deg, ${editForm.primaryColor}, ${editForm.secondaryColor})` }}
                      />
                      <span className="text-xs text-muted-foreground">Gradient</span>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
            <DialogFooter className="flex justify-between sm:justify-between">
              <Button
                variant="destructive"
                onClick={() => {
                  if (selectedTenant && confirm(`Are you sure you want to delete the tenant "${selectedTenant.name}"? This will permanently delete all users, competitors, analyses, and other data associated with this tenant. This action cannot be undone.`)) {
                    deleteTenantMutation.mutate(selectedTenant.id);
                  }
                }}
                disabled={deleteTenantMutation.isPending || updateTenantMutation.isPending}
                data-testid="delete-tenant"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deleteTenantMutation.isPending ? "Deleting..." : "Delete Tenant"}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={updateTenantMutation.isPending || deleteTenantMutation.isPending}
                  data-testid="save-tenant-edit"
                >
                  {updateTenantMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </DialogFooter>
            {deleteTenantMutation.isError && (
              <p className="text-sm text-destructive mt-2">
                {deleteTenantMutation.error.message}
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
