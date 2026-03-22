import { useState } from "react";
import DOMPurify from "dompurify";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import {
  Share2,
  Mail,
  Sparkles,
  Loader2,
  Download,
  CheckCircle,
  Library,
  AtSign,
  RefreshCw,
  Pencil,
  Trash2,
  ImageIcon,
  Calendar,
  Image as ImageLucide,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  numberOfDays?: number;
  includeSaturday?: boolean;
  includeSunday?: boolean;
  assets: CampaignAsset[];
  socialAccounts: CampaignSocialAccount[];
}

interface CampaignAsset {
  id: string;
  assetId: string;
  overrideTitle?: string;
  sortOrder: number;
}

interface CampaignSocialAccount {
  id: string;
  socialAccountId: string;
}

interface ContentAsset {
  id: string;
  title: string;
  description?: string;
  leadImageUrl?: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
}

interface GeneratedPost {
  id: string;
  platform: string;
  content: string;
  editedContent?: string;
  hashtags: string[];
  status: string;
  variantGroup?: string;
  overrideImageUrl?: string;
  overrideBrandAssetId?: string;
}

interface GeneratedEmail {
  id: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  status: string;
  createdAt: string;
}

interface BrandAsset {
  id: string;
  name: string;
  fileUrl?: string;
  url?: string;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [emailInstructions, setEmailInstructions] = useState("");
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<GeneratedEmail | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [imagePickerPostId, setImagePickerPostId] = useState<string | null>(null);
  const [addingAssets, setAddingAssets] = useState(false);
  const [selectedNewAssets, setSelectedNewAssets] = useState<string[]>([]);

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: [`/api/campaigns/${id}`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Campaign not found");
      return r.json();
    },
  });

  const { data: allAssets = [] } = useQuery<ContentAsset[]>({
    queryKey: ["/api/content-assets"],
    queryFn: async () => {
      const r = await fetch("/api/content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: allSocialAccounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: brandAssets = [] } = useQuery<BrandAsset[]>({
    queryKey: ["/api/brand-assets"],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: posts = [] } = useQuery<GeneratedPost[]>({
    queryKey: [`/api/campaigns/${id}/generated-posts`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: jobStatus } = useQuery<{ status: string }>({
    queryKey: [`/api/campaigns/${id}/generate-posts-status`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/generate-posts-status`, { credentials: "include" });
      return r.ok ? r.json() : { status: "idle" };
    },
    refetchInterval: (data: any) => (data?.status === "running" || data?.status === "pending") ? 3000 : false,
  });

  const { data: savedEmails = [] } = useQuery<GeneratedEmail[]>({
    queryKey: ["/api/email/saved"],
    queryFn: async () => {
      const r = await fetch("/api/email/saved", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const generatePostsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/generate-posts`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generate-posts-status`] });
      toast({ title: "Post generation started", description: "Posts will appear once generation is complete." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updatePostMutation = useMutation({
    mutationFn: async ({ postId, editedContent, status, overrideImageUrl, overrideBrandAssetId }: {
      postId: string; editedContent?: string; status?: string;
      overrideImageUrl?: string; overrideBrandAssetId?: string;
    }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editedContent, status, overrideImageUrl, overrideBrandAssetId }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      setEditingPostId(null);
      setImagePickerPostId(null);
    },
  });

  const addAssetsMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      const r = await fetch(`/api/campaigns/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ assetIds }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      setAddingAssets(false);
      setSelectedNewAssets([]);
    },
  });

  const removeAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const r = await fetch(`/api/campaigns/${id}/assets/${assetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to remove asset");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] }),
  });

  const addSocialAccountMutation = useMutation({
    mutationFn: async (socialAccountId: string) => {
      const r = await fetch(`/api/campaigns/${id}/social-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialAccountId }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] }),
  });

  const removeSocialAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const r = await fetch(`/api/campaigns/${id}/social-accounts/${accountId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to remove account");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] }),
  });

  const exportCsvMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/export-csv`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign-posts.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err: Error) => toast({ title: "Export failed", description: err.message, variant: "destructive" }),
  });

  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    try {
      const assetIds = campaign?.assets.map(a => a.assetId) ?? [];
      const r = await fetch("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campaignId: id, assetIds, instructions: emailInstructions }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const data = await r.json();
      setPreviewEmail({ id: "", subject: data.subject, htmlBody: data.htmlBody, textBody: data.textBody, status: "draft", createdAt: new Date().toISOString() });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingEmail(false);
    }
  };

  const saveEmailMutation = useMutation({
    mutationFn: async () => {
      if (!previewEmail) return;
      const r = await fetch("/api/email/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campaignId: id, ...previewEmail }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setPreviewEmail(null);
      toast({ title: "Email saved" });
    },
  });

  const linkedAssetIds = new Set(campaign?.assets.map(a => a.assetId) ?? []);
  const linkedSocialIds = new Set(campaign?.socialAccounts.map(a => a.socialAccountId) ?? []);
  const availableAssets = allAssets.filter(a => !linkedAssetIds.has(a.id));
  const availableSocial = allSocialAccounts.filter(a => !linkedSocialIds.has(a.id));

  const isGenerating = jobStatus?.status === "running" || jobStatus?.status === "pending";

  const getPostImage = (post: GeneratedPost): string | null => {
    if (post.overrideImageUrl) return post.overrideImageUrl;
    if (post.overrideBrandAssetId) {
      const ba = brandAssets.find(b => b.id === post.overrideBrandAssetId);
      if (ba) return ba.fileUrl || ba.url || null;
    }
    const firstAsset = campaign?.assets?.[0];
    if (firstAsset) {
      const asset = allAssets.find(a => a.id === firstAsset.assetId);
      if (asset?.leadImageUrl) return asset.leadImageUrl;
    }
    return null;
  };

  const toggleNewAsset = (assetId: string) => {
    setSelectedNewAssets(prev =>
      prev.includes(assetId) ? prev.filter(a => a !== assetId) : [...prev, assetId]
    );
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!campaign) {
    return (
      <AppLayout>
        <div className="p-6 text-center text-muted-foreground">Campaign not found.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-campaign-name">{campaign.name}</h1>
            {campaign.description && <p className="text-muted-foreground text-sm mt-1">{campaign.description}</p>}
            {campaign.startDate && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                <Calendar className="w-3 h-3" />
                {format(new Date(campaign.startDate), "MMM d, yyyy")}
                {campaign.endDate && <> — {format(new Date(campaign.endDate), "MMM d, yyyy")}</>}
                {campaign.numberOfDays && <span className="ml-1">({campaign.numberOfDays} days)</span>}
                {campaign.includeSaturday && <Badge variant="secondary" className="text-[10px] ml-1">Sat</Badge>}
                {campaign.includeSunday && <Badge variant="secondary" className="text-[10px]">Sun</Badge>}
              </div>
            )}
          </div>
          <Badge variant="outline" className="capitalize">{campaign.status}</Badge>
        </div>

        <Tabs defaultValue="posts">
          <TabsList>
            <TabsTrigger value="posts" className="gap-1.5" data-testid="tab-posts"><Share2 className="w-3.5 h-3.5" />Social Posts</TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5" data-testid="tab-email"><Mail className="w-3.5 h-3.5" />Email</TabsTrigger>
            <TabsTrigger value="assets" className="gap-1.5" data-testid="tab-assets"><Library className="w-3.5 h-3.5" />Assets ({campaign.assets.length})</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1.5" data-testid="tab-accounts"><AtSign className="w-3.5 h-3.5" />Social Accounts ({campaign.socialAccounts.length})</TabsTrigger>
          </TabsList>

          {/* Social Posts */}
          <TabsContent value="posts" className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => generatePostsMutation.mutate()}
                disabled={isGenerating || generatePostsMutation.isPending}
                className="gap-2"
                data-testid="button-generate-posts"
              >
                {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Posts</>}
              </Button>
              {posts.filter(p => p.status === "approved").length > 0 && (
                <Button variant="outline" className="gap-2" onClick={() => exportCsvMutation.mutate()} disabled={exportCsvMutation.isPending} data-testid="button-export-csv">
                  <Download className="w-4 h-4" />Export CSV (SocialPilot)
                </Button>
              )}
              {jobStatus?.status === "completed" && posts.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] })} data-testid="button-refresh-posts">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {posts.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-posts">
                  {isGenerating ? "Generating posts... this may take a moment." : "No posts yet. Click Generate Posts to create AI-powered social content."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {posts.map(post => {
                  const postImage = getPostImage(post);
                  return (
                    <Card key={post.id} data-testid={`card-post-${post.id}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge>{post.platform}</Badge>
                            {post.variantGroup && <span className="text-[10px] text-muted-foreground">variant</span>}
                          </div>
                          <div className="flex gap-1">
                            {post.status !== "approved" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-green-600"
                                onClick={() => updatePostMutation.mutate({ postId: post.id, status: "approved" })}
                                data-testid={`button-approve-${post.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />Approve
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingPostId(post.id);
                                setEditContent(post.editedContent ?? post.content);
                              }}
                              data-testid={`button-edit-${post.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setImagePickerPostId(post.id)}
                              data-testid={`button-change-image-${post.id}`}
                            >
                              <ImageLucide className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 space-y-2">
                        {postImage && (
                          <div className="rounded-lg overflow-hidden bg-muted aspect-video relative">
                            <img
                              src={postImage}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={e => (e.currentTarget.style.display = "none")}
                              data-testid={`img-post-${post.id}`}
                            />
                            {post.overrideImageUrl && (
                              <Badge variant="secondary" className="absolute bottom-1 right-1 text-[10px]">
                                <ImageIcon className="w-2.5 h-2.5 mr-0.5" /> Override
                              </Badge>
                            )}
                          </div>
                        )}
                        {editingPostId === post.id ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editContent}
                              onChange={e => setEditContent(e.target.value)}
                              rows={5}
                              data-testid={`textarea-edit-${post.id}`}
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => updatePostMutation.mutate({ postId: post.id, editedContent: editContent })} data-testid={`button-save-edit-${post.id}`}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingPostId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{post.editedContent ?? post.content}</p>
                        )}
                        {post.hashtags?.length > 0 && (
                          <p className="text-xs text-primary">#{post.hashtags.join(" #")}</p>
                        )}
                        {post.status === "approved" && <Badge variant="outline" className="text-green-600 border-green-200">Approved</Badge>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Email */}
          <TabsContent value="email" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Generate Email</CardTitle>
                <CardDescription>AI will use the campaign's content assets and marketing grounding docs to draft a promotional email.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Additional Instructions (optional)</label>
                  <Textarea
                    value={emailInstructions}
                    onChange={e => setEmailInstructions(e.target.value)}
                    placeholder="e.g. Focus on the enterprise audience, highlight ROI..."
                    rows={3}
                    data-testid="input-email-instructions"
                  />
                </div>
                <Button onClick={handleGenerateEmail} disabled={generatingEmail} className="gap-2" data-testid="button-generate-email">
                  {generatingEmail ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Email</>}
                </Button>
              </CardContent>
            </Card>

            {previewEmail && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Preview: {previewEmail.subject}</CardTitle>
                    <Button size="sm" onClick={() => saveEmailMutation.mutate()} disabled={saveEmailMutation.isPending} data-testid="button-save-email">
                      Save Email
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    className="border rounded p-4 bg-white text-sm max-h-96 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewEmail.htmlBody) }}
                  />
                </CardContent>
              </Card>
            )}

            {savedEmails.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Saved Emails</h3>
                {savedEmails.map(email => (
                  <Card key={email.id}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{email.subject}</p>
                        <p className="text-xs text-muted-foreground">{new Date(email.createdAt).toLocaleDateString()}</p>
                      </div>
                      <Badge variant="outline" className="capitalize">{email.status}</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Assets */}
          <TabsContent value="assets" className="space-y-4">
            {campaign.assets.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">In this campaign</h3>
                <div className="grid gap-2">
                  {campaign.assets.map(ca => {
                    const asset = allAssets.find(a => a.id === ca.assetId);
                    return (
                      <Card key={ca.id} data-testid={`card-campaign-asset-${ca.assetId}`}>
                        <CardContent className="py-3 flex items-center gap-3">
                          {asset?.leadImageUrl && (
                            <img
                              src={asset.leadImageUrl}
                              alt=""
                              className="w-12 h-12 rounded object-cover shrink-0"
                              onError={e => (e.currentTarget.style.display = "none")}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ca.overrideTitle ?? asset?.title ?? ca.assetId}</p>
                            {asset?.description && <p className="text-xs text-muted-foreground truncate">{asset.description}</p>}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 text-destructive"
                            onClick={() => removeAssetMutation.mutate(ca.assetId)}
                            data-testid={`button-remove-asset-${ca.assetId}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {availableAssets.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">Add from Content Library</h3>
                  {!addingAssets ? (
                    <Button variant="outline" size="sm" onClick={() => setAddingAssets(true)} data-testid="button-add-assets">
                      Add Assets
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={selectedNewAssets.length === 0 || addAssetsMutation.isPending}
                        onClick={() => addAssetsMutation.mutate(selectedNewAssets)}
                        data-testid="button-confirm-add-assets"
                      >
                        {addAssetsMutation.isPending ? "Adding..." : `Add ${selectedNewAssets.length} Asset(s)`}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setAddingAssets(false); setSelectedNewAssets([]); }}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
                {addingAssets && (
                  <div className="border rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                    {availableAssets.map(asset => (
                      <label
                        key={asset.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                        data-testid={`checkbox-add-asset-${asset.id}`}
                      >
                        <Checkbox
                          checked={selectedNewAssets.includes(asset.id)}
                          onCheckedChange={() => toggleNewAsset(asset.id)}
                        />
                        {asset.leadImageUrl && (
                          <img src={asset.leadImageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{asset.title}</p>
                          {asset.description && <p className="text-xs text-muted-foreground truncate">{asset.description}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {campaign.assets.length === 0 && availableAssets.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-assets">
                  No content assets available. Add assets to the Content Library first.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Social Accounts */}
          <TabsContent value="accounts" className="space-y-4">
            {campaign.socialAccounts.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Linked accounts</h3>
                <div className="grid gap-2">
                  {campaign.socialAccounts.map(csa => {
                    const account = allSocialAccounts.find(a => a.id === csa.socialAccountId);
                    return (
                      <Card key={csa.id} data-testid={`card-social-account-${csa.socialAccountId}`}>
                        <CardContent className="py-3 flex items-center gap-3">
                          <Badge>{account?.platform ?? "unknown"}</Badge>
                          <span className="text-sm flex-1">{account?.accountName ?? csa.socialAccountId}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 text-destructive"
                            onClick={() => removeSocialAccountMutation.mutate(csa.socialAccountId)}
                            data-testid={`button-remove-social-${csa.socialAccountId}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
            {availableSocial.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Add social account</h3>
                <div className="border rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                  {availableSocial.map(account => (
                    <div
                      key={account.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => addSocialAccountMutation.mutate(account.id)}
                      data-testid={`button-add-social-${account.id}`}
                    >
                      <Badge variant="outline">{account.platform}</Badge>
                      <span className="text-sm flex-1">{account.accountName}</span>
                      <Button variant="ghost" size="sm">Add</Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {campaign.socialAccounts.length === 0 && availableSocial.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-accounts">
                  No social accounts available. Add accounts in the Social Accounts section first.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Image Override Picker Dialog */}
      <Dialog open={!!imagePickerPostId} onOpenChange={v => !v && setImagePickerPostId(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Image</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Select a brand asset image to use for this post, or remove the override to use the default content asset image.</p>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                if (imagePickerPostId) {
                  updatePostMutation.mutate({
                    postId: imagePickerPostId,
                    overrideImageUrl: null as any,
                    overrideBrandAssetId: null as any,
                  });
                }
              }}
              data-testid="button-reset-image"
            >
              <X className="w-4 h-4" /> Use Default (Content Asset Lead Image)
            </Button>

            {brandAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No brand assets available. Add images in the Brand Library first.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {brandAssets.filter(ba => ba.fileUrl || ba.url).map(ba => (
                  <button
                    key={ba.id}
                    className="border rounded-lg p-2 hover:border-primary transition-colors text-left"
                    onClick={() => {
                      if (imagePickerPostId) {
                        updatePostMutation.mutate({
                          postId: imagePickerPostId,
                          overrideImageUrl: ba.fileUrl || ba.url || "",
                          overrideBrandAssetId: ba.id,
                        });
                      }
                    }}
                    data-testid={`button-brand-asset-${ba.id}`}
                  >
                    <img
                      src={ba.fileUrl || ba.url || ""}
                      alt={ba.name}
                      className="w-full aspect-video object-cover rounded"
                      onError={e => (e.currentTarget.style.display = "none")}
                    />
                    <p className="text-xs mt-1 truncate">{ba.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
