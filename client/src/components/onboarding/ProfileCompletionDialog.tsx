import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { COMPANY_SIZES, JOB_ROLES, INDUSTRIES, COUNTRIES } from "@/lib/constants";

interface ProfileCompletionDialogProps {
  open: boolean;
  onComplete: () => void;
  userName: string;
}

export default function ProfileCompletionDialog({ open, onComplete, userName }: ProfileCompletionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    jobTitle: "",
    industry: "",
    companySize: "",
    country: "",
  });

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch("/api/me/demographics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save profile");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      toast({
        title: "Profile updated",
        description: "Thank you for completing your profile!",
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
    
    const requiredFields = [
      { field: 'jobTitle', label: 'Job Title' },
      { field: 'industry', label: 'Industry' },
      { field: 'companySize', label: 'Company Size' },
      { field: 'country', label: 'Country' },
    ];

    for (const { field, label } of requiredFields) {
      if (!formData[field as keyof typeof formData]) {
        toast({
          title: "Required field",
          description: `Please select your ${label}`,
          variant: "destructive",
        });
        return;
      }
    }

    saveMutation.mutate(formData);
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-[450px]" hideCloseButton>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">Complete Your Profile</DialogTitle>
              <DialogDescription>
                Help us personalize your experience
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Welcome, <span className="font-medium text-foreground">{userName}</span>! Please tell us a bit about yourself to get started.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Job Title *</Label>
              <Select value={formData.jobTitle} onValueChange={(v) => updateField('jobTitle', v)}>
                <SelectTrigger data-testid="select-job-title">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {JOB_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Industry *</Label>
              <Select value={formData.industry} onValueChange={(v) => updateField('industry', v)}>
                <SelectTrigger data-testid="select-industry">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Size *</Label>
              <Select value={formData.companySize} onValueChange={(v) => updateField('companySize', v)}>
                <SelectTrigger data-testid="select-company-size">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_SIZES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Country *</Label>
              <Select value={formData.country} onValueChange={(v) => updateField('country', v)}>
                <SelectTrigger data-testid="select-country">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full mt-6" 
            disabled={saveMutation.isPending}
            data-testid="button-save-profile"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Continue to Orbit"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
