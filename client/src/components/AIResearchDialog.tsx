import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Check, MapPin, Calendar, Users, DollarSign, Briefcase, Linkedin, Rss, Building2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface AIResearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "competitor" | "company";
  entityId: string;
  entityName: string;
  entityUrl: string;
}

const FIELD_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  headquarters: { label: "Headquarters", icon: <MapPin className="h-4 w-4" /> },
  founded: { label: "Founded Year", icon: <Calendar className="h-4 w-4" /> },
  employeeCount: { label: "Employee Count", icon: <Users className="h-4 w-4" /> },
  revenue: { label: "Revenue", icon: <DollarSign className="h-4 w-4" /> },
  fundingRaised: { label: "Funding Raised", icon: <DollarSign className="h-4 w-4" /> },
  industry: { label: "Industry", icon: <Briefcase className="h-4 w-4" /> },
  linkedInUrl: { label: "LinkedIn URL", icon: <Linkedin className="h-4 w-4" /> },
  blogUrl: { label: "Blog URL", icon: <Rss className="h-4 w-4" /> },
  description: { label: "Description", icon: <Building2 className="h-4 w-4" /> },
};

export function AIResearchDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
  entityUrl,
}: AIResearchDialogProps) {
  const [step, setStep] = useState<"confirm" | "preview" | "done">("confirm");
  const [previewData, setPreviewData] = useState<{ fieldsToPopulate: Record<string, string>; research: any } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: async () => {
      const endpoint = entityType === "competitor"
        ? `/api/competitors/${entityId}/ai-research?preview=true`
        : `/api/company-profile/ai-research?preview=true`;

      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to run AI research");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setStep("preview");
    },
    onError: (error: Error) => {
      toast({
        title: "Research Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const endpoint = entityType === "competitor"
        ? `/api/competitors/${entityId}/ai-research`
        : `/api/company-profile/ai-research`;

      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save research");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (entityType === "competitor") {
        queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
        queryClient.invalidateQueries({ queryKey: ["/api/competitors", entityId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      }
      setStep("done");
      toast({
        title: "Research Saved",
        description: `${data.fieldsPopulated?.length || 0} fields enriched for ${entityName}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setStep("confirm");
    setPreviewData(null);
    onOpenChange(false);
  };

  const fieldsToPopulate = previewData?.fieldsToPopulate || {};
  const fieldCount = Object.keys(fieldsToPopulate).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Company Research: {entityName}
          </DialogTitle>
          <DialogDescription>
            {step === "confirm" && "Use AI to research and populate missing company metadata."}
            {step === "preview" && "Review the research results before saving."}
            {step === "done" && "Research complete! Data has been saved."}
          </DialogDescription>
        </DialogHeader>

        {step === "confirm" && (
          <>
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-blue-600 dark:text-blue-400">How it works</p>
                  <p className="text-muted-foreground mt-1">
                    AI will research {entityName} ({entityUrl}) and find missing metadata like headquarters, 
                    founding year, employee count, revenue, LinkedIn URL, and blog URL. Only empty fields will 
                    be populated — existing data won't be overwritten.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="gap-2"
                data-testid="button-start-ai-research"
              >
                {previewMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Researching...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Run AI Research</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "preview" && (
          <>
            <div className="space-y-3 py-2">
              {fieldCount === 0 ? (
                <div className="text-center py-4">
                  <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="font-medium">All metadata is already populated!</p>
                  <p className="text-sm text-muted-foreground mt-1">No new fields to fill in.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    <Badge variant="secondary" className="mr-1">{fieldCount}</Badge>
                    field{fieldCount !== 1 ? "s" : ""} will be populated:
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {Object.entries(fieldsToPopulate).map(([field, value]) => {
                      const fieldInfo = FIELD_LABELS[field] || { label: field, icon: <Building2 className="h-4 w-4" /> };
                      return (
                        <div key={field} className="flex items-start gap-3 p-2 bg-muted/50 rounded-lg" data-testid={`preview-field-${field}`}>
                          <div className="text-muted-foreground mt-0.5">{fieldInfo.icon}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{fieldInfo.label}</p>
                            <p className="text-sm text-muted-foreground truncate">{value as string}</p>
                          </div>
                          <Check className="h-4 w-4 text-green-500 shrink-0 mt-1" />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              {fieldCount > 0 && (
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-ai-research"
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                  ) : (
                    <><Check className="h-4 w-4" /> Save {fieldCount} Field{fieldCount !== 1 ? "s" : ""}</>
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === "done" && (
          <>
            <div className="text-center py-4">
              <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <p className="font-medium">Research saved successfully!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Company metadata has been enriched.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={handleClose} data-testid="button-close-ai-research">Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
