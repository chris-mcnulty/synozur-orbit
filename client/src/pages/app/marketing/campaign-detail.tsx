import { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
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
  XCircle,
  AlertCircle,
  Filter,
  CalendarDays,
  FileDown,
  Copy,
  Package,
  ChevronDown,
  Lightbulb,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { format, addDays } from "date-fns";

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
  productIds?: string[];
  assets: CampaignAsset[];
  socialAccounts: CampaignSocialAccount[];
}

interface MarketProduct {
  id: string;
  name: string;
  isBaseline: boolean;
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
  scheduledDate?: string;
}

interface GeneratedEmail {
  id: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  platform?: string;
  tone?: string;
  callToAction?: string;
  recipientContext?: string;
  subjectLineSuggestions?: string[];
  coachingTips?: string[];
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
  const [, navigate] = useLocation();
  const [emailPlatform, setEmailPlatform] = useState("outlook");
  const [emailTone, setEmailTone] = useState("professional");
  const [emailCallToAction, setEmailCallToAction] = useState("");
  const [emailRecipientContext, setEmailRecipientContext] = useState("");
  const [emailInstructions, setEmailInstructions] = useState("");
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<GeneratedEmail | null>(null);
  const [coachingTipsOpen, setCoachingTipsOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [imagePickerPostId, setImagePickerPostId] = useState<string | null>(null);
  const [addingAssets, setAddingAssets] = useState(false);
  const [selectedNewAssets, setSelectedNewAssets] = useState<string[]>([]);
  const [postFilter, setPostFilter] = useState<string>("active");
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editingEmailPlatform, setEditingEmailPlatform] = useState<string>("outlook");
  const [editEmailSubject, setEditEmailSubject] = useState("");
  const [editEmailBody, setEditEmailBody] = useState("");

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

