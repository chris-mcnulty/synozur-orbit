import { useState, useEffect, useRef } from "react";
import { OptimizedThumbnail } from "@/components/ui/optimized-thumbnail";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  Share2,
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
  Copy,
  Package,
  ChevronDown,
  ExternalLink,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
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
  alwaysHashtags?: string[];
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
  url?: string;
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
  sourceUrl?: string;
  scheduledDate?: string;
}


interface BrandAsset {
  id: string;
  name: string;
  fileUrl?: string;
  url?: string;
  categoryId?: string;
  categoryName?: string;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [imagePickerPostId, setImagePickerPostId] = useState<string | null>(null);
  const [addingAssets, setAddingAssets] = useState(false);
  const [selectedNewAssets, setSelectedNewAssets] = useState<string[]>([]);
  const [postFilter, setPostFilter] = useState<string>("active");
  const [editCampaignOpen, setEditCampaignOpen] = useState(false);
  const [editCampaignName, setEditCampaignName] = useState("");
  const [editCampaignDescription, setEditCampaignDescription] = useState("");
  const [editCampaignStartDate, setEditCampaignStartDate] = useState("");
  const [editCampaignEndDate, setEditCampaignEndDate] = useState("");
  const [editCampaignDays, setEditCampaignDays] = useState<number | "">("");
  const [editCampaignSaturday, setEditCampaignSaturday] = useState(false);
  const [editCampaignSunday, setEditCampaignSunday] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editCampaignAlwaysHashtags, setEditCampaignAlwaysHashtags] = useState("");
  const [editingPostHashtags, setEditingPostHashtags] = useState<string | null>(null);
  const [editHashtagsValue, setEditHashtagsValue] = useState("");
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedBrandImageIds, setSelectedBrandImageIds] = useState<string[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [brandCategoryFilter, setBrandCategoryFilter] = useState<string>("all");
  const [brandPage, setBrandPage] = useState(0);
  const BRAND_PAGE_SIZE = 12;
  const [pickerCategoryFilter, setPickerCategoryFilter] = useState<string>("all");
  const [pickerPage, setPickerPage] = useState(0);

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: [`/api/campaigns/${id}`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Campaign not found");
      return r.json();
    },
  });

  const { data: strategicContext } = useQuery<{ available: boolean; sections: Record<string, boolean> }>({
    queryKey: ["/api/strategic-context/summary"],
    queryFn: async () => {
      const r = await fetch("/api/strategic-context/summary", { credentials: "include" });
      return r.ok ? r.json() : { available: false, sections: {} };
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

  const { data: availablePersonas = [] } = useQuery<{ id: string; name: string; role: string | null; isIcp: boolean }[]>({
    queryKey: ["/api/personas"],
    queryFn: async () => {
      const r = await fetch("/api/personas", { credentials: "include" });
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


  const generatePostsMutation = useMutation({
    mutationFn: async ({ brandImageIds, personaIds }: { brandImageIds?: string[]; personaIds?: string[] }) => {
      const r = await fetch(`/api/campaigns/${id}/generate-posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandImageIds: brandImageIds || [], personaIds: personaIds || [] }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      setGenerateDialogOpen(false);
      setSelectedBrandImageIds([]);
      setSelectedPersonaIds([]);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generate-posts-status`] });
      toast({ title: "Post generation started", description: "Posts will appear once generation is complete." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updatePostMutation = useMutation({
    mutationFn: async ({ postId, editedContent, status, overrideImageUrl, overrideBrandAssetId, hashtags }: {
      postId: string; editedContent?: string; status?: string;
      overrideImageUrl?: string; overrideBrandAssetId?: string; hashtags?: string[];
    }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editedContent, status, overrideImageUrl, overrideBrandAssetId, hashtags }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      setEditingPostId(null);
      setEditingPostHashtags(null);
      setImagePickerPostId(null);
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/bulk-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (data, status) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: `${data.updated} post${data.updated !== 1 ? "s" : ""} ${status === "approved" ? "approved" : "rejected"}` });
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

  const editCampaignMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; startDate?: string | null; endDate?: string | null; numberOfDays?: number | null; includeSaturday?: boolean; includeSunday?: boolean; alwaysHashtags?: string[] }) => {
      const r = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      setEditCampaignOpen(false);
      toast({ title: "Campaign updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to delete campaign");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign deleted" });
      navigate("/app/marketing/campaigns");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEditCampaign = () => {
    if (!campaign) return;
    setEditCampaignName(campaign.name);
    setEditCampaignDescription(campaign.description || "");
    setEditCampaignStartDate(campaign.startDate ? new Date(campaign.startDate).toISOString().split("T")[0] : "");
    setEditCampaignEndDate(campaign.endDate ? new Date(campaign.endDate).toISOString().split("T")[0] : "");
    setEditCampaignDays(campaign.numberOfDays || "");
    setEditCampaignSaturday(campaign.includeSaturday || false);
    setEditCampaignSunday(campaign.includeSunday || false);
    setEditCampaignAlwaysHashtags((campaign.alwaysHashtags || []).join(", "));
    setEditCampaignOpen(true);
  };

  const handleEditCampaignSubmit = () => {
    const alwaysHashtags = editCampaignAlwaysHashtags
      .split(/[,\s]+/)
      .map(h => h.replace(/^#/, "").trim())
      .filter(h => h.length > 0);
    editCampaignMutation.mutate({
      name: editCampaignName,
      description: editCampaignDescription || undefined,
      startDate: editCampaignStartDate || null,
      endDate: editCampaignEndDate || null,
      numberOfDays: editCampaignDays ? Number(editCampaignDays) : null,
      includeSaturday: editCampaignSaturday,
      includeSunday: editCampaignSunday,
      alwaysHashtags,
    });
  };


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

  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [postsPerDay, setPostsPerDay] = useState("1");
  const [daysBetweenPosts, setDaysBetweenPosts] = useState("1");

  const schedulePostsMutation = useMutation({
    mutationFn: async ({ time, perDay, daysBetween }: { time: string; perDay: number; daysBetween: number }) => {
      if (!campaign?.startDate || !campaign?.numberOfDays) throw new Error("Campaign has no schedule configured");
      const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected");
      if (activePosts.length === 0) throw new Error("No active posts to schedule");

      const [hours, minutes] = time.split(":").map(Number);
      const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

      const tzOffset = new Date().getTimezoneOffset();
      const tzSign = tzOffset <= 0 ? "+" : "-";
      const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
      const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, "0");
      const tzSuffix = `${tzSign}${tzHours}:${tzMins}`;

      const toLocalDateStr = (d: Date): string => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      };

      const localToday = new Date();
      localToday.setHours(0, 0, 0, 0);

      const isWeekendExcluded = (d: Date) => {
        const dow = d.getDay();
        return (dow === 0 && !campaign.includeSunday) || (dow === 6 && !campaign.includeSaturday);
      };

      const pushToNextWeekday = (date: Date): Date => {
        let d = new Date(date);
        while (isWeekendExcluded(d)) {
          d = addDays(d, 1);
        }
        return d;
      };

      const campaignStart = new Date(campaign.startDate);
      campaignStart.setHours(0, 0, 0, 0);
      const start = campaignStart < localToday ? localToday : campaignStart;
      const origEnd = addDays(campaignStart, campaign.numberOfDays - 1);
      const effectiveEnd = origEnd < localToday ? addDays(localToday, campaign.numberOfDays - 1) : origEnd;

      const eligibleSlots: string[] = [];
      let current = pushToNextWeekday(new Date(start));

      while (current <= effectiveEnd) {
        const dateStr = toLocalDateStr(current);
        const isoStr = `${dateStr}T${timeStr}${tzSuffix}`;
        eligibleSlots.push(isoStr);
        current = addDays(current, daysBetween);
        current = pushToNextWeekday(current);
      }

      const slots: string[] = [];
      for (const dateIso of eligibleSlots) {
        for (let s = 0; s < perDay; s++) {
          slots.push(dateIso);
        }
      }

      await Promise.all(activePosts.map(async (post, i) => {
        const slotIndex = i % slots.length;
        const r = await fetch(`/api/campaigns/${id}/generated-posts/${post.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scheduledDate: slots[slotIndex] }),
        });
        if (!r.ok) throw new Error(`Failed to schedule post ${post.id}`);
        return r.json();
      }));
    },
    onSuccess: () => {
      setShowScheduleDialog(false);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: "Posts scheduled across campaign timeline" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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

  const [csvFormat, setCsvFormat] = useState<string>("socialpilot");
  const [showExportWarning, setShowExportWarning] = useState(false);

  const hasUnscheduledPosts = () => {
    const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected");
    return activePosts.some(p => !p.scheduledDate);
  };

  const handleExportClick = () => {
    if (hasUnscheduledPosts()) {
      setShowExportWarning(true);
    } else {
      exportCsvMutation.mutate();
    }
  };

  const exportCsvMutation = useMutation({
    mutationFn: async () => {
      const tzOffset = new Date().getTimezoneOffset();
      const r = await fetch(`/api/campaigns/${id}/export-csv?format=${csvFormat}&tzOffset=${tzOffset}`, {
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
        const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected");
        const unscheduled = activePosts.filter(p => !p.scheduledDate);
        if (unscheduled.length > 0) {
          setTimeout(() => {
            toast({ title: "Schedule your posts", description: "Posts don't have dates yet. Use the Schedule Posts button before exporting to CSV." });
          }, 2000);
        }
      }
    }
    prevJobStatus.current = curr;
  }, [jobStatus?.status, id, queryClient, toast, posts]);

  const getPostImage = (post: GeneratedPost): string | null => {
    if (post.overrideImageUrl) return post.overrideImageUrl;
    if (post.overrideBrandAssetId) {
      const ba = brandAssets.find(b => b.id === post.overrideBrandAssetId);
      if (ba) return ba.fileUrl || ba.url || null;
    }
    if (post.sourceUrl) {
      const linkedAssetList = campaign?.assets || [];
      for (const ca of linkedAssetList) {
        const asset = allAssets.find(a => a.id === ca.assetId);
        if (asset?.url && asset.url === post.sourceUrl && asset.leadImageUrl) {
          return asset.leadImageUrl;
        }
      }
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
              onClick={openEditCampaign}
              data-testid="button-edit-campaign"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setDeleteConfirmOpen(true)}
              data-testid="button-delete-campaign"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
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
            <TabsTrigger value="assets" className="gap-1.5" data-testid="tab-assets"><Library className="w-3.5 h-3.5" />Assets ({campaign.assets.length})</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1.5" data-testid="tab-accounts"><AtSign className="w-3.5 h-3.5" />Social Accounts ({campaign.socialAccounts.length})</TabsTrigger>
          </TabsList>

          {/* Social Posts */}
          <TabsContent value="posts" className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setGenerateDialogOpen(true)}
                disabled={isGenerating || generatePostsMutation.isPending}
                className="gap-2"
                data-testid="button-generate-posts"
              >
                {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Posts</>}
              </Button>
              {strategicContext?.available && (
                <Badge variant="secondary" className="text-[10px] gap-1" data-testid="strategic-context-badge">
                  <Sparkles className="w-3 h-3" />
                  Intelligence-enriched
                </Badge>
              )}
              {posts.filter(p => p.status === "approved").length > 0 && (
                <div className="flex items-center gap-2">
                  <Select value={csvFormat} onValueChange={setCsvFormat}>
                    <SelectTrigger className="w-40" data-testid="select-csv-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="socialpilot">SocialPilot</SelectItem>
                      <SelectItem value="hootsuite">Hootsuite</SelectItem>
                      <SelectItem value="sproutsocial">Sprout Social</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="gap-2" onClick={handleExportClick} disabled={exportCsvMutation.isPending} data-testid="button-export-csv-posts">
                    <Download className="w-4 h-4" />Export CSV
                  </Button>
                </div>
              )}
              {jobStatus?.status === "completed" && posts.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] })} data-testid="button-refresh-posts">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
              {posts.length > 0 && campaign?.startDate && campaign?.numberOfDays && (() => {
                const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected");
                const unscheduledCount = activePosts.filter(p => !p.scheduledDate).length;
                const needsScheduling = unscheduledCount > 0 && jobStatus?.status === "completed";
                return (
                  <Button
                    variant={needsScheduling ? "default" : "outline"}
                    size="sm"
                    className={`gap-1.5 ${needsScheduling ? "animate-pulse" : ""}`}
                    onClick={() => setShowScheduleDialog(true)}
                    disabled={schedulePostsMutation.isPending}
                    title={needsScheduling ? `${unscheduledCount} post${unscheduledCount !== 1 ? "s" : ""} not yet scheduled — schedule before exporting` : "Configure and distribute posts across the campaign date range"}
                    data-testid="button-schedule-posts"
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    {schedulePostsMutation.isPending ? "Scheduling..." : "Schedule Posts"}
                    {needsScheduling && (
                      <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-white text-primary" data-testid="badge-unscheduled-count">
                        {unscheduledCount}
                      </span>
                    )}
                  </Button>
                );
              })()}
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
              <div className="flex items-center gap-2 flex-wrap">
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
                {posts.some(p => p.status !== "approved" && p.status !== "deleted") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-green-600 border-green-200 hover:bg-green-50"
                    onClick={() => bulkStatusMutation.mutate("approved")}
                    disabled={bulkStatusMutation.isPending}
                    data-testid="button-approve-all"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve All
                  </Button>
                )}
                {posts.some(p => p.status !== "rejected" && p.status !== "deleted") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
                    onClick={() => bulkStatusMutation.mutate("rejected")}
                    disabled={bulkStatusMutation.isPending}
                    data-testid="button-reject-all"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject All
                  </Button>
                )}
              </div>
            )}

            {campaign?.alwaysHashtags && campaign.alwaysHashtags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <span className="font-medium">Always include:</span>
                {campaign.alwaysHashtags.map((h, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] bg-primary/10 text-primary-foreground border-primary/20">#{h}</Badge>
                ))}
              </div>
            )}

            {campaign?.assets && campaign.assets.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <Library className="w-3 h-3 shrink-0" />
                <span className="font-medium">Source assets:</span>
                {campaign.assets.map(ca => {
                  const asset = allAssets.find(a => a.id === ca.assetId);
                  return asset ? (
                    <a
                      key={ca.id}
                      href={`/app/marketing/content`}
                      onClick={(e) => { e.preventDefault(); navigate("/app/marketing/content"); }}
                      className="inline-flex"
                      data-testid={`link-source-asset-${asset.id}`}
                    >
                      <Badge variant="outline" className="text-[10px] hover:bg-accent cursor-pointer">{ca.overrideTitle || asset.title}</Badge>
                    </a>
                  ) : null;
                })}
              </div>
            )}

            {posts.length === 0 && !isGenerating ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-posts">
                  {jobStatus?.status === "failed" ? "Generation failed. Click Generate Posts to try again." : "No posts yet. Click Generate Posts to create AI-powered social content."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 grid-cols-1">
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
                              title="Edit post content"
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
                              title="Change image"
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
                                title="Reject this post"
                                onClick={() => updatePostMutation.mutate({ postId: post.id, status: "rejected" })}
                                data-testid={`button-reject-${post.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />Reject
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-destructive"
                              title="Delete this post permanently"
                              onClick={() => deletePostMutation.mutate(post.id)}
                              data-testid={`button-delete-post-${post.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />Delete
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 space-y-3">
                        {post.scheduledDate && (
                          <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-schedule-${post.id}`}>
                            <Calendar className="w-2.5 h-2.5" />{format(new Date(post.scheduledDate), "MMM d, yyyy h:mm a")}
                          </Badge>
                        )}
                        {postImage && (
                          <OptimizedThumbnail
                            src={postImage}
                            containerClassName="max-w-md"
                            data-testid={`img-post-${post.id}`}
                          >
                            {post.overrideImageUrl && (
                              <Badge variant="secondary" className="absolute bottom-1 right-1 text-[10px] z-10">
                                <ImageIcon className="w-2.5 h-2.5 mr-0.5" /> Override
                              </Badge>
                            )}
                          </OptimizedThumbnail>
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
                        {post.sourceUrl && (
                          <a
                            href={post.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                            data-testid={`link-source-${post.id}`}
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{post.sourceUrl}</span>
                          </a>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {editingPostHashtags === post.id ? (
                            <div className="flex items-center gap-2 w-full">
                              <Input
                                value={editHashtagsValue}
                                onChange={e => setEditHashtagsValue(e.target.value)}
                                placeholder="tag1, tag2, tag3 (comma or space separated)"
                                className="text-xs h-7 flex-1"
                                data-testid={`input-hashtags-${post.id}`}
                              />
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  const tags = editHashtagsValue
                                    .split(/[,\s]+/)
                                    .map(h => h.replace(/^#/, "").trim())
                                    .filter(h => h.length > 0);
                                  updatePostMutation.mutate({ postId: post.id, hashtags: tags });
                                }}
                                data-testid={`button-save-hashtags-${post.id}`}
                              >Save</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingPostHashtags(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div
                              className="flex items-center gap-1 flex-wrap cursor-pointer group"
                              onClick={() => {
                                setEditingPostHashtags(post.id);
                                setEditHashtagsValue((post.hashtags || []).join(", "));
                              }}
                              title="Click to edit hashtags"
                              data-testid={`hashtags-${post.id}`}
                            >
                              {post.hashtags?.length > 0 ? (
                                <>
                                  {post.hashtags.map((h, i) => (
                                    <Badge key={i} variant="outline" className="text-[10px] bg-primary/10 text-primary-foreground border-primary/20">#{h}</Badge>
                                  ))}
                                  <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </>
                              ) : (
                                <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                  <Pencil className="w-2.5 h-2.5" /> Add hashtags
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {post.status === "approved" && <Badge variant="outline" className="text-green-600 border-green-200">Approved</Badge>}
                          {post.status === "rejected" && <Badge variant="outline" className="text-orange-600 border-orange-200">Rejected</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
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
      <Dialog open={!!imagePickerPostId} onOpenChange={v => { if (!v) { setImagePickerPostId(null); setPickerCategoryFilter("all"); setPickerPage(0); } }}>
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
            ) : (() => {
              const imageAssets = brandAssets.filter(ba => ba.fileUrl || ba.url);
              const pickerCategories = [...new Set(imageAssets.map(ba => ba.categoryName).filter(Boolean))] as string[];
              const filtered = pickerCategoryFilter === "all" ? imageAssets : imageAssets.filter(ba => ba.categoryName === pickerCategoryFilter);
              const totalPages = Math.ceil(filtered.length / BRAND_PAGE_SIZE);
              const paged = filtered.slice(pickerPage * BRAND_PAGE_SIZE, (pickerPage + 1) * BRAND_PAGE_SIZE);
              return (
                <div className="space-y-3">
                  {pickerCategories.length > 1 && (
                    <Select value={pickerCategoryFilter} onValueChange={v => { setPickerCategoryFilter(v); setPickerPage(0); }}>
                      <SelectTrigger className="h-8 text-xs" data-testid="select-picker-category">
                        <SelectValue placeholder="All categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories ({imageAssets.length})</SelectItem>
                        {pickerCategories.sort().map(cat => (
                          <SelectItem key={cat} value={cat}>{cat} ({imageAssets.filter(a => a.categoryName === cat).length})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {paged.map(ba => (
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
                        <OptimizedThumbnail
                          src={ba.fileUrl || ba.url || ""}
                          alt={ba.name}
                          containerClassName="rounded"
                        />
                        <p className="text-xs mt-1 truncate">{ba.name}</p>
                        {ba.categoryName && <p className="text-[10px] text-muted-foreground truncate">{ba.categoryName}</p>}
                      </button>
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <Button variant="outline" size="sm" disabled={pickerPage === 0} onClick={() => setPickerPage(p => p - 1)} data-testid="button-picker-prev">Previous</Button>
                      <span className="text-xs text-muted-foreground">Page {pickerPage + 1} of {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={pickerPage >= totalPages - 1} onClick={() => setPickerPage(p => p + 1)} data-testid="button-picker-next">Next</Button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editCampaignOpen} onOpenChange={setEditCampaignOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>Update campaign details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-name">Name</Label>
              <Input
                id="edit-campaign-name"
                value={editCampaignName}
                onChange={e => setEditCampaignName(e.target.value)}
                data-testid="input-edit-campaign-name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-desc">Description</Label>
              <Textarea
                id="edit-campaign-desc"
                value={editCampaignDescription}
                onChange={e => setEditCampaignDescription(e.target.value)}
                rows={2}
                data-testid="input-edit-campaign-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-start">Start Date</Label>
                <Input
                  id="edit-campaign-start"
                  type="date"
                  value={editCampaignStartDate}
                  onChange={e => setEditCampaignStartDate(e.target.value)}
                  data-testid="input-edit-campaign-start"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-end">End Date</Label>
                <Input
                  id="edit-campaign-end"
                  type="date"
                  value={editCampaignEndDate}
                  onChange={e => setEditCampaignEndDate(e.target.value)}
                  data-testid="input-edit-campaign-end"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-days">Number of Days</Label>
              <Input
                id="edit-campaign-days"
                type="number"
                min={1}
                value={editCampaignDays}
                onChange={e => setEditCampaignDays(e.target.value ? Number(e.target.value) : "")}
                placeholder="Auto-calculated from dates"
                data-testid="input-edit-campaign-days"
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editCampaignSaturday}
                  onCheckedChange={(v) => setEditCampaignSaturday(!!v)}
                  data-testid="checkbox-edit-campaign-saturday"
                />
                Include Saturdays
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editCampaignSunday}
                  onCheckedChange={(v) => setEditCampaignSunday(!!v)}
                  data-testid="checkbox-edit-campaign-sunday"
                />
                Include Sundays
              </label>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-hashtags">Always-Include Hashtags</Label>
              <Input
                id="edit-campaign-hashtags"
                value={editCampaignAlwaysHashtags}
                onChange={e => setEditCampaignAlwaysHashtags(e.target.value)}
                placeholder="e.g. SynozurAlliance, DigitalTransformation"
                data-testid="input-edit-campaign-hashtags"
              />
              <p className="text-[11px] text-muted-foreground">Comma or space separated. These hashtags will be added to every generated post.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditCampaignOpen(false)} data-testid="button-cancel-edit-campaign">Cancel</Button>
            <Button
              onClick={handleEditCampaignSubmit}
              disabled={!editCampaignName.trim() || editCampaignMutation.isPending}
              data-testid="button-save-edit-campaign"
            >
              {editCampaignMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{campaign?.name}"? This will archive the campaign and all its content.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} data-testid="button-cancel-delete-campaign">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteCampaignMutation.mutate()}
              disabled={deleteCampaignMutation.isPending}
              data-testid="button-confirm-delete-campaign"
            >
              {deleteCampaignMutation.isPending ? "Deleting..." : "Delete Campaign"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Posts</DialogTitle>
            <DialogDescription>
              Distribute active posts evenly across the campaign date range ({campaign?.startDate ? format(new Date(campaign.startDate), "MMM d") : "?"} — {campaign?.numberOfDays} days).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-time">Post Time</Label>
              <Input
                id="schedule-time"
                type="time"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                data-testid="input-schedule-time"
              />
              <p className="text-xs text-muted-foreground">All posts will be scheduled at this time of day.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="posts-per-day">Posts Per Day</Label>
              <Select value={postsPerDay} onValueChange={setPostsPerDay}>
                <SelectTrigger id="posts-per-day" data-testid="select-posts-per-day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 post per day</SelectItem>
                  <SelectItem value="2">2 posts per day</SelectItem>
                  <SelectItem value="3">3 posts per day</SelectItem>
                  <SelectItem value="4">4 posts per day</SelectItem>
                  <SelectItem value="5">5 posts per day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="days-between-posts">Days Between Posts</Label>
              <Select value={daysBetweenPosts} onValueChange={setDaysBetweenPosts}>
                <SelectTrigger id="days-between-posts" data-testid="select-days-between-posts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every day</SelectItem>
                  <SelectItem value="2">Every 2 days</SelectItem>
                  <SelectItem value="3">Every 3 days</SelectItem>
                  <SelectItem value="4">Every 4 days</SelectItem>
                  <SelectItem value="5">Every 5 days</SelectItem>
                  <SelectItem value="6">Every 6 days</SelectItem>
                  <SelectItem value="7">Every 7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground" data-testid="text-schedule-preview">
              {(() => {
                const active = posts.filter(p => p.status !== "deleted" && p.status !== "rejected").length;
                const interval = parseInt(daysBetweenPosts);
                const perDay = parseInt(postsPerDay);
                if (!campaign?.startDate || !campaign?.numberOfDays) {
                  return `${active} active post${active !== 1 ? "s" : ""} will be distributed across eligible days.`;
                }
                const campaignStart = new Date(campaign.startDate);
                const todayPreview = new Date();
                todayPreview.setHours(0, 0, 0, 0);
                const start = campaignStart < todayPreview ? todayPreview : campaignStart;
                const origEnd = addDays(new Date(campaign.startDate), campaign.numberOfDays - 1);
                const endDate = origEnd < todayPreview ? addDays(todayPreview, campaign.numberOfDays - 1) : origEnd;
                const isWeekendExcluded = (date: Date) => {
                  const dow = date.getDay();
                  return (dow === 0 && !campaign.includeSunday) || (dow === 6 && !campaign.includeSaturday);
                };
                const pushToNextWeekday = (date: Date): Date => {
                  let d = new Date(date);
                  while (isWeekendExcluded(d)) {
                    d = addDays(d, 1);
                  }
                  return d;
                };
                let postingDays = 0;
                let current = pushToNextWeekday(new Date(start));
                while (current <= endDate) {
                  postingDays++;
                  current = addDays(current, interval);
                  current = pushToNextWeekday(current);
                }
                const weekdaysOnly = !campaign.includeSaturday || !campaign.includeSunday;
                const intervalLabel = interval === 1 ? "daily" : `every ${interval} days`;
                const dayTypeLabel = weekdaysOnly ? ", weekdays only" : "";
                return `${active} active post${active !== 1 ? "s" : ""} will be distributed across ${postingDays} posting day${postingDays !== 1 ? "s" : ""} (${intervalLabel}${dayTypeLabel}).`;
              })()}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)} data-testid="button-cancel-schedule">Cancel</Button>
            <Button
              onClick={() => schedulePostsMutation.mutate({ time: scheduleTime, perDay: parseInt(postsPerDay), daysBetween: parseInt(daysBetweenPosts) })}
              disabled={schedulePostsMutation.isPending}
              data-testid="button-confirm-schedule"
            >
              {schedulePostsMutation.isPending ? "Scheduling..." : "Schedule Posts"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generateDialogOpen} onOpenChange={(o) => { if (!o) { setGenerateDialogOpen(false); setSelectedBrandImageIds([]); setBrandCategoryFilter("all"); setBrandPage(0); } else { setGenerateDialogOpen(true); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Social Posts</DialogTitle>
            <DialogDescription>
              Optionally select brand images to rotate across your generated posts. Each day and platform will get a unique text + image combination.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Brand Images (optional)</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Select up to {Math.max(3, campaign?.socialAccounts?.length ? campaign.socialAccounts.length * 3 : 3)} images. More images = more unique combinations per day.
              </p>
              {(() => {
                const imageBrandAssets = brandAssets.filter(ba => ba.fileUrl || ba.url);
                if (imageBrandAssets.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-4">No brand images available. Add images in the Brand Library first.</p>;
                }
                const maxImages = Math.max(3, campaign?.socialAccounts?.length ? campaign.socialAccounts.length * 3 : 3);
                const brandCategories = [...new Set(imageBrandAssets.map(ba => ba.categoryName).filter(Boolean))] as string[];
                const filteredBrand = brandCategoryFilter === "all" ? imageBrandAssets : imageBrandAssets.filter(ba => ba.categoryName === brandCategoryFilter);
                const brandTotalPages = Math.ceil(filteredBrand.length / BRAND_PAGE_SIZE);
                const pagedBrand = filteredBrand.slice(brandPage * BRAND_PAGE_SIZE, (brandPage + 1) * BRAND_PAGE_SIZE);
                return (
                  <div className="space-y-3">
                    {brandCategories.length > 1 && (
                      <Select value={brandCategoryFilter} onValueChange={v => { setBrandCategoryFilter(v); setBrandPage(0); }}>
                        <SelectTrigger className="h-8 text-xs" data-testid="select-brand-category">
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All categories ({imageBrandAssets.length})</SelectItem>
                          {brandCategories.sort().map(cat => (
                            <SelectItem key={cat} value={cat}>{cat} ({imageBrandAssets.filter(a => a.categoryName === cat).length})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {pagedBrand.map(ba => {
                        const imgUrl = ba.fileUrl || ba.url || "";
                        const isSelected = selectedBrandImageIds.includes(ba.id);
                        const atLimit = selectedBrandImageIds.length >= maxImages && !isSelected;
                        return (
                          <button
                            key={ba.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedBrandImageIds(prev => prev.filter(id => id !== ba.id));
                              } else if (!atLimit) {
                                setSelectedBrandImageIds(prev => [...prev, ba.id]);
                              }
                            }}
                            disabled={atLimit}
                            className={`relative rounded-lg overflow-hidden border-2 transition-all ${isSelected ? "border-primary ring-2 ring-primary/30" : atLimit ? "border-muted opacity-50 cursor-not-allowed" : "border-transparent hover:border-muted-foreground/30"}`}
                            data-testid={`brand-image-option-${ba.id}`}
                          >
                            <img src={imgUrl} alt={ba.name} className="w-full h-20 object-cover" />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                              <span className="text-[10px] text-white truncate block">{ba.name}</span>
                            </div>
                            {ba.categoryName && (
                              <div className="absolute top-1 left-1 bg-black/50 px-1 rounded">
                                <span className="text-[9px] text-white/80">{ba.categoryName}</span>
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute top-1 right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                                <CheckCircle className="w-3.5 h-3.5 text-white" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {brandTotalPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <Button variant="outline" size="sm" disabled={brandPage === 0} onClick={() => setBrandPage(p => p - 1)} data-testid="button-brand-prev">Previous</Button>
                        <span className="text-xs text-muted-foreground">Page {brandPage + 1} of {brandTotalPages}</span>
                        <Button variant="outline" size="sm" disabled={brandPage >= brandTotalPages - 1} onClick={() => setBrandPage(p => p + 1)} data-testid="button-brand-next">Next</Button>
                      </div>
                    )}
                  </div>
                );
              })()}
              {selectedBrandImageIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {selectedBrandImageIds.length} image{selectedBrandImageIds.length !== 1 ? "s" : ""} selected — with 3 text variations this gives {selectedBrandImageIds.length * 3} unique text+image combinations per platform.
                </p>
              )}
            </div>
            {availablePersonas.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Target Personas (optional)</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">Select personas to tailor the generated posts to specific audiences.</p>
                <div className="flex flex-wrap gap-1.5">
                  {availablePersonas.map(p => (
                    <Badge
                      key={p.id}
                      variant={selectedPersonaIds.includes(p.id) ? "default" : "outline"}
                      className="cursor-pointer gap-1"
                      onClick={() => setSelectedPersonaIds(prev =>
                        prev.includes(p.id) ? prev.filter(pid => pid !== p.id) : [...prev, p.id]
                      )}
                      data-testid={`badge-gen-persona-${p.id}`}
                    >
                      {p.isIcp && "⭐ "}{p.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => { setGenerateDialogOpen(false); setSelectedBrandImageIds([]); setSelectedPersonaIds([]); setBrandCategoryFilter("all"); setBrandPage(0); }} data-testid="button-cancel-generate">Cancel</Button>
            <Button
              onClick={() => generatePostsMutation.mutate({ brandImageIds: selectedBrandImageIds.length > 0 ? selectedBrandImageIds : undefined, personaIds: selectedPersonaIds.length > 0 ? selectedPersonaIds : undefined })}
              disabled={generatePostsMutation.isPending || isGenerating}
              className="gap-2"
              data-testid="button-confirm-generate"
            >
              {generatePostsMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Starting...</> : <><Sparkles className="w-4 h-4" />Generate Posts</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showExportWarning} onOpenChange={setShowExportWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-export-warning-title">Unscheduled Posts Detected</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-export-warning-description">
              {(() => {
                const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected");
                const unscheduledCount = activePosts.filter(p => !p.scheduledDate).length;
                const allUnscheduled = unscheduledCount === activePosts.length;
                return allUnscheduled
                  ? "None of your posts have a scheduled date. The exported CSV will have empty Date/Time columns, which may cause issues with tools like SocialPilot that require dates."
                  : `${unscheduledCount} of ${activePosts.length} posts have no scheduled date. The exported CSV will have empty Date/Time columns for those posts, which may cause issues with tools like SocialPilot that require dates.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-export">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => exportCsvMutation.mutate()} data-testid="button-export-anyway">Export Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
