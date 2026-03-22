import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
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
}

interface GeneratedEmail {
  id: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  status: string;
  createdAt: string;
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
    mutationFn: async ({ postId, editedContent, status }: { postId: string; editedContent?: string; status?: string }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editedContent, status }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      setEditingPostId(null);
    },
  });

  const addAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const r = await fetch(`/api/campaigns/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ assetId }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
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
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            {campaign.description && <p className="text-muted-foreground text-sm mt-1">{campaign.description}</p>}
          </div>
          <Badge variant="outline" className="capitalize">{campaign.status}</Badge>
        </div>

        <Tabs defaultValue="posts">
          <TabsList>
            <TabsTrigger value="posts" className="gap-1.5"><Share2 className="w-3.5 h-3.5" />Social Posts</TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5"><Mail className="w-3.5 h-3.5" />Email</TabsTrigger>
            <TabsTrigger value="assets" className="gap-1.5"><Library className="w-3.5 h-3.5" />Assets</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1.5"><AtSign className="w-3.5 h-3.5" />Social Accounts</TabsTrigger>
          </TabsList>

          {/* ── Social Posts ── */}
          <TabsContent value="posts" className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => generatePostsMutation.mutate()}
                disabled={isGenerating || generatePostsMutation.isPending}
                className="gap-2"
              >
                {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Posts</>}
              </Button>
              {posts.filter(p => p.status === "approved").length > 0 && (
                <Button variant="outline" className="gap-2" onClick={() => exportCsvMutation.mutate()} disabled={exportCsvMutation.isPending}>
                  <Download className="w-4 h-4" />Export CSV (SocialPilot)
                </Button>
              )}
              {jobStatus?.status === "completed" && posts.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] })}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {posts.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  {isGenerating ? "Generating posts… this may take a moment." : "No posts yet. Click Generate Posts to create AI-powered social content."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {posts.map(post => (
                  <Card key={post.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <Badge>{post.platform}</Badge>
                        <div className="flex gap-1">
                          {post.status !== "approved" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-green-600"
                              onClick={() => updatePostMutation.mutate({ postId: post.id, status: "approved" })}
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
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {editingPostId === post.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            rows={5}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => updatePostMutation.mutate({ postId: post.id, editedContent: editContent })}>Save</Button>
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
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Email ── */}
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
                  />
                </div>
                <Button onClick={handleGenerateEmail} disabled={generatingEmail} className="gap-2">
                  {generatingEmail ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Email</>}
                </Button>
              </CardContent>
            </Card>

            {previewEmail && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Preview: {previewEmail.subject}</CardTitle>
                    <Button size="sm" onClick={() => saveEmailMutation.mutate()} disabled={saveEmailMutation.isPending}>
                      Save Email
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    className="border rounded p-4 bg-white text-sm max-h-96 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: previewEmail.htmlBody }}
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

          {/* ── Assets ── */}
          <TabsContent value="assets" className="space-y-4">
            {campaign.assets.length === 0 && availableAssets.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  No content assets available. Add assets to the Content Library first.
                </CardContent>
              </Card>
            )}
            {campaign.assets.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">In this campaign</h3>
                <div className="grid gap-2">
                  {campaign.assets.map(ca => {
                    const asset = allAssets.find(a => a.id === ca.assetId);
                    return (
                      <Card key={ca.id}>
                        <CardContent className="py-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{ca.overrideTitle ?? asset?.title ?? ca.assetId}</p>
                            {asset?.description && <p className="text-xs text-muted-foreground">{asset.description}</p>}
                          </div>
                          <Badge variant="secondary">Added</Badge>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
            {availableAssets.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Add from Content Library</h3>
                <Select onValueChange={v => addAssetMutation.mutate(v)}>
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Select an asset to add..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAssets.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </TabsContent>

          {/* ── Social Accounts ── */}
          <TabsContent value="accounts" className="space-y-4">
            {campaign.socialAccounts.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Linked accounts</h3>
                <div className="grid gap-2">
                  {campaign.socialAccounts.map(csa => {
                    const account = allSocialAccounts.find(a => a.id === csa.socialAccountId);
                    return (
                      <Card key={csa.id}>
                        <CardContent className="py-3 flex items-center gap-3">
                          <Badge>{account?.platform ?? "unknown"}</Badge>
                          <span className="text-sm">{account?.accountName ?? csa.socialAccountId}</span>
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
                <Select onValueChange={v => addSocialAccountMutation.mutate(v)}>
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Select account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSocial.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.platform} — {a.accountName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {campaign.socialAccounts.length === 0 && availableSocial.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  No social accounts available. Add accounts in the Social Accounts section first.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