  const { data: marketProducts = [] } = useQuery<MarketProduct[]>({
    queryKey: ["/api/marketing/products"],
    queryFn: async () => {
      const r = await fetch("/api/marketing/products", { credentials: "include" });
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

  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: "Post deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateCampaignProductsMutation = useMutation({
    mutationFn: async (productIds: string[]) => {
      const r = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ productIds }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Products updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleCampaignProduct = (productId: string) => {
    if (!campaign) return;
    const current = campaign.productIds || [];
    const updated = current.includes(productId)
      ? current.filter(x => x !== productId)
      : [...current, productId];
    updateCampaignProductsMutation.mutate(updated);
  };

  const updateCampaignStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const r = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({ title: "Campaign status updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateEmailMutation = useMutation({
    mutationFn: async ({ emailId, subject, body, isHtml }: { emailId: string; subject: string; body: string; isHtml: boolean }) => {
      const payload: Record<string, string> = { subject };
      if (isHtml) {
        payload.htmlBody = body;
      } else {
        payload.textBody = body;
      }
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setEditingEmailId(null);
      toast({ title: "Email updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const duplicateCampaignMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/duplicate`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (data: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign duplicated" });
      navigate(`/app/marketing/campaigns/${data.id}`);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const schedulePostsMutation = useMutation({
    mutationFn: async () => {
      if (!campaign?.startDate || !campaign?.numberOfDays) throw new Error("Campaign has no schedule configured");
      const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected");
      if (activePosts.length === 0) throw new Error("No active posts to schedule");

      const eligibleDates: Date[] = [];
      const start = new Date(campaign.startDate);
      let current = new Date(start);
      while (eligibleDates.length < campaign.numberOfDays) {
        const dow = current.getDay();
        const skip = (dow === 0 && !campaign.includeSunday) || (dow === 6 && !campaign.includeSaturday);
        if (!skip) {
          eligibleDates.push(new Date(current));
        }
        current = addDays(current, 1);
      }

      const results = await Promise.all(activePosts.map(async (post, i) => {
        const dateIndex = i % eligibleDates.length;
        const r = await fetch(`/api/campaigns/${id}/generated-posts/${post.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scheduledDate: eligibleDates[dateIndex].toISOString() }),
        });
        if (!r.ok) throw new Error(`Failed to schedule post ${post.id}`);
        return r.json();
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: "Posts scheduled across campaign timeline" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const exportScheduleCSV = () => {
    const scheduled = posts.filter(p => p.scheduledDate && p.status !== "deleted");
    if (scheduled.length === 0) {
      toast({ title: "No scheduled posts to export", variant: "destructive" });
      return;
    }
    const sorted = [...scheduled].sort((a, b) => new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime());
    const rows = [["Platform", "Scheduled Date", "Status", "Content", "Hashtags"]];
    sorted.forEach(p => {
      rows.push([
        p.platform,
        format(new Date(p.scheduledDate!), "yyyy-MM-dd"),
        p.status,
        `"${(p.editedContent || p.content).replace(/"/g, '""')}"`,
        p.hashtags?.join(" ") || "",
      ]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaign?.name || "campaign"}-schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const [csvFormat, setCsvFormat] = useState<string>("socialpilot");

  const exportCsvMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/export-csv?format=${csvFormat}`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign-posts-${csvFormat}.csv`;
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
        body: JSON.stringify({
          campaignId: id,
          assetIds,
          instructions: emailInstructions,
          platform: emailPlatform,
          tone: emailTone,
          callToAction: emailCallToAction || undefined,
          recipientContext: emailRecipientContext || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const data = await r.json();
      setPreviewEmail({
        id: "",
        subject: data.subject,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        platform: data.platform,
        subjectLineSuggestions: data.subjectLineSuggestions,
        coachingTips: data.coachingTips,
        status: "draft",
        createdAt: new Date().toISOString(),
      });
      setCoachingTipsOpen(false);
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
        body: JSON.stringify({
          campaignId: id,
          platform: emailPlatform,
          tone: emailTone,
          callToAction: emailCallToAction || undefined,
          recipientContext: emailRecipientContext || undefined,
          subjectLineSuggestions: previewEmail.subjectLineSuggestions,
          coachingTips: previewEmail.coachingTips,
          ...previewEmail,
        }),
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

  const prevJobStatus = useRef(jobStatus?.status);
  useEffect(() => {
    const prev = prevJobStatus.current;
    const curr = jobStatus?.status;
    if ((prev === "running" || prev === "pending") && (curr === "completed" || curr === "failed")) {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      if (curr === "completed") {
        toast({ title: "Posts generated", description: "Your AI-generated posts are ready for review." });
      }
    }
    prevJobStatus.current = curr;
  }, [jobStatus?.status, id, queryClient, toast]);

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
            <div className="flex flex-wrap items-center gap-1 mt-2" data-testid="campaign-detail-products">
              {campaign.productIds && campaign.productIds.length > 0 && campaign.productIds.map(pid => {
                const product = marketProducts.find(p => p.id === pid);
                return product ? (
                  <Badge key={pid} variant="outline" className="text-[10px] gap-1">
                    <Package className="w-2.5 h-2.5" />{product.name}
                  </Badge>
                ) : null;
              })}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" data-testid="button-edit-campaign-products">
                    <Package className="w-3 h-3" />
                    {campaign.productIds && campaign.productIds.length > 0 ? "Edit" : "Add Products"}
                    <ChevronDown className="w-3 h-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64 max-h-48 overflow-y-auto">
                  {marketProducts.length === 0 ? (
                    <div className="px-2 py-1 text-sm text-muted-foreground">No products in this market</div>
                  ) : marketProducts.map(p => (
                    <DropdownMenuCheckboxItem
                      key={p.id}
                      checked={(campaign.productIds || []).includes(p.id)}
                      onCheckedChange={() => toggleCampaignProduct(p.id)}
                      data-testid={`checkbox-edit-campaign-product-${p.id}`}
                    >
                      {p.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => duplicateCampaignMutation.mutate()}
              disabled={duplicateCampaignMutation.isPending}
              data-testid="button-duplicate-campaign"
            >
              <Copy className="w-3.5 h-3.5" />
              {duplicateCampaignMutation.isPending ? "Duplicating..." : "Duplicate"}
            </Button>
            <Select
              value={campaign.status}
              onValueChange={v => updateCampaignStatusMutation.mutate(v)}
            >
              <SelectTrigger className="w-40" data-testid="select-campaign-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
                <div className="flex items-center gap-2">
                  <Select value={csvFormat} onValueChange={setCsvFormat}>
                    <SelectTrigger className="w-36" data-testid="select-csv-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="socialpilot">SocialPilot</SelectItem>
                      <SelectItem value="hootsuite">Hootsuite</SelectItem>
                      <SelectItem value="buffer">Buffer</SelectItem>
                      <SelectItem value="later">Later</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="gap-2" onClick={() => exportCsvMutation.mutate()} disabled={exportCsvMutation.isPending} data-testid="button-export-csv-posts">
                    <Download className="w-4 h-4" />Export CSV
                  </Button>
                </div>
              )}
              {jobStatus?.status === "completed" && posts.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] })} data-testid="button-refresh-posts">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
              {posts.length > 0 && campaign?.startDate && campaign?.numberOfDays && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => schedulePostsMutation.mutate()}
                  disabled={schedulePostsMutation.isPending}
                  data-testid="button-schedule-posts"
                >
                  <CalendarDays className="w-3.5 h-3.5" />
                  {schedulePostsMutation.isPending ? "Scheduling..." : "Schedule Posts"}
                </Button>
              )}
              {posts.some(p => p.scheduledDate) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={exportScheduleCSV}
                  data-testid="button-export-csv"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Export CSV
                </Button>
              )}
            </div>

            {isGenerating && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-primary/30 bg-primary/5" data-testid="status-generating-posts">
                <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Generating social posts...</p>
                  <p className="text-xs text-muted-foreground">
                    {jobStatus?.status === "pending" ? "Queued — waiting to start..." : "AI is writing your posts. This usually takes 30–60 seconds."}
                  </p>
                </div>
              </div>
            )}

            {jobStatus?.status === "failed" && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5" data-testid="status-generation-failed">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Post generation failed</p>
                  <p className="text-xs text-muted-foreground">Something went wrong. Try generating again.</p>
                </div>
              </div>
            )}

            {posts.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <Select value={postFilter} onValueChange={setPostFilter}>
                  <SelectTrigger className="w-36" data-testid="select-post-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {posts.length === 0 && !isGenerating ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-posts">
                  {jobStatus?.status === "failed" ? "Generation failed. Click Generate Posts to try again." : "No posts yet. Click Generate Posts to create AI-powered social content."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {posts.filter(p => {
                  if (postFilter === "all") return p.status !== "deleted";
                  if (postFilter === "active") return p.status !== "deleted" && p.status !== "rejected";
                  return p.status === postFilter;
                }).map(post => {
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
                            {post.status !== "rejected" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-orange-600"
                                onClick={() => updatePostMutation.mutate({ postId: post.id, status: "rejected" })}
                                data-testid={`button-reject-${post.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-destructive"
                              onClick={() => deletePostMutation.mutate(post.id)}
                              data-testid={`button-delete-post-${post.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {post.status === "approved" && <Badge variant="outline" className="text-green-600 border-green-200">Approved</Badge>}
                          {post.status === "rejected" && <Badge variant="outline" className="text-orange-600 border-orange-200">Rejected</Badge>}
                          {post.scheduledDate && (
                            <Badge variant="secondary" className="text-[10px] gap-1">
                              <Calendar className="w-2.5 h-2.5" />{format(new Date(post.scheduledDate), "MMM d, yyyy")}
                            </Badge>
                          )}
                        </div>
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
                <CardDescription>AI will use the campaign's content assets and marketing grounding docs to draft an email for your chosen platform.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Platform</label>
                    <Select value={emailPlatform} onValueChange={setEmailPlatform}>
                      <SelectTrigger data-testid="select-email-platform">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="outlook">Outlook</SelectItem>
                        <SelectItem value="hubspot-marketing">HubSpot Marketing Email</SelectItem>
                        <SelectItem value="hubspot-1to1">HubSpot 1:1 Email</SelectItem>
                        <SelectItem value="dynamics-365">Dynamics 365 Customer Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Tone</label>
                    <Select value={emailTone} onValueChange={setEmailTone}>
                      <SelectTrigger data-testid="select-email-tone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Call to Action (optional)</label>
                  <Input
                    value={emailCallToAction}
                    onChange={e => setEmailCallToAction(e.target.value)}
                    placeholder="e.g. Book a demo, Download the whitepaper..."
                    data-testid="input-email-cta"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Recipient Context (optional)</label>
                  <Input
                    value={emailRecipientContext}
                    onChange={e => setEmailRecipientContext(e.target.value)}
                    placeholder="e.g. IT decision makers at mid-market companies..."
                    data-testid="input-email-recipient-context"
                  />
                </div>
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
                <CardContent className="space-y-4">
                  {previewEmail.subjectLineSuggestions && previewEmail.subjectLineSuggestions.length > 0 && (
                    <div>
                      <label className="text-sm font-medium mb-2 block">Subject Line Suggestions</label>
                      <ol className="space-y-1">
                        {previewEmail.subjectLineSuggestions.map((line, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 text-sm border rounded px-3 py-2 bg-muted/30" data-testid={`text-subject-suggestion-${i}`}>
                            <span>{i + 1}. {line}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 shrink-0"
                              onClick={() => {
                                navigator.clipboard.writeText(line);
                                toast({ title: "Copied", description: "Subject line copied to clipboard" });
                              }}
                              data-testid={`button-copy-subject-${i}`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {previewEmail.platform === "hubspot-marketing" ? (
                    <div
                      className="border rounded p-4 bg-white text-sm max-h-96 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewEmail.htmlBody) }}
                      data-testid="preview-email-html"
                    />
                  ) : (
                    <pre className="border rounded p-4 bg-white text-sm max-h-96 overflow-y-auto whitespace-pre-wrap font-sans" data-testid="preview-email-text">
                      {previewEmail.textBody || previewEmail.htmlBody}
                    </pre>
                  )}

                  {previewEmail.coachingTips && previewEmail.coachingTips.length > 0 && (
                    <Collapsible open={coachingTipsOpen} onOpenChange={setCoachingTipsOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 w-full justify-start text-muted-foreground" data-testid="button-toggle-coaching-tips">
                          <Lightbulb className="w-4 h-4" />
                          Coaching Tips
                          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${coachingTipsOpen ? "rotate-180" : ""}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground pl-6 list-disc">
                          {previewEmail.coachingTips.map((tip, i) => (
                            <li key={i} data-testid={`text-coaching-tip-${i}`}>{tip}</li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              </Card>
            )}

            {savedEmails.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Saved Emails</h3>
                {savedEmails.map(email => (
                  <Card key={email.id}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{email.subject}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {email.platform && (
                              <Badge variant="secondary" className="text-[10px]">
                                {{"outlook":"Outlook","hubspot-marketing":"HubSpot Marketing","hubspot-1to1":"HubSpot 1:1","dynamics-365":"Dynamics 365"}[email.platform] || email.platform}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">{new Date(email.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">{email.status}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingEmailId(email.id);
                              setEditingEmailPlatform(email.platform || "outlook");
                              setEditEmailSubject(email.subject);
                              setEditEmailBody(email.platform === "hubspot-marketing" ? email.htmlBody : (email.textBody || email.htmlBody));
                            }}
                            data-testid={`button-edit-email-${email.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Edit Email Dialog */}
            <Dialog open={!!editingEmailId} onOpenChange={v => { if (!v) setEditingEmailId(null); }}>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Email</DialogTitle>
                  <DialogDescription>Modify the subject line and email body.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Subject</Label>
                    <Input value={editEmailSubject} onChange={e => setEditEmailSubject(e.target.value)} data-testid="input-edit-email-subject" />
                  </div>
                  <div>
                    <Label>{editingEmailPlatform === "hubspot-marketing" ? "HTML Body" : "Email Body"}</Label>
                    <Textarea value={editEmailBody} onChange={e => setEditEmailBody(e.target.value)} rows={12} className="font-mono text-xs" data-testid="input-edit-email-body" />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!editEmailSubject.trim() || updateEmailMutation.isPending}
                    onClick={() => {
                      if (editingEmailId) {
                        updateEmailMutation.mutate({
                          emailId: editingEmailId,
                          subject: editEmailSubject,
                          body: editEmailBody,
                          isHtml: editingEmailPlatform === "hubspot-marketing",
                        });
                      }
                    }}
                    data-testid="button-save-edit-email"
                  >
                    {updateEmailMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
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
