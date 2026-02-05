import React, { useState, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Edit2, Loader2, Trash2, RefreshCw, ExternalLink, Globe, FileText, Target, Sparkles, Linkedin, Instagram, Twitter, TrendingUp, Calendar, Check, AlertCircle, Upload, Link2, ImageIcon, ClipboardPaste, Rss, MapPin, Users, DollarSign, Briefcase, ChevronDown } from "lucide-react";
import { ManualResearchDialog } from "@/components/ManualResearchDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import StalenessDot from "@/components/ui/StalenessDot";

export default function CompanyBaseline() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [logoUploadTab, setLogoUploadTab] = useState<"url" | "upload">("url");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualResearchOpen, setManualResearchOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    companyName: "",
    websiteUrl: "",
    logoUrl: "",
    linkedInUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    blogUrl: "",
    description: "",
    // Directory fields
    headquarters: "",
    founded: "",
    employeeCount: "",
    industry: "",
    revenue: "",
    fundingRaised: "",
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      if (data.canUseManualResearch) {
        toast({
          title: "Website Could Not Be Crawled",
          description: "Use AI to research this company manually instead.",
          action: (
            <Button size="sm" variant="outline" onClick={() => setManualResearchOpen(true)}>
              <ClipboardPaste className="w-4 h-4 mr-2" />
              Use AI Research
            </Button>
          ),
          duration: 10000,
        });
      } else {
        toast({
          title: "Analysis Complete",
          description: "Your company website has been analyzed.",
        });
      }
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

  const refreshAllMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const response = await fetch(`/api/company-profile/${profileId}/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to refresh data");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      const websitePages = data.results?.website?.pages || 0;
      const blogPosts = data.results?.website?.blogPosts || 0;
      const hasLinkedIn = data.results?.linkedin?.success;
      toast({
        title: "Data Refreshed",
        description: `Crawled ${websitePages} pages${blogPosts > 0 ? `, found ${blogPosts} blog posts` : ""}${hasLinkedIn ? ", updated LinkedIn" : ""}`,
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

  const refreshSocialMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const response = await fetch(`/api/company-profile/${profileId}/refresh-social`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to refresh social data");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      const linkedInData = data.results?.linkedin;
      if (linkedInData?.success) {
        toast({
          title: "Social Data Refreshed",
          description: `LinkedIn: ${linkedInData.followers?.toLocaleString() || 0} followers, ${linkedInData.posts || 0} recent posts`,
        });
      } else {
        toast({
          title: "Social Refresh Complete",
          description: linkedInData?.error || "No LinkedIn data found",
          variant: "default",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const monitorAllMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const response = await fetch(`/api/company-profile/${profileId}/monitor-all`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to monitor websites");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast({
        title: "Change Check Complete",
        description: data.message || `Checked ${data.successCount} of ${data.successCount + data.failCount} targets for changes.`,
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

  const handleLogoUpload = async (file: File) => {
    if (!file) return;
    
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload a PNG, JPEG, GIF, WebP, or SVG image.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Logo file must be under 5MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "logo");
      
      const response = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to upload logo");
      }
      
      const { url } = await response.json();
      setProfileForm({ ...profileForm, logoUrl: url });
      toast({
        title: "Logo Uploaded",
        description: "Your logo has been uploaded successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload logo. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const openProfileDialog = () => {
    if (companyProfile) {
      setProfileForm({
        companyName: companyProfile.companyName || "",
        websiteUrl: companyProfile.websiteUrl || "",
        logoUrl: companyProfile.logoUrl || "",
        linkedInUrl: companyProfile.linkedInUrl || "",
        instagramUrl: companyProfile.instagramUrl || "",
        twitterUrl: companyProfile.twitterUrl || "",
        blogUrl: companyProfile.blogUrl || "",
        description: companyProfile.description || "",
        headquarters: companyProfile.headquarters || "",
        founded: companyProfile.founded || "",
        employeeCount: companyProfile.employeeCount || "",
        industry: companyProfile.industry || "",
        revenue: companyProfile.revenue || "",
        fundingRaised: companyProfile.fundingRaised || "",
      });
      setLogoUploadTab("url");
    } else {
      setProfileForm({
        companyName: "",
        websiteUrl: "",
        logoUrl: "",
        linkedInUrl: "",
        instagramUrl: "",
        twitterUrl: "",
        blogUrl: "",
        description: "",
        headquarters: "",
        founded: "",
        employeeCount: "",
        industry: "",
        revenue: "",
        fundingRaised: "",
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
                          <Label className="flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" /> Company Logo (optional)
                          </Label>
                          <Tabs value={logoUploadTab} onValueChange={(v) => setLogoUploadTab(v as "url" | "upload")} className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger value="url" className="text-xs">
                                <Link2 className="h-3 w-3 mr-1" /> URL
                              </TabsTrigger>
                              <TabsTrigger value="upload" className="text-xs">
                                <Upload className="h-3 w-3 mr-1" /> Upload
                              </TabsTrigger>
                            </TabsList>
                            <TabsContent value="url" className="mt-2">
                              <Input
                                placeholder="https://example.com/logo.png"
                                value={profileForm.logoUrl}
                                onChange={(e) => setProfileForm({ ...profileForm, logoUrl: e.target.value })}
                                data-testid="input-logo-url"
                              />
                            </TabsContent>
                            <TabsContent value="upload" className="mt-2">
                              <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleLogoUpload(file);
                                }}
                              />
                              <div 
                                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                                onClick={() => fileInputRef.current?.click()}
                              >
                                {isUploadingLogo ? (
                                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm">Uploading...</span>
                                  </div>
                                ) : (
                                  <div className="text-muted-foreground">
                                    <Upload className="h-6 w-6 mx-auto mb-1" />
                                    <p className="text-sm">Click to upload logo</p>
                                    <p className="text-xs">PNG, JPG, GIF, WebP, SVG (max 5MB)</p>
                                  </div>
                                )}
                              </div>
                            </TabsContent>
                          </Tabs>
                          {profileForm.logoUrl && (
                            <div className="flex items-center gap-2 mt-2 p-2 bg-muted/50 rounded">
                              <img 
                                src={profileForm.logoUrl} 
                                alt="Logo preview" 
                                className="h-8 w-8 object-contain rounded"
                                onError={(e) => (e.currentTarget.style.display = 'none')}
                              />
                              <span className="text-sm text-muted-foreground truncate flex-1">
                                {profileForm.logoUrl}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setProfileForm({ ...profileForm, logoUrl: "" })}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
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
                          <Label htmlFor="blogUrl" className="flex items-center gap-2">
                            <Rss className="h-4 w-4 text-orange-500" /> Blog URL
                          </Label>
                          <Input
                            id="blogUrl"
                            placeholder="https://yourcompany.com/blog or RSS feed URL..."
                            value={profileForm.blogUrl}
                            onChange={(e) => setProfileForm({ ...profileForm, blogUrl: e.target.value })}
                            data-testid="input-blog"
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
                        
                        {/* Directory fields */}
                        <div className="border-t pt-4 mt-2">
                          <p className="text-sm font-medium mb-3">Company Directory (optional)</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1">
                              <Label htmlFor="headquarters" className="text-xs flex items-center gap-1">
                                <MapPin className="h-3 w-3" /> Headquarters
                              </Label>
                              <Input
                                id="headquarters"
                                placeholder="City, Country"
                                value={profileForm.headquarters}
                                onChange={(e) => setProfileForm({ ...profileForm, headquarters: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor="founded" className="text-xs flex items-center gap-1">
                                <Calendar className="h-3 w-3" /> Founded
                              </Label>
                              <Input
                                id="founded"
                                placeholder="2010"
                                value={profileForm.founded}
                                onChange={(e) => setProfileForm({ ...profileForm, founded: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor="employeeCount" className="text-xs flex items-center gap-1">
                                <Users className="h-3 w-3" /> Employees
                              </Label>
                              <Input
                                id="employeeCount"
                                placeholder="50-100"
                                value={profileForm.employeeCount}
                                onChange={(e) => setProfileForm({ ...profileForm, employeeCount: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor="industry" className="text-xs flex items-center gap-1">
                                <Building2 className="h-3 w-3" /> Industry
                              </Label>
                              <Input
                                id="industry"
                                placeholder="Technology"
                                value={profileForm.industry}
                                onChange={(e) => setProfileForm({ ...profileForm, industry: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor="fundingRaised" className="text-xs flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" /> Funding Raised
                              </Label>
                              <Input
                                id="fundingRaised"
                                placeholder="$10M Series A"
                                value={profileForm.fundingRaised}
                                onChange={(e) => setProfileForm({ ...profileForm, fundingRaised: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
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
                      {companyProfile.logoUrl ? (
                        <img 
                          src={companyProfile.logoUrl} 
                          alt={companyProfile.companyName}
                          className="w-14 h-14 rounded-xl object-contain bg-white shadow-lg"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
                          <span className="text-2xl font-bold text-white">
                            {companyProfile.companyName?.charAt(0) || "C"}
                          </span>
                        </div>
                      )}
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
                    <div className="flex items-center gap-2 flex-wrap">
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setManualResearchOpen(true)}
                        data-testid="button-manual-research"
                      >
                        <ClipboardPaste className="w-4 h-4 mr-2" />
                        Manual Research
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => companyProfile?.id && monitorAllMutation.mutate(companyProfile.id)}
                        disabled={!companyProfile?.id || monitorAllMutation.isPending}
                        data-testid="button-check-all-changes"
                      >
                        {monitorAllMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Globe className="w-4 h-4 mr-2" />
                        )}
                        Check All for Changes
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!companyProfile?.id || refreshAllMutation.isPending || refreshSocialMutation.isPending}
                            data-testid="button-refresh-dropdown"
                          >
                            {(refreshAllMutation.isPending || refreshSocialMutation.isPending) ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="w-4 h-4 mr-2" />
                            )}
                            Refresh Data
                            <ChevronDown className="w-3 h-3 ml-2" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>Refresh Options</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => companyProfile?.id && refreshAllMutation.mutate(companyProfile.id)}
                            disabled={!companyProfile?.id || refreshAllMutation.isPending}
                            data-testid="menu-refresh-website"
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            <div className="flex flex-col">
                              <span className="font-medium">Refresh Website</span>
                              <span className="text-xs text-muted-foreground">Crawl all pages + LinkedIn (~3-5 min)</span>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => companyProfile?.id && refreshSocialMutation.mutate(companyProfile.id)}
                            disabled={!companyProfile?.id || refreshSocialMutation.isPending || !companyProfile?.linkedInUrl}
                            data-testid="menu-refresh-social"
                          >
                            <Linkedin className="w-4 h-4 mr-2" />
                            <div className="flex flex-col">
                              <span className="font-medium">Refresh Social Only</span>
                              <span className="text-xs text-muted-foreground">LinkedIn only, faster (~30s)</span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
                                <Label className="flex items-center gap-2">
                                  <ImageIcon className="h-4 w-4" /> Company Logo (optional)
                                </Label>
                                <Tabs value={logoUploadTab} onValueChange={(v) => setLogoUploadTab(v as "url" | "upload")} className="w-full">
                                  <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="url" className="text-xs">
                                      <Link2 className="h-3 w-3 mr-1" /> URL
                                    </TabsTrigger>
                                    <TabsTrigger value="upload" className="text-xs">
                                      <Upload className="h-3 w-3 mr-1" /> Upload
                                    </TabsTrigger>
                                  </TabsList>
                                  <TabsContent value="url" className="mt-2">
                                    <Input
                                      placeholder="https://example.com/logo.png"
                                      value={profileForm.logoUrl}
                                      onChange={(e) => setProfileForm({ ...profileForm, logoUrl: e.target.value })}
                                      data-testid="input-logo-url-edit"
                                    />
                                  </TabsContent>
                                  <TabsContent value="upload" className="mt-2">
                                    <input
                                      ref={fileInputRef}
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleLogoUpload(file);
                                      }}
                                    />
                                    <div 
                                      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                                      onClick={() => fileInputRef.current?.click()}
                                    >
                                      {isUploadingLogo ? (
                                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                          <span className="text-sm">Uploading...</span>
                                        </div>
                                      ) : (
                                        <div className="text-muted-foreground">
                                          <Upload className="h-6 w-6 mx-auto mb-1" />
                                          <p className="text-sm">Click to upload logo</p>
                                          <p className="text-xs">PNG, JPG, GIF, WebP, SVG (max 5MB)</p>
                                        </div>
                                      )}
                                    </div>
                                  </TabsContent>
                                </Tabs>
                                {profileForm.logoUrl && (
                                  <div className="flex items-center gap-2 mt-2 p-2 bg-muted/50 rounded">
                                    <img 
                                      src={profileForm.logoUrl} 
                                      alt="Logo preview" 
                                      className="h-8 w-8 object-contain rounded"
                                      onError={(e) => (e.currentTarget.style.display = 'none')}
                                    />
                                    <span className="text-sm text-muted-foreground truncate flex-1">
                                      {profileForm.logoUrl}
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setProfileForm({ ...profileForm, logoUrl: "" })}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                )}
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
                                <Label htmlFor="blogUrl" className="flex items-center gap-2">
                                  <Rss className="h-4 w-4 text-orange-500" /> Blog URL
                                </Label>
                                <Input
                                  id="blogUrl"
                                  placeholder="https://yourcompany.com/blog or RSS feed URL..."
                                  value={profileForm.blogUrl}
                                  onChange={(e) => setProfileForm({ ...profileForm, blogUrl: e.target.value })}
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
                              
                              {/* Directory fields */}
                              <div className="border-t pt-4 mt-2">
                                <p className="text-sm font-medium mb-3">Company Directory (optional)</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="grid gap-1">
                                    <Label htmlFor="headquarters-edit" className="text-xs flex items-center gap-1">
                                      <MapPin className="h-3 w-3" /> Headquarters
                                    </Label>
                                    <Input
                                      id="headquarters-edit"
                                      placeholder="City, Country"
                                      value={profileForm.headquarters}
                                      onChange={(e) => setProfileForm({ ...profileForm, headquarters: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label htmlFor="founded-edit" className="text-xs flex items-center gap-1">
                                      <Calendar className="h-3 w-3" /> Founded
                                    </Label>
                                    <Input
                                      id="founded-edit"
                                      placeholder="2010"
                                      value={profileForm.founded}
                                      onChange={(e) => setProfileForm({ ...profileForm, founded: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label htmlFor="employeeCount-edit" className="text-xs flex items-center gap-1">
                                      <Users className="h-3 w-3" /> Employees
                                    </Label>
                                    <Input
                                      id="employeeCount-edit"
                                      placeholder="50-100"
                                      value={profileForm.employeeCount}
                                      onChange={(e) => setProfileForm({ ...profileForm, employeeCount: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label htmlFor="industry-edit" className="text-xs flex items-center gap-1">
                                      <Building2 className="h-3 w-3" /> Industry
                                    </Label>
                                    <Input
                                      id="industry-edit"
                                      placeholder="Technology"
                                      value={profileForm.industry}
                                      onChange={(e) => setProfileForm({ ...profileForm, industry: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label htmlFor="fundingRaised-edit" className="text-xs flex items-center gap-1">
                                      <TrendingUp className="h-3 w-3" /> Funding Raised
                                    </Label>
                                    <Input
                                      id="fundingRaised-edit"
                                      placeholder="$10M Series A"
                                      value={profileForm.fundingRaised}
                                      onChange={(e) => setProfileForm({ ...profileForm, fundingRaised: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                </div>
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
                    {companyProfile.blogUrl && (
                      <a href={companyProfile.blogUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-orange-500">
                        <Rss className="w-4 h-4" /> Blog
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Company Directory - uses stable database columns */}
              {(companyProfile.headquarters || companyProfile.founded || companyProfile.employeeCount || companyProfile.industry || companyProfile.revenue || companyProfile.fundingRaised) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Briefcase className="w-5 h-5 text-primary" />
                      Company Directory
                    </CardTitle>
                    <CardDescription>Business information - edit via profile settings</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {companyProfile.headquarters && (
                        <div className="flex items-start gap-2">
                          <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Headquarters</p>
                            <p className="text-sm font-medium">{companyProfile.headquarters}</p>
                          </div>
                        </div>
                      )}
                      {companyProfile.founded && (
                        <div className="flex items-start gap-2">
                          <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Founded</p>
                            <p className="text-sm font-medium">{companyProfile.founded}</p>
                          </div>
                        </div>
                      )}
                      {companyProfile.employeeCount && (
                        <div className="flex items-start gap-2">
                          <Users className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Employees</p>
                            <p className="text-sm font-medium">{companyProfile.employeeCount}</p>
                          </div>
                        </div>
                      )}
                      {companyProfile.industry && (
                        <div className="flex items-start gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Industry</p>
                            <p className="text-sm font-medium">{companyProfile.industry}</p>
                          </div>
                        </div>
                      )}
                      {companyProfile.revenue && (
                        <div className="flex items-start gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Revenue Range</p>
                            <p className="text-sm font-medium">{companyProfile.revenue}</p>
                          </div>
                        </div>
                      )}
                      {companyProfile.fundingRaised && (
                        <div className="flex items-start gap-2">
                          <TrendingUp className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Funding Raised</p>
                            <p className="text-sm font-medium">{companyProfile.fundingRaised}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Social & Content Signals - LinkedIn followers, blog posts */}
              {(() => {
                const linkedIn = companyProfile.linkedInEngagement as { followers?: number; posts?: number; reactions?: number; comments?: number } | null;
                const blog = companyProfile.blogSnapshot as { postCount?: number; latestTitles?: string[] } | null;
                const hasSocialData = linkedIn?.followers || blog?.postCount;
                
                if (!hasSocialData) return null;
                
                return (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <TrendingUp className="w-5 h-5 text-primary" />
                        Social & Content Signals
                      </CardTitle>
                      <CardDescription>LinkedIn presence and blog activity</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {linkedIn?.followers && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Linkedin className="w-5 h-5 text-[#0A66C2]" />
                              <span className="font-medium">LinkedIn</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-muted-foreground">Followers</p>
                                <p className="text-lg font-semibold">{linkedIn.followers.toLocaleString()}</p>
                              </div>
                              {linkedIn.posts && (
                                <div>
                                  <p className="text-muted-foreground">Recent Posts</p>
                                  <p className="text-lg font-semibold">{linkedIn.posts}</p>
                                </div>
                              )}
                              {linkedIn.reactions && (
                                <div>
                                  <p className="text-muted-foreground">Reactions</p>
                                  <p className="text-lg font-semibold">{linkedIn.reactions.toLocaleString()}</p>
                                </div>
                              )}
                              {linkedIn.comments && (
                                <div>
                                  <p className="text-muted-foreground">Comments</p>
                                  <p className="text-lg font-semibold">{linkedIn.comments.toLocaleString()}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {blog?.postCount && blog.postCount > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Rss className="w-5 h-5 text-orange-500" />
                              <span className="font-medium">Blog / Insights</span>
                              <Badge variant="secondary">{blog.postCount} posts</Badge>
                            </div>
                            {blog.latestTitles && blog.latestTitles.length > 0 && (
                              <ul className="space-y-1 text-sm text-muted-foreground">
                                {blog.latestTitles.slice(0, 5).map((title, i) => (
                                  <li key={i} className="truncate">• {title}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Tracked Sources - show what pages/URLs are being monitored */}
              {(() => {
                const crawlData = companyProfile.crawlData as { pages?: { url: string; type?: string; title?: string }[]; crawledAt?: string } | null;
                const hasSources = companyProfile.websiteUrl || companyProfile.linkedInUrl || companyProfile.blogUrl || (crawlData?.pages && crawlData.pages.length > 0);
                
                if (!hasSources) return null;
                
                return (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Globe className="w-5 h-5 text-primary" />
                        Tracked Sources
                      </CardTitle>
                      <CardDescription>Pages and profiles being monitored</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Website & Crawled Pages */}
                      {companyProfile.websiteUrl && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                              <Globe className="w-4 h-4 text-muted-foreground" />
                              Website
                            </span>
                            {companyProfile.lastCrawl && (
                              <div className="flex items-center gap-2">
                                <StalenessDot 
                                  lastUpdated={companyProfile.lastCrawl} 
                                  label="Website data freshness"
                                  size="sm"
                                />
                                <span className="text-xs text-muted-foreground">
                                  Last crawled: {new Date(companyProfile.lastCrawl).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="pl-6 space-y-1">
                            <a href={companyProfile.websiteUrl} target="_blank" rel="noopener noreferrer" 
                               className="text-xs text-primary hover:underline block truncate">
                              {companyProfile.websiteUrl}
                            </a>
                            {crawlData?.pages && crawlData.pages.length > 0 && (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium">{crawlData.pages.length} pages tracked:</span>
                                <ul className="mt-1 space-y-0.5">
                                  {crawlData.pages.slice(0, 6).map((page, i) => (
                                    <li key={i} className="truncate flex items-center gap-1">
                                      <span className="text-muted-foreground/50">•</span>
                                      <span className="capitalize text-muted-foreground/70">{page.type || 'page'}</span>
                                      <a href={page.url} target="_blank" rel="noopener noreferrer" 
                                         className="hover:underline truncate">
                                        {page.url.replace(companyProfile.websiteUrl || '', '') || '/'}
                                      </a>
                                    </li>
                                  ))}
                                  {crawlData.pages.length > 6 && (
                                    <li className="text-muted-foreground/50">+{crawlData.pages.length - 6} more</li>
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Social Profiles */}
                      {(companyProfile.linkedInUrl || companyProfile.instagramUrl || companyProfile.twitterUrl) && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Social Profiles</span>
                            {companyProfile.lastSocialCrawl && (
                              <span className="text-xs text-muted-foreground">
                                Last checked: {new Date(companyProfile.lastSocialCrawl).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div className="pl-6 space-y-1">
                            {companyProfile.linkedInUrl && (
                              <a href={companyProfile.linkedInUrl} target="_blank" rel="noopener noreferrer"
                                 className="text-xs text-primary hover:underline flex items-center gap-2">
                                <Linkedin className="w-3 h-3" />
                                {companyProfile.linkedInUrl.replace('https://www.linkedin.com/company/', '').replace('/', '')}
                              </a>
                            )}
                            {companyProfile.instagramUrl && (
                              <a href={companyProfile.instagramUrl} target="_blank" rel="noopener noreferrer"
                                 className="text-xs text-primary hover:underline flex items-center gap-2">
                                <Instagram className="w-3 h-3" />
                                {companyProfile.instagramUrl.replace('https://www.instagram.com/', '').replace('/', '')}
                              </a>
                            )}
                            {companyProfile.twitterUrl && (
                              <a href={companyProfile.twitterUrl} target="_blank" rel="noopener noreferrer"
                                 className="text-xs text-primary hover:underline flex items-center gap-2">
                                <Twitter className="w-3 h-3" />
                                {companyProfile.twitterUrl.replace('https://twitter.com/', '').replace('https://x.com/', '').replace('/', '')}
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Blog URL */}
                      {companyProfile.blogUrl && (
                        <div className="space-y-2">
                          <span className="text-sm font-medium flex items-center gap-2">
                            <Rss className="w-4 h-4 text-muted-foreground" />
                            Blog / RSS Feed
                          </span>
                          <div className="pl-6">
                            <a href={companyProfile.blogUrl} target="_blank" rel="noopener noreferrer"
                               className="text-xs text-primary hover:underline truncate block">
                              {companyProfile.blogUrl}
                            </a>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

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
      {companyProfile && (
        <ManualResearchDialog
          open={manualResearchOpen}
          onOpenChange={setManualResearchOpen}
          entityType="company"
          entityId={companyProfile.id}
          entityName={companyProfile.companyName}
          entityUrl={companyProfile.websiteUrl}
        />
      )}
    </AppLayout>
  );
}
