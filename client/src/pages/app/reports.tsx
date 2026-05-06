import React, { useState, useEffect } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Clock, Building2, Briefcase, Sparkles, Swords, Activity, Target, BarChart2, Lightbulb, Zap, CheckCircle2, Info, Trash2, Megaphone, MessageSquareText, Handshake, Loader2, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getTimeAgo, calculateStaleness, checkArtifactFreshness, formatShortDate } from "@/lib/staleness";
import { RefreshCw } from "lucide-react";
import EmptyPageState from "@/components/EmptyPageState";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { useJobStatus, jobStatusLabel } from "@/hooks/use-job-status";

type ReportSections = {
  executiveSummary: boolean;
  companyBaseline: boolean;
  competitorProfiles: boolean;
  gapAnalysis: boolean;
  recommendations: boolean;
  battleCards: boolean;
  activityLog: boolean;
  gtmPlan: boolean;
  messagingFramework: boolean;
};

const defaultSections: ReportSections = {
  executiveSummary: true,
  companyBaseline: true,
  competitorProfiles: true,
  gapAnalysis: true,
  recommendations: true,
  battleCards: true,
  activityLog: false,
  gtmPlan: true,
  messagingFramework: true,
};

const marketingSections: ReportSections = {
  executiveSummary: true,
  companyBaseline: false,
  competitorProfiles: false,
  gapAnalysis: false,
  recommendations: false,
  battleCards: false,
  activityLog: false,
  gtmPlan: true,
  messagingFramework: true,
};

