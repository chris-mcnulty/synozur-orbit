import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, Globe, Sparkles, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CompanyInfo {
  domain: string;
  websiteUrl: string;
  companyName: string;
  description: string;
  linkedInUrl?: string;
  instagramUrl?: string;
  fetchSuccess: boolean;
}

interface CompanySetupDialogProps {
  open: boolean;
  onComplete: () => void;
  canSkip?: boolean;
  onSkip?: () => void;
  marketName?: string;
}

export default function CompanySetupDialog({ open, onComplete, canSkip = false, onSkip, marketName }: CompanySetupDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    companyName: "",
    websiteUrl: "",
    description: "",
    linkedInUrl: "",
    instagramUrl: "",
  });
  const [isLoading, setIsLoading] = useState(true);

  const { data: domainInfo } = useQuery<CompanyInfo>({
    queryKey: ["/api/company-info/from-domain"],
    queryFn: async () => {
      const response = await fetch("/api/company-info/from-domain", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch company info");
      return response.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (domainInfo) {
      setFormData({
        companyName: domainInfo.companyName || "",
        websiteUrl: domainInfo.websiteUrl || "",
        description: domainInfo.description || "",
        linkedInUrl: domainInfo.linkedInUrl || "",
        instagramUrl: domainInfo.instagramUrl || "",
      });
      setIsLoading(false);
    }
  }, [domainInfo]);

  const saveProfileMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch("/api/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save company profile");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      toast({
        title: "Company profile created",
        description: "Your company has been set up successfully. You can now add competitors and run analysis.",
      });
      onComplete();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.companyName || !formData.websiteUrl) {
      toast({
        title: "Required fields",
        description: "Please enter a company name and website URL",
        variant: "destructive",
      });
      return;
    }
    saveProfileMutation.mutate(formData);
  };

  const handleClose = () => {
    if (canSkip && onSkip) {
      onSkip();
    }
  };

  return (
    <Dialog open={open} onOpenChange={canSkip ? handleClose : undefined}>
      <DialogContent className="sm:max-w-[500px]" hideCloseButton={!canSkip}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">
                {marketName ? `Set Up Baseline for ${marketName}` : "Set Up Your Company"}
              </DialogTitle>
              <DialogDescription>
                {marketName 
                  ? `Set up the baseline company for the "${marketName}" market. You can skip this and add competitors directly.`
                  : "Let's get your company profile ready for competitive analysis"
                }
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Fetching information from your website...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {domainInfo?.fetchSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-500 bg-green-500/10 rounded-lg px-3 py-2">
                <Sparkles className="w-4 h-4" />
                <span>Pre-filled from your website - review and confirm</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                data-testid="input-company-name"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                placeholder="Enter your company name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="websiteUrl">Website URL</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="websiteUrl"
                  data-testid="input-website-url"
                  className="pl-10"
                  value={formData.websiteUrl}
                  onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                  placeholder="https://www.yourcompany.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                data-testid="input-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of your company and what you do"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                This helps our AI understand your positioning when analyzing competitors
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="linkedInUrl">LinkedIn (optional)</Label>
                <Input
                  id="linkedInUrl"
                  data-testid="input-linkedin"
                  value={formData.linkedInUrl}
                  onChange={(e) => setFormData({ ...formData, linkedInUrl: e.target.value })}
                  placeholder="LinkedIn company URL"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagramUrl">Instagram (optional)</Label>
                <Input
                  id="instagramUrl"
                  data-testid="input-instagram"
                  value={formData.instagramUrl}
                  onChange={(e) => setFormData({ ...formData, instagramUrl: e.target.value })}
                  placeholder="Instagram profile URL"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              {canSkip && onSkip && (
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="button-skip-setup"
                  onClick={onSkip}
                >
                  Skip for now
                </Button>
              )}
              <Button
                type="submit"
                data-testid="button-save-company"
                disabled={saveProfileMutation.isPending}
              >
                {saveProfileMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Save & Continue
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}