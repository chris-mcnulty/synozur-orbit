import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Copy, Check, Sparkles, ClipboardPaste, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface ManualResearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "competitor" | "company";
  entityId: string;
  entityName: string;
  entityUrl: string;
}

export function ManualResearchDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
  entityUrl,
}: ManualResearchDialogProps) {
  const [step, setStep] = useState<"prompt" | "paste">("prompt");
  const [pastedContent, setPastedContent] = useState("");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const researchPrompt = `Please research and analyze ${entityName} (${entityUrl}) and provide competitive intelligence in the following structured format:

**Company Summary:**
[2-3 sentence overview of what the company does, their market position, and key focus areas]

**Company Profile:**
- Headquarters: [City, State/Country]
- Founded: [Year]
- Employee Count: [Approximate number or range, e.g., "50-100" or "500+"]
- Revenue: [Estimated revenue range if available, e.g., "$10M-$50M" or "Series B"]
- Funding Raised: [Total funding if venture-backed, e.g., "$25M" or "Bootstrapped"]

**Value Proposition:**
[Their main value proposition - what unique value do they offer customers?]

**Target Audience:**
[Who are their primary customers/target market?]

**Key Messages:**
- [Key message 1]
- [Key message 2]
- [Key message 3]

**Keywords/Themes:**
[Comma-separated list of keywords that represent their positioning]

**Tone:**
[Describe their brand voice/tone - e.g., professional, casual, technical, friendly]

**Strengths:**
- [Strength 1]
- [Strength 2]
- [Strength 3]

**Weaknesses:**
- [Weakness 1]
- [Weakness 2]

Please base your analysis on publicly available information about this company.`;

  const saveResearchMutation = useMutation({
    mutationFn: async (content: string) => {
      const endpoint = entityType === "competitor" 
        ? `/api/competitors/${entityId}/manual-research`
        : `/api/company-profile/manual-research`;
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ researchContent: content }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save research");
      }
      return response.json();
    },
    onSuccess: () => {
      if (entityType === "competitor") {
        queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
        queryClient.invalidateQueries({ queryKey: ["/api/competitors", entityId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      }
      toast({
        title: "Research Saved",
        description: `Intelligence for ${entityName} has been saved successfully.`,
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(researchPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Prompt Copied",
      description: "Paste this into ChatGPT, Copilot, or any AI assistant.",
    });
  };

  const handleClose = () => {
    setStep("prompt");
    setPastedContent("");
    setCopied(false);
    onOpenChange(false);
  };

  const handleSave = () => {
    if (pastedContent.trim().length < 100) {
      toast({
        title: "Content Too Short",
        description: "Please paste the full AI research response.",
        variant: "destructive",
      });
      return;
    }
    saveResearchMutation.mutate(pastedContent);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Manual AI Research: {entityName}
          </DialogTitle>
          <DialogDescription>
            {step === "prompt" 
              ? "Copy this prompt and paste it into your preferred AI assistant (ChatGPT, Copilot, Claude, etc.)"
              : "Paste the AI-generated research below"
            }
          </DialogDescription>
        </DialogHeader>

        {step === "prompt" ? (
          <>
            <div className="space-y-4">
              <div className="bg-muted/50 border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Research Prompt</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-2"
                    data-testid="button-copy-prompt"
                  >
                    {copied ? (
                      <><Check className="h-4 w-4 text-green-500" /> Copied!</>
                    ) : (
                      <><Copy className="h-4 w-4" /> Copy Prompt</>
                    )}
                  </Button>
                </div>
                <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono bg-background/50 p-3 rounded border max-h-64 overflow-y-auto">
                  {researchPrompt}
                </pre>
              </div>

              <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-blue-600 dark:text-blue-400">Tip: Use your favorite AI assistant</p>
                  <p className="text-muted-foreground mt-1">
                    Open{" "}
                    <a href="https://chat.openai.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      ChatGPT <ExternalLink className="h-3 w-3" />
                    </a>
                    ,{" "}
                    <a href="https://copilot.microsoft.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      Copilot <ExternalLink className="h-3 w-3" />
                    </a>
                    , or{" "}
                    <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      Claude <ExternalLink className="h-3 w-3" />
                    </a>
                    {" "}and paste the prompt.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => setStep("paste")} className="gap-2" data-testid="button-next-paste">
                <ClipboardPaste className="h-4 w-4" /> I Have the Results
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <Label htmlFor="paste-results" className="text-sm font-medium">
                  Paste AI Research Results
                </Label>
                <Textarea
                  id="paste-results"
                  placeholder="Paste the AI-generated research about the company here..."
                  className="mt-2 min-h-[300px] font-mono text-sm"
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  data-testid="textarea-paste-results"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {pastedContent.length} characters
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("prompt")}>Back</Button>
              <Button 
                onClick={handleSave} 
                disabled={saveResearchMutation.isPending || pastedContent.trim().length < 100}
                className="gap-2"
                data-testid="button-save-research"
              >
                {saveResearchMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Save Research</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
