import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Plus, Clock, Building2, Briefcase, BookOpen, Sparkles, Swords, Activity, Target, BarChart2, Lightbulb } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCapstoneDialogOpen, setIsCapstoneDialogOpen] = useState(false);
  const [scope, setScope] = useState<"baseline" | "project">("baseline");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [reportName, setReportName] = useState("");
  const [sections, setSections] = useState<ReportSections>(defaultSections);
  const [includeAllProjects, setIncludeAllProjects] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

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

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateAndDownload = async () => {
    if (scope === "project" && !selectedProjectId) {
      toast({
        title: "Select a Project",
        description: "Please select a project to generate a report for.",
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
      setIsDialogOpen(false);
      setReportName("");
      setScope("baseline");
      setSelectedProjectId("");
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

  const handleOpenDialog = () => {
    setReportName("");
    setScope("baseline");
    setSelectedProjectId("");
    setIsDialogOpen(true);
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
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">Reports</h1>
           <p className="text-muted-foreground">Generate and download branded competitive intelligence reports.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsCapstoneDialogOpen(true)} data-testid="button-capstone-report">
            <BookOpen className="w-4 h-4 mr-2" /> Capstone Report
          </Button>
          <Button onClick={handleOpenDialog} data-testid="button-generate-report">
            <Plus className="w-4 h-4 mr-2" /> Quick Report
          </Button>
        </div>
      </div>

      <Card className="mb-6 border-primary/20 bg-gradient-to-r from-primary/5 to-secondary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Capstone Report Builder</CardTitle>
              <CardDescription>Create a comprehensive report with customizable sections</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { key: "executiveSummary", label: "Executive Summary", icon: Sparkles },
              { key: "companyBaseline", label: "Company Profile", icon: Building2 },
              { key: "competitorProfiles", label: "Competitors", icon: Target },
              { key: "gapAnalysis", label: "Gap Analysis", icon: BarChart2 },
              { key: "recommendations", label: "Recommendations", icon: Lightbulb },
              { key: "battleCards", label: "Battle Cards", icon: Swords },
              { key: "activityLog", label: "Activity Log", icon: Activity },
            ].map(({ key, label, icon: Icon }) => (
              <Badge 
                key={key} 
                variant={sections[key as keyof ReportSections] ? "default" : "outline"}
                className={cn(
                  "cursor-pointer transition-all",
                  sections[key as keyof ReportSections] 
                    ? "bg-primary/90 hover:bg-primary" 
                    : "hover:bg-primary/10"
                )}
                onClick={() => setSections(s => ({ ...s, [key]: !s[key as keyof ReportSections] }))}
              >
                <Icon className="w-3 h-3 mr-1" />
                {label}
              </Badge>
            ))}
          </div>
          <Button onClick={() => setIsCapstoneDialogOpen(true)} className="w-full sm:w-auto">
            <BookOpen className="w-4 h-4 mr-2" /> Build Capstone Report
          </Button>
        </CardContent>
      </Card>

      {reports.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No reports generated yet.</p>
          <p className="text-sm text-muted-foreground mb-4">Generate your first competitive intelligence report.</p>
          <Button onClick={handleOpenDialog} data-testid="button-generate-first-report">
            <Plus className="w-4 h-4 mr-2" /> Generate New Report
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report: any) => (
              <Card key={report.id} className="flex flex-col group hover:border-primary/50 transition-all duration-300" data-testid={`card-report-${report.id}`}>
                  <CardHeader>
                      <div className="flex justify-between items-start mb-4">
                          <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center">
                              <FileText size={20} />
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="outline" className="text-xs">
                              {report.scope === "project" ? (
                                <><Briefcase className="w-3 h-3 mr-1" /> Project</>
                              ) : (
                                <><Building2 className="w-3 h-3 mr-1" /> Baseline</>
                              )}
                            </Badge>
                            <Badge variant={report.status === "Ready" ? "default" : "secondary"}>
                                {report.status}
                            </Badge>
                          </div>
                      </div>
                      <CardTitle className="line-clamp-1 group-hover:text-primary transition-colors">{report.name}</CardTitle>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Clock size={12} /> {report.date || new Date(report.createdAt).toLocaleDateString()}
                          {report.size && (
                            <>
                              <span>•</span>
                              <span>{report.size}</span>
                            </>
                          )}
                      </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                      <p className="text-sm text-muted-foreground line-clamp-3">
                          {report.description || "Comprehensive competitive analysis report covering key themes, messaging gaps, and AI-driven recommendations."}
                      </p>
                  </CardContent>
                  <CardFooter className="border-t border-border pt-4">
                      <Button 
                        variant="outline" 
                        className="w-full group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all" 
                        onClick={() => handleDownloadReport(report)}
                        data-testid={`button-download-${report.id}`}
                      >
                          <Download className="w-4 h-4 mr-2" /> Download {report.type || "PDF"}
                      </Button>
                  </CardFooter>
              </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate New Report</DialogTitle>
            <DialogDescription>
              Choose what to include in your competitive intelligence report.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
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

            <div className="space-y-2">
              <Label>Report Source</Label>
              <Select value={scope} onValueChange={(v: "baseline" | "project") => setScope(v)}>
                <SelectTrigger data-testid="select-report-source">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baseline" data-testid="option-baseline">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4" />
                      <span>Baseline (Your Company Profile)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="project" data-testid="option-project">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4" />
                      <span>Project</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {scope === "baseline" 
                  ? "Generate a report based on your company profile and all tracked competitors."
                  : "Generate a report for a specific client project."}
              </p>
            </div>

            {scope === "project" && (
              <div className="space-y-2">
                <Label>Select Project</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger data-testid="select-project">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.length === 0 ? (
                      <SelectItem value="none" disabled>No projects available</SelectItem>
                    ) : (
                      projects.map((project: any) => (
                        <SelectItem key={project.id} value={project.id} data-testid={`option-project-${project.id}`}>
                          <div className="flex items-center gap-2">
                            <span>{project.clientName}</span>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleGenerateAndDownload} 
              disabled={isGenerating || (scope === "project" && !selectedProjectId)}
              data-testid="button-confirm-generate"
            >
              {isGenerating ? "Generating..." : "Generate & Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCapstoneDialogOpen} onOpenChange={setIsCapstoneDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Capstone Report Builder
            </DialogTitle>
            <DialogDescription>
              Build a comprehensive report by selecting the sections you want to include.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="capstone-name">Report Name</Label>
              <Input
                id="capstone-name"
                placeholder="e.g., Q1 2025 Comprehensive Competitive Analysis"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                data-testid="input-capstone-name"
              />
            </div>

            <div className="space-y-3">
              <Label>Include Sections</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: "executiveSummary", label: "Executive Summary", description: "AI-generated overview of findings", icon: Sparkles },
                  { key: "companyBaseline", label: "Company Baseline Profile", description: "Your company's positioning", icon: Building2 },
                  { key: "competitorProfiles", label: "Competitor Profiles", description: "Detailed competitor analysis", icon: Target },
                  { key: "gapAnalysis", label: "Gap Analysis", description: "Messaging and positioning gaps", icon: BarChart2 },
                  { key: "recommendations", label: "Recommendations", description: "AI-driven action items", icon: Lightbulb },
                  { key: "battleCards", label: "Battle Cards", description: "Sales enablement cards", icon: Swords },
                  { key: "activityLog", label: "Activity Log", description: "Recent competitor changes", icon: Activity },
                ].map(({ key, label, description, icon: Icon }) => (
                  <div 
                    key={key}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                      sections[key as keyof ReportSections] 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => setSections(s => ({ ...s, [key]: !s[key as keyof ReportSections] }))}
                  >
                    <Checkbox 
                      checked={sections[key as keyof ReportSections]} 
                      onCheckedChange={(checked) => setSections(s => ({ ...s, [key]: !!checked }))}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm">{label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Include Projects</Label>
              <div className="space-y-2">
                <div 
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                    includeAllProjects ? "border-primary bg-primary/5" : "border-border"
                  )}
                  onClick={() => setIncludeAllProjects(true)}
                >
                  <Checkbox checked={includeAllProjects} onCheckedChange={() => setIncludeAllProjects(true)} />
                  <div>
                    <span className="font-medium text-sm">All Projects</span>
                    <p className="text-xs text-muted-foreground">Include all client projects in the report</p>
                  </div>
                </div>
                <div 
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                    !includeAllProjects ? "border-primary bg-primary/5" : "border-border"
                  )}
                  onClick={() => setIncludeAllProjects(false)}
                >
                  <Checkbox checked={!includeAllProjects} onCheckedChange={() => setIncludeAllProjects(false)} />
                  <div className="flex-1">
                    <span className="font-medium text-sm">Select Specific Projects</span>
                    {!includeAllProjects && projects.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {projects.map((project: any) => (
                          <div 
                            key={project.id} 
                            className="flex items-center gap-2 text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox 
                              checked={selectedProjects.includes(project.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedProjects([...selectedProjects, project.id]);
                                } else {
                                  setSelectedProjects(selectedProjects.filter(id => id !== project.id));
                                }
                              }}
                            />
                            <span>{project.clientName || project.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated pages:</span>
                <span className="font-medium">
                  {Object.values(sections).filter(Boolean).length * 2 + 2} - {Object.values(sections).filter(Boolean).length * 4 + 4}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCapstoneDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={async () => {
                setIsGenerating(true);
                try {
                  const response = await fetch("/api/reports/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                      name: reportName || "Capstone Competitive Analysis",
                      scope: "baseline",
                      sections,
                      includeProjects: includeAllProjects ? "all" : selectedProjects,
                    }),
                  });

                  if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || "Failed to generate report");
                  }

                  const blob = await response.blob();
                  const fileName = `${(reportName || "Capstone_Analysis").replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
                  
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
                    title: "Capstone Report Generated",
                    description: "Your comprehensive report has been downloaded successfully.",
                  });
                  setIsCapstoneDialogOpen(false);
                  setReportName("");
                  setSections(defaultSections);
                } catch (error: any) {
                  toast({
                    title: "Error",
                    description: error.message,
                    variant: "destructive",
                  });
                } finally {
                  setIsGenerating(false);
                }
              }}
              disabled={isGenerating || Object.values(sections).every(v => !v)}
            >
              {isGenerating ? "Generating..." : (
                <>
                  <BookOpen className="w-4 h-4 mr-2" />
                  Generate Capstone Report
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
