import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Edit2, Loader2, Trash2, RefreshCw, ExternalLink, Globe, FileText, Target, Sparkles, Linkedin, Instagram, Twitter, TrendingUp, Calendar, Check, AlertCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function CompanyBaseline() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    companyName: "",
    websiteUrl: "",
    linkedInUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    description: "",
  });

  const { data: companyProfile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch company profile");
      return response.json();
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["/api/documents"],
    queryFn: async () => {
      const response = await fetch("/api/documents", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const saveProfile = useMutation({
    mutationFn: async (data: typeof profileForm) => {
      const response = await fetch("/api/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to save company profile");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      setIsProfileDialogOpen(false);
      toast({
        title: "Profile Saved",
        description: "Your company profile has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const analyzeProfile = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/company-profile/analyze", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to analyze company website");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      toast({
        title: "Analysis Complete",
        description: "Your company website has been analyzed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProfile = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/company-profile", {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete company profile");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      toast({
        title: "Profile Deleted",
        description: "Your company profile has been removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openProfileDialog = () => {
    if (companyProfile) {
      setProfileForm({
        companyName: companyProfile.companyName || "",
        websiteUrl: companyProfile.websiteUrl || "",
        linkedInUrl: companyProfile.linkedInUrl || "",
        instagramUrl: companyProfile.instagramUrl || "",
        twitterUrl: companyProfile.twitterUrl || "",
        description: companyProfile.description || "",
      });
    } else {
      setProfileForm({
        companyName: "",
        websiteUrl: "",
        linkedInUrl: "",
        instagramUrl: "",
        twitterUrl: "",
        description: "",
      });
    }
    setIsProfileDialogOpen(true);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    saveProfile.mutate(profileForm);
  };

  const analysisData = companyProfile?.analysisData;
  const hasAnalysis = !!analysisData;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-baseline-title">Company Baseline</h1>
              <p className="text-muted-foreground">Your company profile serves as the foundation for all competitive analysis</p>
            </div>
          </div>
        </div>

        {isLoadingProfile ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !companyProfile ? (
          <Card className="border-dashed border-2 border-primary/30">
            <CardContent className="py-12">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold">Set Up Your Company Profile</h3>
                  <p className="text-muted-foreground mt-1 max-w-md mx-auto">
                    Add your company details to establish a baseline for competitive analysis. This helps us understand your positioning and identify gaps.
                  </p>
                </div>
                <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="lg" onClick={openProfileDialog} data-testid="button-setup-profile">
                      <Building2 className="w-5 h-5 mr-2" />
                      Set Up Company Profile
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Set Up Your Company Profile</DialogTitle>
                      <DialogDescription>
                        Add your company details to use as a baseline for competitive analysis.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveProfile}>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="companyName">Company Name</Label>
                          <Input
                            id="companyName"
                            placeholder="Your Company Inc."
                            value={profileForm.companyName}
                            onChange={(e) => setProfileForm({ ...profileForm, companyName: e.target.value })}
                            required
                            data-testid="input-company-name"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="websiteUrl">Website URL</Label>
                          <Input
                            id="websiteUrl"
                            placeholder="https://yourcompany.com"
                            value={profileForm.websiteUrl}
                            onChange={(e) => setProfileForm({ ...profileForm, websiteUrl: e.target.value })}
                            required
                            data-testid="input-website-url"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="linkedInUrl" className="flex items-center gap-2">
                            <Linkedin className="h-4 w-4 text-[#0A66C2]" /> LinkedIn URL
                          </Label>
                          <Input
                            id="linkedInUrl"
                            placeholder="https://linkedin.com/company/..."
                            value={profileForm.linkedInUrl}
                            onChange={(e) => setProfileForm({ ...profileForm, linkedInUrl: e.target.value })}
                            data-testid="input-linkedin"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="instagramUrl" className="flex items-center gap-2">
                            <Instagram className="h-4 w-4 text-[#E4405F]" /> Instagram URL
                          </Label>
                          <Input
                            id="instagramUrl"
                            placeholder="https://instagram.com/..."
                            value={profileForm.instagramUrl}
                            onChange={(e) => setProfileForm({ ...profileForm, instagramUrl: e.target.value })}
                            data-testid="input-instagram"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="twitterUrl" className="flex items-center gap-2">
                            <Twitter className="h-4 w-4 text-[#1DA1F2]" /> Twitter/X URL
                          </Label>
                          <Input
                            id="twitterUrl"
                            placeholder="https://x.com/..."
                            value={profileForm.twitterUrl}
                            onChange={(e) => setProfileForm({ ...profileForm, twitterUrl: e.target.value })}
                            data-testid="input-twitter"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="description">Description (optional)</Label>
                          <Textarea
                            id="description"
                            placeholder="Brief description of your company..."
                            value={profileForm.description}
                            onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                            rows={3}
                            data-testid="input-description"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={saveProfile.isPending} data-testid="button-save-profile">
                          {saveProfile.isPending ? "Saving..." : "Save Profile"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
                        <span className="text-2xl font-bold text-white">
                          {companyProfile.companyName?.charAt(0) || "C"}
                        </span>
                      </div>
                      <div>
                        <CardTitle className="text-xl">{companyProfile.companyName}</CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <Globe className="w-4 h-4" />
                          <a href={companyProfile.websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {companyProfile.websiteUrl?.replace(/^https?:\/\//, "")}
                          </a>
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => analyzeProfile.mutate()}
                        disabled={analyzeProfile.isPending}
                        data-testid="button-analyze-website"
                      >
                        {analyzeProfile.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Analyze Website
                      </Button>
                      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={openProfileDialog} data-testid="button-edit-profile">
                            <Edit2 className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Company Profile</DialogTitle>
                            <DialogDescription>
                              Update your company details for competitive analysis.
                            </DialogDescription>
                          </DialogHeader>
                          <form onSubmit={handleSaveProfile}>
                            <div className="grid gap-4 py-4">
                              <div className="grid gap-2">
                                <Label htmlFor="companyName">Company Name</Label>
                                <Input
                                  id="companyName"
                                  placeholder="Your Company Inc."
                                  value={profileForm.companyName}
                                  onChange={(e) => setProfileForm({ ...profileForm, companyName: e.target.value })}
                                  required
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label htmlFor="websiteUrl">Website URL</Label>
                                <Input
                                  id="websiteUrl"
                                  placeholder="https://yourcompany.com"
                                  value={profileForm.websiteUrl}
                                  onChange={(e) => setProfileForm({ ...profileForm, websiteUrl: e.target.value })}
                                  required
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label htmlFor="linkedInUrl" className="flex items-center gap-2">
                                  <Linkedin className="h-4 w-4 text-[#0A66C2]" /> LinkedIn URL
                                </Label>
                                <Input
                                  id="linkedInUrl"
                                  placeholder="https://linkedin.com/company/..."
                                  value={profileForm.linkedInUrl}
                                  onChange={(e) => setProfileForm({ ...profileForm, linkedInUrl: e.target.value })}
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label htmlFor="instagramUrl" className="flex items-center gap-2">
                                  <Instagram className="h-4 w-4 text-[#E4405F]" /> Instagram URL
                                </Label>
                                <Input
                                  id="instagramUrl"
                                  placeholder="https://instagram.com/..."
                                  value={profileForm.instagramUrl}
                                  onChange={(e) => setProfileForm({ ...profileForm, instagramUrl: e.target.value })}
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label htmlFor="twitterUrl" className="flex items-center gap-2">
                                  <Twitter className="h-4 w-4 text-[#1DA1F2]" /> Twitter/X URL
                                </Label>
                                <Input
                                  id="twitterUrl"
                                  placeholder="https://x.com/..."
                                  value={profileForm.twitterUrl}
                                  onChange={(e) => setProfileForm({ ...profileForm, twitterUrl: e.target.value })}
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label htmlFor="description">Description (optional)</Label>
                                <Textarea
                                  id="description"
                                  placeholder="Brief description of your company..."
                                  value={profileForm.description}
                                  onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                                  rows={3}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button type="submit" disabled={saveProfile.isPending}>
                                {saveProfile.isPending ? "Saving..." : "Save Profile"}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" data-testid="button-delete-profile">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Company Profile?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove your company profile and any associated analysis data. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteProfile.mutate()}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {companyProfile.description && (
                    <p className="text-muted-foreground mb-4">{companyProfile.description}</p>
                  )}
                  
                  <div className="flex items-center gap-4 flex-wrap">
                    {companyProfile.linkedInUrl && (
                      <a href={companyProfile.linkedInUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-[#0A66C2]">
                        <Linkedin className="w-4 h-4" /> LinkedIn
                      </a>
                    )}
                    {companyProfile.instagramUrl && (
                      <a href={companyProfile.instagramUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-[#E4405F]">
                        <Instagram className="w-4 h-4" /> Instagram
                      </a>
                    )}
                    {companyProfile.twitterUrl && (
                      <a href={companyProfile.twitterUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-[#1DA1F2]">
                        <Twitter className="w-4 h-4" /> Twitter/X
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>

              {hasAnalysis && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-primary" />
                          AI Analysis
                        </CardTitle>
                        <CardDescription>Insights extracted from your website</CardDescription>
                      </div>
                      {companyProfile.lastAnalyzedAt && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(companyProfile.lastAnalyzedAt).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {analysisData.valueProposition && (
                      <div>
                        <h4 className="font-medium mb-2 flex items-center gap-2">
                          <Target className="w-4 h-4 text-primary" />
                          Value Proposition
                        </h4>
                        <p className="text-muted-foreground">{analysisData.valueProposition}</p>
                      </div>
                    )}
                    
                    {analysisData.targetAudience && (
                      <div>
                        <h4 className="font-medium mb-2">Target Audience</h4>
                        <p className="text-muted-foreground">{analysisData.targetAudience}</p>
                      </div>
                    )}
                    
                    {analysisData.keyDifferentiators && analysisData.keyDifferentiators.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Key Differentiators</h4>
                        <ul className="space-y-1">
                          {analysisData.keyDifferentiators.map((d: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-muted-foreground">
                              <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                              {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {analysisData.mainProducts && analysisData.mainProducts.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Products & Services</h4>
                        <div className="flex flex-wrap gap-2">
                          {analysisData.mainProducts.map((p: string, i: number) => (
                            <Badge key={i} variant="outline">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {!hasAnalysis && companyProfile && (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center">
                    <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium mb-2">No Analysis Yet</h3>
                    <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                      Click "Analyze Website" to extract insights from your company's website including value proposition, target audience, and key differentiators.
                    </p>
                    <Button
                      onClick={() => analyzeProfile.mutate()}
                      disabled={analyzeProfile.isPending}
                      data-testid="button-analyze-cta"
                    >
                      {analyzeProfile.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing...</>
                      ) : (
                        <><Sparkles className="w-4 h-4 mr-2" /> Analyze Website</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Grounding Documents
                  </CardTitle>
                  <CardDescription>Supporting materials for AI analysis</CardDescription>
                </CardHeader>
                <CardContent>
                  {documents.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-sm text-muted-foreground mb-3">
                        No documents uploaded yet
                      </p>
                      <Link href="/app/documents">
                        <Button variant="outline" size="sm" data-testid="link-upload-documents">
                          Upload Documents
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {documents.slice(0, 5).map((doc: any) => (
                        <div key={doc.id} className="flex items-center gap-2 text-sm">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="truncate">{doc.name}</span>
                        </div>
                      ))}
                      {documents.length > 5 && (
                        <p className="text-xs text-muted-foreground">
                          +{documents.length - 5} more documents
                        </p>
                      )}
                      <Link href="/app/documents">
                        <Button variant="outline" size="sm" className="w-full mt-2" data-testid="link-manage-documents">
                          Manage Documents
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Next Steps
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Link href="/app/competitors">
                    <Button variant="outline" className="w-full justify-start" data-testid="link-add-competitors">
                      <Target className="w-4 h-4 mr-2" />
                      Add Competitors
                    </Button>
                  </Link>
                  <Link href="/app/analysis">
                    <Button variant="outline" className="w-full justify-start" data-testid="link-view-analysis">
                      <Sparkles className="w-4 h-4 mr-2" />
                      View Analysis
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