export default function Reports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState<"quick" | "capstone" | "marketing">("quick");
  const [scope, setScope] = useState<"baseline" | "project">("baseline");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [reportName, setReportName] = useState("");
  const [sections, setSections] = useState<ReportSections>(defaultSections);
  const [isGenerating, setIsGenerating] = useState(false);
  const reportJobStatus = useJobStatus("report-pdf", isGenerating);
  const reportGenLabel = jobStatusLabel(reportJobStatus, "Generating Report…");
  const [includeStrategicPlans, setIncludeStrategicPlans] = useState(false);
  const [strategicPlansTouched, setStrategicPlansTouched] = useState(false);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const response = await fetch("/api/reports", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: user } = useQuery({
    queryKey: ["/api/me"],
    queryFn: async () => {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";

  const { data: tenantInfo, isLoading: tenantLoading } = useQuery<{ plan: string; isPremium: boolean; features?: any }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return { plan: "trial", isPremium: false };
      return response.json();
    },
  });

  const pdfReportsAllowed = tenantInfo?.features?.pdfReports !== false;
  const relationshipReportsAllowed = tenantInfo?.features?.relationshipReports !== false;

  // ===== Relationship Report state =====
  const [relCompetitorId, setRelCompetitorId] = useState<string>("");
  const [relPosture, setRelPosture] = useState<string>("");
  const [relGuidance, setRelGuidance] = useState<string>("");

  type RelationshipReport = {
    id: string;
    name: string;
    competitorId: string | null;
    targetName: string;
    targetUrl: string | null;
    content: string | null;
    status: string;
    lastGeneratedAt: string | null;
    generatedFromDataAsOf: string | null;
    savedPrompts?: { posture?: string | null; customGuidance?: string; lastManualEdit?: string };
    updatedAt?: string | null;
    createdAt?: string | null;
  };

  const { data: relationshipReports = [] as RelationshipReport[] } = useQuery<RelationshipReport[]>({
    queryKey: ["/api/relationship-reports"],
    queryFn: async () => {
      const response = await fetch("/api/relationship-reports", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: relationshipReportsAllowed,
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: competitors = [] as any[] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: availableContent } = useQuery<{
    hasGtmPlan: boolean;
    hasMessagingFramework: boolean;
    gtmPlanGeneratedAt?: string | null;
    messagingFrameworkGeneratedAt?: string | null;
  }>({
    queryKey: ["/api/reports/available-content"],
    queryFn: async () => {
      const response = await fetch("/api/reports/available-content", { credentials: "include" });
      if (!response.ok) return { hasGtmPlan: false, hasMessagingFramework: false };
      return response.json();
    },
  });
  const hasGtmPlan = !!availableContent?.hasGtmPlan;
  const hasMessagingFramework = !!availableContent?.hasMessagingFramework;
  const gtmPlanGeneratedAt = availableContent?.gtmPlanGeneratedAt || null;
  const messagingFrameworkGeneratedAt = availableContent?.messagingFrameworkGeneratedAt || null;
  const isStale = (date: string | null | undefined) => {
    if (!date) return false;
    const days = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
    return days > 30;
  };
  const gtmPlanStale = isStale(gtmPlanGeneratedAt);
  const messagingFrameworkStale = isStale(messagingFrameworkGeneratedAt);

  useEffect(() => {
    if (!availableContent) return;
    setSections(s => ({
      ...s,
      gtmPlan: hasGtmPlan ? s.gtmPlan : false,
      messagingFramework: hasMessagingFramework ? s.messagingFramework : false,
    }));
    if (!strategicPlansTouched) {
      setIncludeStrategicPlans(hasGtmPlan || hasMessagingFramework);
    } else if (!hasGtmPlan && !hasMessagingFramework) {
      setIncludeStrategicPlans(false);
    }
  }, [availableContent, hasGtmPlan, hasMessagingFramework, strategicPlansTouched]);

  const latestSourceDate = (() => {
    const dates = [
      companyProfile?.lastCrawledAt,
      ...competitors.map((c: any) => c.lastCrawledAt),
      ...competitors.map((c: any) => c.socialLastFetchedAt),
    ].filter(Boolean).map((d: string) => new Date(d).getTime());
    return dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
  })();

  const deleteReportMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/reports/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete report");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({
        title: "Report deleted",
        description: "The report has been removed.",
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

  const generateRelationshipMutation = useMutation({
    mutationFn: async (params: { competitorId: string; posture: string; customGuidance: string }) => {
      const body: any = { customGuidance: params.customGuidance };
      if (params.posture && params.posture !== "auto") body.posture = params.posture;
      const response = await fetch(`/api/competitors/${params.competitorId}/relationship-report/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate relationship report");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-reports"] });
      toast({
        title: "Relationship plan generated",
        description: "Your 12-month relationship plan is ready below.",
      });
      setRelGuidance("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteRelationshipMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/relationship-reports/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to delete report");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-reports"] });
      toast({ title: "Relationship report deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleGenerateAndDownload = async () => {
    if (scope === "project" && !selectedProjectId) {
      toast({
        title: "Select a Product",
        description: "Please select a product to generate a report for.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: reportName || (reportType === "marketing" ? "Marketing Report" : undefined),
          scope,
          projectId: scope === "project" ? selectedProjectId : undefined,
          sections: reportType === "capstone" ? sections : reportType === "marketing" ? marketingSections : undefined,
          includeStrategicPlans: reportType === "capstone" 
            ? (sections.gtmPlan || sections.messagingFramework) || undefined
            : reportType === "marketing" ? true
            : includeStrategicPlans || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate report");
      }

      const blob = await response.blob();
      const defaultName = reportType === "marketing" 
        ? `Marketing_Report_${new Date().toLocaleDateString().replace(/\//g, "-")}.pdf`
        : `Competitive_Analysis_${new Date().toLocaleDateString().replace(/\//g, "-")}.pdf`;
      const fileName = reportName 
        ? `${reportName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`
        : defaultName;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({
        title: "Report Generated",
        description: "Your report has been downloaded successfully.",
      });
      setReportName("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadReport = async (report: any) => {
    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: report.name,
          scope: report.scope || "baseline",
          projectId: report.projectId || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to download report");
      }

      const blob = await response.blob();
      const fileName = `${report.name.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Report Downloaded",
        description: "Your report has been downloaded successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading reports...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Reports</h1>
        <p className="text-muted-foreground">Generate branded competitive intelligence reports in one click.</p>
      </div>

      {!tenantLoading && !pdfReportsAllowed ? (
        <UpgradePrompt
          feature="PDF Reports"
          requiredPlan="Trial"
          description="Generate branded competitive intelligence reports in PDF format. Upgrade your plan to unlock this feature."
          className="mb-8"
        />
      ) : (
      <Card className="mb-8 border-primary/20">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Generate Report
          </CardTitle>
          <CardDescription>
            No assessment required - Orbit automatically includes all your competitive data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <Info className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              Reports include your company profile, competitors, gap analysis, and AI recommendations - all generated automatically.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div
              className={cn(
                "p-4 rounded-lg border-2 cursor-pointer transition-all",
                reportType === "quick" 
                  ? "border-primary bg-primary/5" 
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => setReportType("quick")}
              data-testid="option-quick-report"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  reportType === "quick" ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Quick Report</h3>
                  <p className="text-xs text-muted-foreground">Standard sections</p>
                </div>
                {reportType === "quick" && (
                  <CheckCircle2 className="w-5 h-5 text-primary ml-auto" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Fast, comprehensive report with all standard sections included.
              </p>
            </div>

            <div
              className={cn(
                "p-4 rounded-lg border-2 cursor-pointer transition-all",
                reportType === "marketing" 
                  ? "border-primary bg-primary/5" 
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => setReportType("marketing")}
              data-testid="option-marketing-report"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  reportType === "marketing" ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <Megaphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Marketing Report</h3>
                  <p className="text-xs text-muted-foreground">GTM & Messaging</p>
                </div>
                {reportType === "marketing" && (
                  <CheckCircle2 className="w-5 h-5 text-primary ml-auto" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Executive summary with your GTM plan and messaging framework.
              </p>
            </div>

            <div
              className={cn(
                "p-4 rounded-lg border-2 cursor-pointer transition-all",
                reportType === "capstone" 
                  ? "border-primary bg-primary/5" 
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => setReportType("capstone")}
              data-testid="option-capstone-report"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  reportType === "capstone" ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Capstone Report</h3>
                  <p className="text-xs text-muted-foreground">Customizable sections</p>
                </div>
                {reportType === "capstone" && (
                  <CheckCircle2 className="w-5 h-5 text-primary ml-auto" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Choose exactly which sections to include in your report.
              </p>
            </div>
          </div>

          {reportType === "capstone" && (
            <div className="space-y-3 p-4 rounded-lg bg-muted/30 border">
              <Label className="text-sm font-medium">Select Sections</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {[
                  { key: "executiveSummary", label: "Executive Summary", icon: Sparkles },
                  { key: "companyBaseline", label: "Company Profile", icon: Building2 },
                  { key: "competitorProfiles", label: "Competitors", icon: Target },
                  { key: "gapAnalysis", label: "Gap Analysis", icon: BarChart2 },
                  { key: "recommendations", label: "Recommendations", icon: Lightbulb },
                  { key: "battleCards", label: "Battle Cards", icon: Swords },
                  { key: "gtmPlan", label: "GTM Plan", icon: Megaphone, disabled: !hasGtmPlan, disabledReason: "Generate a GTM Plan first to include it in the report.", generatedAt: gtmPlanGeneratedAt, stale: gtmPlanStale },
                  { key: "messagingFramework", label: "Messaging Framework", icon: MessageSquareText, disabled: !hasMessagingFramework, disabledReason: "Generate a Messaging Framework first to include it in the report.", generatedAt: messagingFrameworkGeneratedAt, stale: messagingFrameworkStale },
                  { key: "activityLog", label: "Activity Log", icon: Activity },
                ].map((item: {
                  key: keyof ReportSections;
                  label: string;
                  icon: React.ComponentType<{ className?: string }>;
                  disabled?: boolean;
                  disabledReason?: string;
                  generatedAt?: string | null;
                  stale?: boolean;
                }) => {
                  const { key, label, icon: Icon, disabled, disabledReason, generatedAt, stale } = item;
                  const checked = sections[key];
                  const tile = (
                    <div
                      className={cn(
                        "flex flex-col gap-1 p-2 rounded-md transition-all text-sm",
                        disabled
                          ? "bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60"
                          : checked
                            ? "bg-primary/10 text-primary cursor-pointer"
                            : "bg-background hover:bg-muted cursor-pointer"
                      )}
                      onClick={() => {
                        if (disabled) return;
                        setSections(s => ({ ...s, [key]: !s[key] }));
                      }}
                      data-testid={`toggle-section-${key}`}
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(c) => {
                            if (disabled) return;
                            setSections(s => ({ ...s, [key]: !!c }));
                          }}
                          className="h-4 w-4"
                        />
                        <Icon className="w-3.5 h-3.5" />
                        <span className="truncate">{label}</span>
                      </div>
                      {generatedAt && !disabled && (
                        <div
                          className={cn(
                            "text-[10px] pl-6 leading-tight",
                            stale ? "text-amber-600 font-medium" : "text-muted-foreground"
                          )}
                          data-testid={`text-generated-${key}`}
                        >
                          {stale ? "Outdated · " : ""}Generated {formatShortDate(generatedAt)}
                        </div>
                      )}
                    </div>
                  );
                  if (disabled && disabledReason) {
                    return (
                      <TooltipProvider key={key} delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>{tile}</TooltipTrigger>
                          <TooltipContent>{disabledReason}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  }
                  return <React.Fragment key={key}>{tile}</React.Fragment>;
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Report Scope</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scope === "baseline" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setScope("baseline")}
                  data-testid="button-scope-baseline"
                >
                  <Building2 className="w-4 h-4 mr-2" />
                  Baseline
                </Button>
                <Button
                  type="button"
                  variant={scope === "project" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setScope("project")}
                  data-testid="button-scope-product"
                >
                  <Briefcase className="w-4 h-4 mr-2" />
                  Product
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {scope === "baseline" 
                  ? "Your company profile and all tracked competitors"
                  : "A specific product analysis"}
              </p>
            </div>

            {scope === "project" && (
              <div className="space-y-2">
                <Label>Select Product</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger data-testid="select-product">
                    <SelectValue placeholder="Choose a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.length === 0 ? (
                      <SelectItem value="none" disabled>No products available</SelectItem>
                    ) : (
                      projects.map((project: any) => (
                        <SelectItem key={project.id} value={project.id} data-testid={`option-product-${project.id}`}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{project.name}</span>
                            {project.clientName && (
                              <span className="text-muted-foreground text-xs">({project.clientName})</span>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {project.analysisType === "product" ? "Product" : "Company"}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-name">Report Name (Optional)</Label>
            <Input
              id="report-name"
              placeholder="e.g., Q1 2025 Competitive Analysis"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              data-testid="input-report-name"
            />
          </div>

          {reportType === "marketing" && (
            <div className="p-4 rounded-lg bg-muted/30 border">
              <Label className="text-sm font-medium mb-2 block">Included Sections</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Executive Summary", icon: Sparkles, generatedAt: null as string | null, stale: false },
                  { label: "GTM Plan", icon: Megaphone, generatedAt: gtmPlanGeneratedAt, stale: gtmPlanStale },
                  { label: "Messaging Framework", icon: MessageSquareText, generatedAt: messagingFrameworkGeneratedAt, stale: messagingFrameworkStale },
                ].map(({ label, icon: Icon, generatedAt, stale }) => (
                  <div key={label} className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-sm">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </div>
                    {generatedAt && (
                      <span
                        className={cn(
                          "text-[10px] pl-5 leading-tight",
                          stale ? "text-amber-600 font-medium" : "text-primary/70"
                        )}
                        data-testid={`text-marketing-generated-${label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {stale ? "Outdated · " : ""}Generated {formatShortDate(generatedAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {scope === "baseline" && reportType === "quick" && (() => {
            const strategicDisabled = !hasGtmPlan && !hasMessagingFramework;
            const tile = (
              <div
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-all",
                  strategicDisabled
                    ? "border-border bg-muted/30 cursor-not-allowed opacity-60"
                    : includeStrategicPlans
                      ? "border-primary bg-primary/5 cursor-pointer"
                      : "border-border hover:border-primary/50 cursor-pointer"
                )}
                onClick={() => {
                  if (strategicDisabled) return;
                  setStrategicPlansTouched(true);
                  setIncludeStrategicPlans(!includeStrategicPlans);
                }}
                data-testid="toggle-strategic-plans"
              >
                <Checkbox
                  checked={includeStrategicPlans}
                  disabled={strategicDisabled}
                  onCheckedChange={(checked) => {
                    if (strategicDisabled) return;
                    setStrategicPlansTouched(true);
                    setIncludeStrategicPlans(!!checked);
                  }}
                  className="h-4 w-4"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">Include GTM Plan & Messaging Framework</span>
                  <p className="text-xs text-muted-foreground">Add your Go-to-Market plan and messaging framework to the report</p>
                  {(gtmPlanGeneratedAt || messagingFrameworkGeneratedAt) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                      {gtmPlanGeneratedAt && (
                        <span
                          className={cn(
                            "text-[11px]",
                            gtmPlanStale ? "text-amber-600 font-medium" : "text-muted-foreground"
                          )}
                          data-testid="text-strategic-gtm-generated"
                        >
                          GTM Plan: {gtmPlanStale ? "Outdated · " : ""}Generated {formatShortDate(gtmPlanGeneratedAt)}
                        </span>
                      )}
                      {messagingFrameworkGeneratedAt && (
                        <span
                          className={cn(
                            "text-[11px]",
                            messagingFrameworkStale ? "text-amber-600 font-medium" : "text-muted-foreground"
                          )}
                          data-testid="text-strategic-messaging-generated"
                        >
                          Messaging: {messagingFrameworkStale ? "Outdated · " : ""}Generated {formatShortDate(messagingFrameworkGeneratedAt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
            if (strategicDisabled) {
              return (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>{tile}</TooltipTrigger>
                    <TooltipContent>
                      Generate a GTM Plan or Messaging Framework first to include them in the report.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }
            return tile;
          })()}
        </CardContent>
        <CardFooter className="border-t pt-4">
          <Button 
            onClick={handleGenerateAndDownload} 
            disabled={isGenerating || (scope === "project" && !selectedProjectId) || (reportType === "capstone" && Object.values(sections).every(v => !v))}

            className="w-full sm:w-auto"
            size="lg"
            data-testid="button-generate-report"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {reportGenLabel}
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Generate & Download Report
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
      )}

      {!tenantLoading && relationshipReportsAllowed && (
        <Card className="mb-8 border-primary/20" data-testid="card-relationship-report">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Handshake className="w-5 h-5 text-primary" />
              Relationship Report
            </CardTitle>
            <CardDescription>
              On-demand 12-month plan for engaging with, cooperating with, selling to, competing
              with, speaking to, or steering clear of any company in your market. Defaults to your
              tracked competitors; future versions will support any external company.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Target Company</Label>
                <Select value={relCompetitorId} onValueChange={setRelCompetitorId}>
                  <SelectTrigger data-testid="select-relationship-target">
                    <SelectValue placeholder="Choose a tracked competitor" />
                  </SelectTrigger>
                  <SelectContent>
                    {competitors.length === 0 ? (
                      <SelectItem value="none" disabled>No competitors tracked yet</SelectItem>
                    ) : (
                      competitors.map((c: any) => (
                        <SelectItem key={c.id} value={c.id} data-testid={`option-relationship-target-${c.id}`}>
                          {c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The plan is written from the perspective of {companyProfile?.companyName || "your baseline company"}.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Recommended Posture</Label>
                <Select value={relPosture || "auto"} onValueChange={setRelPosture}>
                  <SelectTrigger data-testid="select-relationship-posture">
                    <SelectValue placeholder="Let AI recommend" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Let AI recommend</SelectItem>
                    <SelectItem value="cooperate">Cooperate / Partner</SelectItem>
                    <SelectItem value="compete">Compete / Differentiate</SelectItem>
                    <SelectItem value="sell_to">Sell To / Pursue as Customer</SelectItem>
                    <SelectItem value="steer_clear">Steer Clear / Avoid</SelectItem>
                    <SelectItem value="observe">Observe / Hold Steady</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The plan still covers all postures; this just biases the framing.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relationship-guidance">Custom Guidance (optional)</Label>
              <Textarea
                id="relationship-guidance"
                placeholder="e.g., We want to evaluate a co-marketing arrangement and have one shared customer; avoid burning bridges with their CRO."
                rows={3}
                value={relGuidance}
                onChange={(e) => setRelGuidance(e.target.value)}
                data-testid="input-relationship-guidance"
              />
            </div>
          </CardContent>
          <CardFooter className="border-t pt-4">
            <Button
              onClick={() => generateRelationshipMutation.mutate({
                competitorId: relCompetitorId,
                posture: relPosture,
                customGuidance: relGuidance,
              })}
              disabled={!relCompetitorId || generateRelationshipMutation.isPending}
              size="lg"
              className="w-full sm:w-auto"
              data-testid="button-generate-relationship"
            >
              {generateRelationshipMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating 12-month plan…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Relationship Plan
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      {!tenantLoading && relationshipReportsAllowed && relationshipReports.length > 0 && (
        <div className="mb-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Saved Relationship Plans</h2>
            <p className="text-sm text-muted-foreground">12-month engagement plans you have generated</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {relationshipReports.map((rr) => (
              <Card key={rr.id} className="group hover:border-primary/50 transition-all" data-testid={`card-relationship-${rr.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="w-9 h-9 rounded bg-primary/10 text-primary flex items-center justify-center">
                      <Handshake size={18} />
                    </div>
                    {rr.savedPrompts?.posture && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {rr.savedPrompts.posture.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="text-base line-clamp-1">{rr.name}</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {rr.lastGeneratedAt
                        ? formatShortDate(rr.lastGeneratedAt)
                        : rr.createdAt
                          ? formatShortDate(rr.createdAt)
                          : "—"}
                    </span>
                    {rr.targetName && (
                      <>
                        <span>•</span>
                        <span className="truncate max-w-[12rem]">{rr.targetName}</span>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardFooter className="pt-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => window.open(`/api/relationship-reports/${rr.id}/download/markdown`, "_blank")}
                    data-testid={`button-download-relationship-${rr.id}`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Markdown
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/api/relationship-reports/${rr.id}/download/docx`, "_blank")}
                    data-testid={`button-download-relationship-docx-${rr.id}`}
                    title="Download as Word document"
                  >
                    <FileText className="w-4 h-4" />
                  </Button>
                  {rr.competitorId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => generateRelationshipMutation.mutate({
                        competitorId: rr.competitorId!,
                        posture: rr.savedPrompts?.posture || "",
                        customGuidance: rr.savedPrompts?.customGuidance || "",
                      })}
                      disabled={generateRelationshipMutation.isPending}
                      data-testid={`button-regenerate-relationship-${rr.id}`}
                      title="Regenerate with latest data"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteRelationshipMutation.mutate(rr.id)}
                      disabled={deleteRelationshipMutation.isPending}
                      data-testid={`button-delete-relationship-${rr.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <h2 className="text-xl font-semibold">Report History</h2>
        <p className="text-sm text-muted-foreground">Previously generated reports</p>
      </div>

      {reports.length === 0 ? (
        <EmptyPageState
          icon={<FileText className="h-5 w-5" />}
          title="No reports generated yet"
          description="Generate a branded PDF report to share competitive insights with your team. Reports you create will appear here."
          learnMoreHref="/app/guide"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report: any) => (
            <Card key={report.id} className="group hover:border-primary/50 transition-all" data-testid={`card-report-${report.id}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start mb-2">
                  <div className="w-9 h-9 rounded bg-primary/10 text-primary flex items-center justify-center">
                    <FileText size={18} />
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {report.scope === "project" ? (
                      <><Briefcase className="w-3 h-3 mr-1" /> Product</>
                    ) : (
                      <><Building2 className="w-3 h-3 mr-1" /> Baseline</>
                    )}
                  </Badge>
                </div>
                <CardTitle className="text-base line-clamp-1">{report.name}</CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><Clock size={12} /> {report.date || new Date(report.createdAt).toLocaleDateString()}</span>
                  {(() => {
                    const freshness = latestSourceDate
                      ? checkArtifactFreshness(report.generatedFromDataAsOf || report.createdAt, [latestSourceDate])
                      : null;
                    if (freshness?.isStale) {
                      return <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50/50" data-testid={`badge-currency-${report.id}`}>{freshness.label}</Badge>;
                    }
                    const level = calculateStaleness(report.createdAt);
                    if (level === "fresh") return <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50/50" data-testid={`badge-currency-${report.id}`}>Current</Badge>;
                    const age = getTimeAgo(report.createdAt);
                    return <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50/50" data-testid={`badge-currency-${report.id}`}>{age} old</Badge>;
                  })()}
                  {report.marketName && (
                    <>
                      <span>•</span>
                      <span>{report.marketName}</span>
                    </>
                  )}
                  {report.size && (
                    <>
                      <span>•</span>
                      <span>{report.size}</span>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardFooter className="pt-0 gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="flex-1 group-hover:bg-primary group-hover:text-primary-foreground transition-all" 
                  onClick={() => handleDownloadReport(report)}
                  data-testid={`button-download-${report.id}`}
                >
                  <Download className="w-4 h-4 mr-2" /> Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-primary"
                  onClick={() => {
                    setReportName(report.name);
                    setScope(report.scope || "baseline");
                    if (report.projectId) setSelectedProjectId(report.projectId);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  data-testid={`button-regenerate-${report.id}`}
                  title="Regenerate this report with latest data"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
                {isAdmin && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deleteReportMutation.mutate(report.id)}
                    disabled={deleteReportMutation.isPending}
                    data-testid={`button-delete-${report.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
