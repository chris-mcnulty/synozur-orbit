import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Plus, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function Reports() {
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const response = await fetch("/api/reports", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

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
        <Button>
            <Plus className="w-4 h-4 mr-2" /> Generate New Report
        </Button>
      </div>

      {reports.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No reports generated yet.</p>
          <p className="text-sm text-muted-foreground mb-4">Generate your first competitive intelligence report.</p>
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Generate New Report
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report: any) => (
              <Card key={report.id} className="flex flex-col group hover:border-primary/50 transition-all duration-300">
                  <CardHeader>
                      <div className="flex justify-between items-start mb-4">
                          <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center">
                              <FileText size={20} />
                          </div>
                          <Badge variant={report.status === "Ready" ? "default" : "secondary"}>
                              {report.status}
                          </Badge>
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
                      <Button variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all">
                          <Download className="w-4 h-4 mr-2" /> Download {report.type || "PDF"}
                      </Button>
                  </CardFooter>
              </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
