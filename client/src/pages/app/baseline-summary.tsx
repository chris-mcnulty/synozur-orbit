import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  FileSpreadsheet, RefreshCw, Loader2, Building2, Target, Users, 
  Lightbulb, Lock, Unlock, Save, Pencil, X
} from "lucide-react";

interface SummaryData {
  companySnapshot: string;
  marketPosition: string;
  competitiveLandscape: string;
  opportunities: string;
}

type SectionKey = keyof SummaryData;

const sectionConfig: { key: SectionKey; title: string; icon: React.ElementType; description: string }[] = [
  { key: "companySnapshot", title: "Company Snapshot", icon: Building2, description: "Overview of your company's positioning and key facts" },
  { key: "marketPosition", title: "Market Position", icon: Target, description: "Your competitive standing and differentiators" },
  { key: "competitiveLandscape", title: "Competitive Landscape", icon: Users, description: "Key competitors and market dynamics" },
  { key: "opportunities", title: "Opportunities", icon: Lightbulb, description: "Strategic opportunities and recommended actions" },
];

export default function BaselineSummaryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [editContent, setEditContent] = useState("");

  const { data: summary, isLoading } = useQuery({
    queryKey: ["/api/baseline/executive-summary"],
    queryFn: async () => {
      const response = await fetch("/api/baseline/executive-summary", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const generateSummary = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/baseline/executive-summary/generate", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate summary");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/executive-summary"] });
      toast({ title: "Summary Generated", description: "Executive summary has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateSection = useMutation({
    mutationFn: async ({ section, content, lock }: { section: SectionKey; content: string; lock: boolean }) => {
      const res = await fetch("/api/baseline/executive-summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, content, lock }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update section");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/executive-summary"] });
      setEditingSection(null);
      toast({ title: "Section Updated", description: "Your changes have been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleLock = useMutation({
    mutationFn: async ({ section, lock }: { section: SectionKey; lock: boolean }) => {
      const content = summary?.data?.[section] || "";
      const res = await fetch("/api/baseline/executive-summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, content, lock }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update lock status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/executive-summary"] });
    },
  });

  const lockedSections = (summary?.lockedSections as string[]) || [];

  const startEdit = (section: SectionKey) => {
    setEditingSection(section);
    setEditContent(summary?.data?.[section] || "");
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setEditContent("");
  };

  const saveEdit = () => {
    if (!editingSection) return;
    const isLocked = lockedSections.includes(editingSection);
    updateSection.mutate({ section: editingSection, content: editContent, lock: isLocked });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileSpreadsheet className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Executive Summary</h1>
              <p className="text-muted-foreground">
                {summary?.lastGeneratedAt 
                  ? `Last updated ${formatDate(summary.lastGeneratedAt)}`
                  : "AI-generated overview of your market intelligence"}
              </p>
            </div>
          </div>
          <Button
            onClick={() => generateSummary.mutate()}
            disabled={generateSummary.isPending}
            data-testid="button-regenerate-summary"
          >
            {generateSummary.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {summary?.exists ? "Regenerate" : "Generate Summary"}
              </>
            )}
          </Button>
        </div>
      </div>

      {!summary?.exists ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-primary/50" />
            <h3 className="text-lg font-semibold mb-2">No Executive Summary Yet</h3>
            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
              Generate an AI-powered summary of your company's market position, competitive landscape, and opportunities.
            </p>
            <Button
              onClick={() => generateSummary.mutate()}
              disabled={generateSummary.isPending}
              data-testid="button-generate-first-summary"
            >
              {generateSummary.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Generate Executive Summary
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4 mb-4">
            <p className="text-sm text-muted-foreground">
              <Lock className="w-4 h-4 inline mr-1" />
              <strong>Tip:</strong> Lock sections to preserve your edits during regeneration. Unlocked sections will be refreshed with new AI-generated content.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {sectionConfig.map(({ key, title, icon: Icon, description }) => {
              const isLocked = lockedSections.includes(key);
              const isEditing = editingSection === key;
              const content = summary?.data?.[key] || "";

              return (
                <Card key={key} className={isLocked ? "border-primary/30" : ""} data-testid={`card-section-${key}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="w-5 h-5 text-primary" />
                        <CardTitle className="text-base">{title}</CardTitle>
                        {isLocked && (
                          <Badge variant="secondary" className="text-xs">
                            <Lock className="w-3 h-3 mr-1" />
                            Locked
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {!isEditing && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => toggleLock.mutate({ section: key, lock: !isLocked })}
                              disabled={toggleLock.isPending}
                              title={isLocked ? "Unlock section" : "Lock section"}
                              data-testid={`button-toggle-lock-${key}`}
                            >
                              {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4 text-muted-foreground" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => startEdit(key)}
                              data-testid={`button-edit-${key}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <CardDescription className="text-xs">{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isEditing ? (
                      <div className="space-y-3">
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={5}
                          className="resize-none"
                          data-testid={`textarea-edit-${key}`}
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={cancelEdit}>
                            <X className="w-4 h-4 mr-1" />
                            Cancel
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={saveEdit}
                            disabled={updateSection.isPending}
                            data-testid={`button-save-${key}`}
                          >
                            {updateSection.isPending ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4 mr-1" />
                            )}
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{content || "Not yet generated"}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
