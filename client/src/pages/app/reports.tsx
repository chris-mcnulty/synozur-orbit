import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Plus, Clock, Building2, Briefcase } from "lucide-react";
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

export default function Reports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [scope, setScope] = useState<"baseline" | "project">("baseline");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [reportName, setReportName] = useState("");

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
        <Button onClick={handleOpenDialog} data-testid="button-generate-report">
            <Plus className="w-4 h-4 mr-2" /> Generate New Report
        </Button>
      </div>

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
    </AppLayout>
  );
}
