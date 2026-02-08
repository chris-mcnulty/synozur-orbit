import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Clock, Building2, Briefcase, Sparkles, Swords, Activity, Target, BarChart2, Lightbulb, Zap, CheckCircle2, Info, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { UpgradePrompt } from "@/components/UpgradePrompt";

type ReportSections = {
  executiveSummary: boolean;
  companyBaseline: boolean;
  competitorProfiles: boolean;
  gapAnalysis: boolean;
  recommendations: boolean;
  battleCards: boolean;
  activityLog: boolean;
};

const defaultSections: ReportSections = {
  executiveSummary: true,
  companyBaseline: true,
  competitorProfiles: true,
  gapAnalysis: true,
  recommendations: true,
  battleCards: true,
  activityLog: false,
};

export default function Reports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState<"quick" | "capstone">("quick");
  const [scope, setScope] = useState<"baseline" | "project">("baseline");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [reportName, setReportName] = useState("");
  const [sections, setSections] = useState<ReportSections>(defaultSections);
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeStrategicPlans, setIncludeStrategicPlans] = useState(false);

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
          name: reportName || undefined,
          scope,
          projectId: scope === "project" ? selectedProjectId : undefined,
          sections: reportType === "capstone" ? sections : undefined,
          includeStrategicPlans: includeStrategicPlans || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate report");
      }

      const blob = await response.blob();
      const fileName = reportName 
        ? `${reportName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`
        : `Competitive_Analysis_${new Date().toLocaleDateString().replace(/\//g, "-")}.pdf`;
      
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

          <div className="grid gap-4 sm:grid-cols-2">
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
                  { key: "activityLog", label: "Activity Log", icon: Activity },
                ].map(({ key, label, icon: Icon }) => (
                  <div 
                    key={key}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md cursor-pointer transition-all text-sm",
                      sections[key as keyof ReportSections] 
                        ? "bg-primary/10 text-primary" 
                        : "bg-background hover:bg-muted"
                    )}
                    onClick={() => setSections(s => ({ ...s, [key]: !s[key as keyof ReportSections] }))}
                  >
                    <Checkbox 
                      checked={sections[key as keyof ReportSections]} 
                      onCheckedChange={(checked) => setSections(s => ({ ...s, [key]: !!checked }))}
                      className="h-4 w-4"
                    />
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate">{label}</span>
                  </div>
                ))}
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

          {scope === "baseline" && (
            <div
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                includeStrategicPlans
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => setIncludeStrategicPlans(!includeStrategicPlans)}
              data-testid="toggle-strategic-plans"
            >
              <Checkbox
                checked={includeStrategicPlans}
                onCheckedChange={(checked) => setIncludeStrategicPlans(!!checked)}
                className="h-4 w-4"
              />
              <div>
                <span className="text-sm font-medium">Include GTM Plan & Messaging Framework</span>
                <p className="text-xs text-muted-foreground">Add your Go-to-Market plan and messaging framework to the report</p>
              </div>
            </div>
          )}
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
                Generating Report...
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

      <div className="mb-4">
        <h2 className="text-xl font-semibold">Report History</h2>
        <p className="text-sm text-muted-foreground">Previously generated reports</p>
      </div>

      {reports.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground">No reports generated yet</p>
          <p className="text-sm text-muted-foreground">Your report history will appear here</p>
        </Card>
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock size={12} /> {report.date || new Date(report.createdAt).toLocaleDateString()}
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
