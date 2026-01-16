import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { mockReports } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Plus } from "lucide-react";

export default function Reports() {
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

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {mockReports.map((report) => (
            <Card key={report.id} className="flex flex-col">
                <CardHeader>
                    <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center mb-4">
                        <FileText size={20} />
                    </div>
                    <CardTitle>{report.name}</CardTitle>
                    <CardDescription>{report.date}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                    <p className="text-sm text-muted-foreground">
                        Comprehensive analysis including thematic comparison, gap analysis, and AI recommendations.
                    </p>
                </CardContent>
                <CardFooter>
                    <Button variant="outline" className="w-full">
                        <Download className="w-4 h-4 mr-2" /> Download PDF
                    </Button>
                </CardFooter>
            </Card>
        ))}
      </div>
    </AppLayout>
  );
}
