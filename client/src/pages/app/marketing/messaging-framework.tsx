import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Loader2, RefreshCw, Sparkles, ChevronRight, Download, FileText, Pencil, X, Save, History, Clock, RotateCcw, AlertTriangle } from "lucide-react";
import { FeatureGate } from "@/components/UpgradePrompt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { checkArtifactFreshness, formatShortDate } from "@/lib/staleness";

type LongFormRecommendation = {
  id: string;
  type: string;
  content: string | null;
  status: string;
  lastGeneratedAt: string | null;
  updatedAt?: string | null;
  savedPrompts?: { customGuidance?: string; lastManualEdit?: string; versionHistory?: Array<{ content: string; savedAt: string; savedBy: string }> };
};

export default function MessagingFrameworkPage() {
  const queryClient = useQueryClient();
  const [guidance, setGuidance] = useState("");
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const { data: tenant } = useQuery({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const messagingAllowed = tenant?.features?.messagingFramework !== false;

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: messagingFramework, isLoading } = useQuery<LongFormRecommendation>({
    queryKey: ["/api/baseline/recommendations/messaging_framework"],
    queryFn: async () => {
      const response = await fetch("/api/baseline/recommendations/messaging_framework", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!companyProfile,
  });

  React.useEffect(() => {
    if (messagingFramework?.savedPrompts?.customGuidance) {
      setGuidance(messagingFramework.savedPrompts.customGuidance);
    }
  }, [messagingFramework]);

  const generateMessagingFramework = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/baseline/recommendations/messaging_framework/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customGuidance: guidance }),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate messaging framework");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/recommendations/messaging_framework"] });
      toast.success("Messaging framework generated successfully!");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const saveContentMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const response = await fetch(`/api/baseline/recommendations/${id}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to save content");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/baseline/recommendations/messaging_framework"] });
      setIsEditing(false);
      toast.success("Content saved successfully!");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
          <MessageCircle className="h-7 w-7 text-primary" />
          Messaging & Positioning Framework
        </h1>
        <p className="text-muted-foreground">AI-generated messaging framework based on competitive gaps and your baseline positioning.</p>
      </div>

      {(() => {
        if (!messagingFramework?.lastGeneratedAt) return null;
        const sourceDates = [
          ...(companyProfile?.lastCrawledAt ? [companyProfile.lastCrawledAt] : []),
          ...competitors.map((c: any) => c.lastCrawledAt).filter(Boolean),
          ...competitors.filter((c: any) => c.socialLastFetchedAt).map((c: any) => c.socialLastFetchedAt),
        ];
        const freshness = checkArtifactFreshness(messagingFramework.generatedFromDataAsOf || messagingFramework.lastGeneratedAt, sourceDates);
        if (!freshness.isStale) return null;
        return (
          <Card className="mb-4 border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10" data-testid="banner-stale-messaging">
            <CardContent className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Built from data as of <strong>{formatShortDate(messagingFramework.generatedFromDataAsOf || messagingFramework.lastGeneratedAt)}</strong> — {freshness.label}</span>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => generateMessagingFramework.mutate()} disabled={generateMessagingFramework.isPending} data-testid="btn-rebuild-messaging">
                {generateMessagingFramework.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Rebuild with Latest Data
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      <FeatureGate feature="Messaging Framework" requiredPlan="Trial" isAllowed={messagingAllowed} description="Generate AI-powered messaging frameworks based on competitive gaps. Upgrade to Trial or higher to access this feature.">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  Messaging & Positioning Rewrite
                </CardTitle>
                <CardDescription>
                  AI-generated messaging framework based on competitive gaps
                </CardDescription>
              </div>
              {messagingFramework?.lastGeneratedAt && (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 mr-1" />
                  Last updated: {new Date(messagingFramework.lastGeneratedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {!companyProfile ? (
              <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Company Profile Required</h3>
                <p className="text-muted-foreground mb-4">
                  Set up your company profile first to generate messaging recommendations.
                </p>
              </div>
            ) : (
              <>
                <Collapsible open={promptsOpen} onOpenChange={setPromptsOpen}>
                  <div className="flex items-center gap-2">
                    <Button 
                      onClick={() => generateMessagingFramework.mutate()} 
                      disabled={generateMessagingFramework.isPending}
                      data-testid="button-generate-messaging"
                    >
                      {generateMessagingFramework.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : messagingFramework?.status === "generated" ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Regenerate Framework
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Generate Messaging Framework
                        </>
                      )}
                    </Button>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground">
                        <ChevronRight className={`h-4 w-4 transition-transform ${promptsOpen ? "rotate-90" : ""}`} />
                        Custom Guidance (Optional)
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="mt-4">
                    <div className="border rounded-lg p-4 bg-muted/30">
                      <Textarea
                        placeholder="Add any specific requirements, target audience, tone of voice, key messages to emphasize, or brand guidelines..."
                        value={guidance}
                        onChange={(e) => setGuidance(e.target.value)}
                        rows={3}
                        data-testid="input-messaging-guidance"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {isLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : messagingFramework?.status === "generated" && messagingFramework.content ? (
                  <div className="space-y-4">
                    <div className="flex gap-2 justify-end flex-wrap">
                      {!isEditing ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditContent(messagingFramework.content || "");
                            setIsEditing(true);
                          }}
                          data-testid="button-edit-messaging"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(false)}
                            data-testid="button-cancel-edit-messaging"
                          >
                            <X className="mr-2 h-4 w-4" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveContentMutation.mutate({ id: messagingFramework.id, content: editContent })}
                            disabled={saveContentMutation.isPending}
                            data-testid="button-save-messaging"
                          >
                            {saveContentMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-4 w-4" />
                            )}
                            Save
                          </Button>
                        </>
                      )}
                      {(messagingFramework.savedPrompts?.versionHistory?.length ?? 0) > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setVersionHistoryOpen(true)}
                          data-testid="button-messaging-version-history"
                        >
                          <History className="mr-2 h-4 w-4" />
                          History ({messagingFramework.savedPrompts?.versionHistory?.length})
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const blob = new Blob([messagingFramework.content || ""], { type: "text/markdown" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `messaging_framework_${new Date().toISOString().split('T')[0]}.md`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        data-testid="button-download-msg-md"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download Markdown
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`/api/recommendations/${messagingFramework.id}/download/docx`, "_blank")}
                        data-testid="button-download-msg-docx"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Download Word
                      </Button>
                    </div>
                    {isEditing ? (
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[500px] font-mono text-sm"
                        data-testid="input-messaging-edit"
                      />
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-6 bg-card">
                        <div dangerouslySetInnerHTML={{ 
                          __html: messagingFramework.content
                            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
                            .replace(/\*(.*?)\*/gim, '<em>$1</em>')
                            .replace(/^- (.*$)/gim, '<li>$1</li>')
                            .replace(/\n\n/gim, '</p><p>')
                            .replace(/\n/gim, '<br/>')
                        }} />
                      </div>
                    )}
                    {messagingFramework.savedPrompts?.lastManualEdit && (
                      <p className="text-xs text-muted-foreground text-right">
                        Last manually edited: {new Date(messagingFramework.savedPrompts.lastManualEdit).toLocaleString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 border-2 border-dashed rounded-lg">
                    <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No Messaging Framework Generated Yet</h3>
                    <p className="text-muted-foreground">
                      Click the button above to generate messaging recommendations based on competitive gaps.
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </FeatureGate>

      <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Messaging Framework Version History
            </DialogTitle>
            <DialogDescription>
              Previous versions are saved automatically when you edit content. Up to 10 versions are retained.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {messagingFramework?.savedPrompts?.versionHistory?.map((version: any, index: number, arr: any[]) => (
              <div key={index} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">Version {arr.length - index}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {new Date(version.savedAt).toLocaleString()}
                  </span>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none bg-muted/30 rounded p-3 max-h-[200px] overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-xs">{version.content?.substring(0, 500)}{version.content?.length > 500 ? "..." : ""}</pre>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditContent(version.content);
                    setIsEditing(true);
                    setVersionHistoryOpen(false);
                    toast.info("Version loaded into editor. Click Save to apply.");
                  }}
                  data-testid={`button-restore-version-${index}`}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restore This Version
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
