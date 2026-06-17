import { useState, useEffect, useRef, useMemo } from "react";
import { rollupPosts, batchSourceOf } from "@shared/social-rollup";
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
  Link2,
  Target,
  Network,
  Plus,
  Unlink,
  BarChart3,
  Newspaper,
  Zap,
  LayoutGrid,
  Layers,
  Wand2,
  Square,
  SquareCheck,
  Users,
  ImageOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useJobStatus, jobStatusLabel } from "@/hooks/use-job-status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LinkBuilderTab } from "@/components/marketing/LinkBuilderTab";
import {
  type HubResponse, type ItemType,
  RollupStat, HubItemsList, AttachDialog, CreateActionDialog,
  STAGE_META, STAGE_ORDER,
} from "./hub-components";
import AIRewritePanel from "@/components/marketing/AIRewritePanel";
import { CampaignNextActions } from "@/components/marketing/NextActionsByBatch";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

interface CampaignRollup {
  emailCount: number;
  postCount: number;
  batchCount: number;
  assetsByType: Record<string, number>;
}

interface ChildCampaignRef {
  id: string;
  name: string;
  status: string;
}

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  campaignType?: string;
  objective?: string;
  goal?: string;
  audiencePersonaIds?: string[];
  startDate?: string;
  endDate?: string;
  numberOfDays?: number;
  includeSaturday?: boolean;
  includeSunday?: boolean;
  productIds?: string[];
  alwaysHashtags?: string[];
  parentCampaignId?: string | null;
  foundingSignals?: FoundingSignals | null;
  interview?: { newsItems?: string[] } | null;
  assets: CampaignAsset[];
  pinnedBrandAssets: CampaignBrandAssetRef[];
  socialAccounts: CampaignSocialAccount[];
  rollup?: CampaignRollup;
  children?: ChildCampaignRef[];
  parentCampaign?: ChildCampaignRef | null;
}

interface FoundingSignalNews {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  description: string;
}
interface FoundingSignalActionItem {
  title: string;
  description: string;
  urgency: string;
  category?: string;
}
interface FoundingSignals {
  capturedAt: string;
  origin: "ideation" | "briefing";
  briefingAsOf?: string | null;
  newsArticles: FoundingSignalNews[];
  actionItems: FoundingSignalActionItem[];
  ideaSignals?: string[];
}

interface ContentBrief {
  id: string;
  title: string;
  format: string;
  funnelStage: string;
  status: string;
  summary?: string | null;
  demandSignal?: string | null;
  differentiationAngle?: string | null;
  targetReader?: string | null;
  cta?: string | null;
  channels?: string[] | null;
  estimatedHours?: number | null;
  ideaSignals?: string[] | null;
}

interface ContentPlanResponse {
  calendar: { id: string; name: string } | null;
  briefs: ContentBrief[];
}

const BRIEF_FORMAT_LABELS: Record<string, string> = {
  blog_post: "Blog post",
  landing_page: "Landing page",
  linkedin_post: "LinkedIn post",
  x_post: "X / Twitter post",
  newsletter: "Newsletter",
  video_script: "Video script",
  case_study: "Case study",
  whitepaper: "Whitepaper",
  ebook: "Ebook",
  podcast_outline: "Podcast outline",
  webinar: "Webinar",
  press_release: "Press release",
  other: "Other",
};

const CAMPAIGN_TYPE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "theme", label: "Theme", hint: "Ongoing awareness push around a point of view" },
  { value: "event", label: "Event", hint: "Promote a webinar, conference, or dated event" },
  { value: "offering", label: "Offering", hint: "Launch or spotlight a product / service" },
  { value: "product_release", label: "Product release", hint: "Ramp up to a release date, then amplify for 30+ days" },
];

const FUNNEL_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  awareness: "secondary",
  consideration: "default",
  decision: "outline",
};

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

interface CampaignBrandAssetRef {
  id: string;
  brandAssetId: string;
  sortOrder: number;
}

interface BrandAssetCategory {
  id: string;
  name: string;
}

interface CampaignSocialAccount {
  id: string;
  socialAccountId: string;
  autoPublish?: boolean;
}

interface ContentAsset {
  id: string;
  title: string;
  description?: string;
  url?: string;
  fileUrl?: string;
  leadImageUrl?: string;
  assetType?: string;
  categoryId?: string | null;
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
  generationJobId?: string | null;
  conferenceId?: string | null;
  overrideImageUrl?: string;
  overrideBrandAssetId?: string;
  sourceUrl?: string;
  scheduledDate?: string;
  socialAccountId?: string;
  publishedAt?: string;
  publishedUrl?: string;
  publishError?: string;
  publishAttemptCount?: number;
  linkUrl?: string | null;
  linkLabel?: string | null;
}

// ── Post lifecycle stage (brief → draft → ready → scheduled → posted) ──────────
// Turns the raw generated-post status into one clear, human-readable stage so the
// state of every post is obvious at a glance in lists and the review grid.
function getPostStage(post: { status: string; publishedAt?: string; publishError?: string; scheduledDate?: string }) {
  if (post.publishedAt || post.status === "published")
    return { label: "Posted", cls: "bg-green-600 text-white border-green-600", Icon: CheckCircle };
  if (post.status === "rejected")
    return { label: "Rejected", cls: "text-orange-600 border-orange-300", Icon: XCircle };
  if (post.status === "publish_failed" || post.publishError)
    return { label: "Posting failed", cls: "text-red-600 border-red-300", Icon: AlertCircle };
  if (post.status === "exported")
    return post.scheduledDate
      ? { label: "Scheduled", cls: "text-blue-600 border-blue-300", Icon: Calendar }
      : { label: "Exported", cls: "text-blue-600 border-blue-300", Icon: CheckCircle };
  if (post.status === "approved")
    return { label: "Ready to post", cls: "text-emerald-600 border-emerald-300", Icon: CheckCircle };
  return { label: "Draft", cls: "text-muted-foreground border-muted-foreground/40", Icon: Pencil };
}

function PostStageBadge({ post, className = "" }: { post: GeneratedPost; className?: string }) {
  const s = getPostStage(post);
  const { Icon } = s;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${s.cls} ${className}`} data-testid={`badge-stage-${post.id}`}>
      <Icon className="w-2.5 h-2.5" /> {s.label}
    </Badge>
  );
}


interface BrandAsset {
  id: string;
  name: string;
  fileUrl?: string;
  url?: string;
  categoryId?: string;
  categoryName?: string;
}

const CAMPAIGN_TABS = ["plan", "posts", "review", "assets", "accounts", "links", "children", "hub"] as const;
type CampaignTab = typeof CAMPAIGN_TABS[number];

function getTabFromHash(): CampaignTab {
  const hash = window.location.hash.replace("#", "");
  return (CAMPAIGN_TABS as readonly string[]).includes(hash) ? (hash as CampaignTab) : "plan";
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<CampaignTab>(getTabFromHash);
  const [fsOpen, setFsOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [imagePickerPostId, setImagePickerPostId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [brandAssetCategoryFilter, setBrandAssetCategoryFilter] = useState("all");
  const [brandAssetSearch, setBrandAssetSearch] = useState("");
  const [postFilter, setPostFilter] = useState<string>("active");
  // WS4: when drilling into one collapsed social batch (its generation run,
  // repurpose group, or event); null shows the batch overview.
  const [batchFilter, setBatchFilter] = useState<string | null>(null);
  const [editCampaignOpen, setEditCampaignOpen] = useState(false);
  const [editCampaignName, setEditCampaignName] = useState("");
  const [editCampaignDescription, setEditCampaignDescription] = useState("");
  const [editCampaignType, setEditCampaignType] = useState("theme");
  const [editCampaignObjective, setEditCampaignObjective] = useState("");
  const [editCampaignGoal, setEditCampaignGoal] = useState("");
  const [editCampaignStartDate, setEditCampaignStartDate] = useState("");
  const [editCampaignEndDate, setEditCampaignEndDate] = useState("");
  const [editCampaignDays, setEditCampaignDays] = useState<number | "">("");
  const [editCampaignSaturday, setEditCampaignSaturday] = useState(false);
  const [editCampaignSunday, setEditCampaignSunday] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [linkChildOpen, setLinkChildOpen] = useState(false);
  const [linkChildSearch, setLinkChildSearch] = useState("");
  const [archiveWithChildrenOpen, setArchiveWithChildrenOpen] = useState(false);
  const [editCampaignAlwaysHashtags, setEditCampaignAlwaysHashtags] = useState("");
  const [editingPostHashtags, setEditingPostHashtags] = useState<string | null>(null);
  const [editHashtagsValue, setEditHashtagsValue] = useState("");
  // Density: post cards render compact (small thumbnail + clamped text) by
  // default so a long generation batch fits on a screen; expanding a card
  // shows the full text, full-size image, and the inline editors.
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const togglePostExpanded = (id: string) =>
    setExpandedPosts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedBrandImageIds, setSelectedBrandImageIds] = useState<string[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [brandCategoryFilter, setBrandCategoryFilter] = useState<string>("all");
  const [brandPage, setBrandPage] = useState(0);
  const [generateMode, setGenerateMode] = useState<"asset" | "thematic">("asset");
  const [thematicBrief, setThematicBrief] = useState("");
  const [thematicUrl, setThematicUrl] = useState("");
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [wrapPostLinks, setWrapPostLinks] = useState(false);
  const [variantsPerPlatform, setVariantsPerPlatform] = useState<number | null>(null);
  const BRAND_PAGE_SIZE = 12;
  const [pickerCategoryFilter, setPickerCategoryFilter] = useState<string>("all");
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerTab, setPickerTab] = useState<"brand" | "content">("brand");
  const [pickerShowAll, setPickerShowAll] = useState(false);
  const [pickerContentCategoryFilter, setPickerContentCategoryFilter] = useState<string>("all");

  // Hub tab state
  const [hubAttachOpen, setHubAttachOpen] = useState(false);
  const [hubCreateOpen, setHubCreateOpen] = useState(false);

  // Link attachment popover state
  const [linkPopoverPostId, setLinkPopoverPostId] = useState<string | null>(null);
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [linkLabelInput, setLinkLabelInput] = useState("");

  // Review Posts tab state
  const [rvGroupBy, setRvGroupBy] = useState<"channel" | "concept" | "date">("channel");
  const [rvPlatforms, setRvPlatforms] = useState<string[]>([]);
  const [rvStatusFilter, setRvStatusFilter] = useState<string>("active");
  const [rvMissingImage, setRvMissingImage] = useState(false);
  const [rvSelectMode, setRvSelectMode] = useState(false);
  const [rvSelectedIds, setRvSelectedIds] = useState<Set<string>>(new Set());
  const [rvBulkLinkOpen, setRvBulkLinkOpen] = useState(false);
  const [rvGeneratingIds, setRvGeneratingIds] = useState<Set<string>>(new Set());
  const [rvBulkProgress, setRvBulkProgress] = useState(0);
  const [rvBulkTotal, setRvBulkTotal] = useState(0);
  const [rvHoveredPostId, setRvHoveredPostId] = useState<string | null>(null);
  const [rvBulkApproving, setRvBulkApproving] = useState(false);
  const [rvBulkRejecting, setRvBulkRejecting] = useState(false);

  // Social Posts tab selection mode
  const [postSelectMode, setPostSelectMode] = useState(false);
  const [postSelectedIds, setPostSelectedIds] = useState<Set<string>>(new Set());
  const [postBulkProgress, setPostBulkProgress] = useState(0);
  const [postBulkTotal, setPostBulkTotal] = useState(0);

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: [`/api/campaigns/${id}`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Campaign not found");
      return r.json();
    },
  });

  // Hub tab: planning-hub data for this campaign
  const { data: hub, isLoading: hubLoading } = useQuery<HubResponse>({
    queryKey: ["/api/planning-hub", "campaign", id],
    enabled: activeTab === "hub" && !!id,
    queryFn: async () => {
      const res = await fetch(`/api/planning-hub?scope=campaign&id=${id}`, { credentials: "include" });
      return res.json();
    },
  });

  const refreshHub = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/planning-hub", "campaign", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/planning-hub/available", "campaign", id] });
  };

  const hubDetachMutation = useMutation({
    mutationFn: async (item: { type: ItemType; id: string }) => {
      const res = await fetch("/api/planning-hub/detach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scope: "campaign", id, items: [item] }),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Removed", description: "Item detached from this campaign." });
      refreshHub();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
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

  // Content-library categories, for filtering the content tab of the image picker.
  const { data: contentCategories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/content-categories"],
    queryFn: async () => {
      const r = await fetch("/api/content-categories", { credentials: "include" });
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

  const { data: brandAssetCategories = [] } = useQuery<BrandAssetCategory[]>({
    queryKey: ["/api/brand-asset-categories"],
    queryFn: async () => {
      const r = await fetch("/api/brand-asset-categories", { credentials: "include" });
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

  // WS4: collapse dense social batches so the campaign view isn't a wall of
  // identical posts. Operates on non-discarded posts.
  const postBatches = useMemo(() => {
    const active = posts.filter((p) => p.status !== "deleted" && p.status !== "rejected" && p.status !== "archived");
    return rollupPosts(active, { threshold: 3 });
  }, [posts]);
  // Precomputed set of collapsed-batch keys so the grid filter is O(1) per post
  // instead of O(#posts × #batches) on every render.
  const batchKeySet = useMemo(
    () => new Set(postBatches.batches.map((b) => b.key)),
    [postBatches.batches],
  );
  const unscheduledDraftCount = useMemo(
    () => posts.filter((p) => p.status === "draft" && !p.scheduledDate).length,
    [posts],
  );
  const archivedCount = useMemo(() => posts.filter((p) => p.status === "archived").length, [posts]);
  const schedulablePlatforms = useMemo(() => {
    const set = new Set<string>();
    posts.forEach((p) => { if (p.status !== "deleted" && p.status !== "rejected") set.add(p.platform); });
    return Array.from(set).sort();
  }, [posts]);
  const activeBatch = batchFilter ? postBatches.batches.find((b) => b.key === batchFilter) ?? null : null;

  const { data: contentPlan } = useQuery<ContentPlanResponse>({
    queryKey: [`/api/campaigns/${id}/content-plan`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/content-plan`, { credentials: "include" });
      return r.ok ? r.json() : { calendar: null, briefs: [] };
    },
  });
  const briefs = contentPlan?.briefs ?? [];

  const { data: linkedEvents = [] } = useQuery<{ id: string; name: string; status: string; startDate?: string; postCount: number }[]>({
    queryKey: [`/api/campaigns/${id}/events`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/events`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: allCampaigns = [] } = useQuery<Array<{ id: string; name: string; status: string; parentCampaignId?: string | null }>>({
    queryKey: ["/api/campaigns", "all-for-link"],
    queryFn: async () => {
      // Pickers only offer active campaigns — archived/completed and draft
      // duplicates ("X (Copy)") are hidden so the list stays clean.
      const r = await fetch("/api/campaigns?status=active", { credentials: "include" });
      const data = r.ok ? await r.json() : [];
      return Array.isArray(data) ? data : data?.items ?? [];
    },
    enabled: linkChildOpen,
  });

  const linkChildMutation = useMutation({
    mutationFn: async (childId: string) => {
      const r = await fetch(`/api/campaigns/${id}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ childId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to link campaign");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setLinkChildOpen(false);
      setLinkChildSearch("");
      toast({ title: "Campaign linked as child" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unlinkChildMutation = useMutation({
    mutationFn: async (childId: string) => {
      const r = await fetch(`/api/campaigns/${id}/children/${childId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to unlink campaign");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign unlinked" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const generateBriefsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/generate-briefs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const text = await r.text();
        let msg = "Failed to generate content briefs";
        try { msg = JSON.parse(text).error || msg; } catch { msg = text || msg; }
        throw new Error(msg);
      }
      return r.json();
    },
    onSuccess: (data: { briefs?: ContentBrief[] }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/content-plan`] });
      toast({ title: "Content plan generated", description: `${data.briefs?.length ?? 0} briefs added to this campaign.` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveUnscheduledMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/archive-unscheduled`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to archive");
      return r.json();
    },
    onSuccess: (d: { archived: number }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: `Archived ${d.archived} unscheduled post(s)`, description: "They're hidden from planning and won't export. Purge to delete permanently." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const purgeArchivedMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/purge-archived`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to purge");
      return r.json();
    },
    onSuccess: (d: { purged: number }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: `Purged ${d.purged} post(s)` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteBriefMutation = useMutation({
    mutationFn: async (briefId: string) => {
      const r = await fetch(`/api/content-briefs/${briefId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to delete brief");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/content-plan`] });
      toast({ title: "Brief removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const wipeDraftPostsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to wipe posts");
      return r.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (d: { deleted: number }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: `${d.deleted} draft post${d.deleted !== 1 ? "s" : ""} cleared`, description: "Ready to generate fresh on-mission posts." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: jobStatus } = useQuery<{ status: string }>({
    queryKey: [`/api/campaigns/${id}/generate-posts-status`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/generate-posts-status`, { credentials: "include" });
      return r.ok ? r.json() : { status: "idle" };
    },
    refetchInterval: (data: any) => (data?.status === "running" || data?.status === "pending") ? 3000 : false,
  });

  const { data: genConfig } = useQuery<{ minVariantsPerPlatform: number; maxVariantsPerPlatform: number; maxDraftsPerGeneration: number }>({
    queryKey: ["/api/social/generation-config"],
    queryFn: async () => {
      const r = await fetch(`/api/social/generation-config`, { credentials: "include" });
      return r.ok ? r.json() : { minVariantsPerPlatform: 3, maxVariantsPerPlatform: 10, maxDraftsPerGeneration: 60 };
    },
    staleTime: Infinity,
  });
  const minVariants = genConfig?.minVariantsPerPlatform ?? 3;
  const maxVariants = genConfig?.maxVariantsPerPlatform ?? 10;


  const generatePostsMutation = useMutation({
    mutationFn: async ({ brandImageIds, personaIds, thematicBrief: brief, thematicUrl: url, wrapLinks, variantsPerPlatform: variants }: { brandImageIds?: string[]; personaIds?: string[]; thematicBrief?: string; thematicUrl?: string; wrapLinks?: boolean; variantsPerPlatform?: number | null }) => {
      const r = await fetch(`/api/campaigns/${id}/generate-posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandImageIds: brandImageIds || [], personaIds: personaIds || [], thematicBrief: brief || "", thematicUrl: url || "", wrapLinks: !!wrapLinks, variantsPerPlatform: variants ?? null, includeAssetLeadImages: false }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      setGenerateDialogOpen(false);
      setSelectedBrandImageIds([]);
      setSelectedPersonaIds([]);
      setThematicBrief("");
      setThematicUrl("");
      setGenerateMode("asset");
      setSelectedBriefId(null);
      setVariantsPerPlatform(null);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generate-posts-status`] });
      toast({ title: "Post generation started", description: "Social post drafts will appear in the Posts tab below once generation is complete." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updatePostMutation = useMutation({
    mutationFn: async ({ postId, editedContent, status, overrideImageUrl, overrideBrandAssetId, hashtags, linkUrl, linkLabel }: {
      postId: string; editedContent?: string; status?: string;
      overrideImageUrl?: string | null; overrideBrandAssetId?: string | null; hashtags?: string[];
      linkUrl?: string | null; linkLabel?: string | null;
    }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editedContent, status, overrideImageUrl, overrideBrandAssetId, hashtags, linkUrl, linkLabel }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (returnedPost, vars) => {
      queryClient.setQueryData(
        [`/api/campaigns/${id}/generated-posts`],
        (old: GeneratedPost[] | undefined) => {
          if (!old) return old;
          if (vars.status === "rejected" || vars.status === "deleted") {
            return old.filter(p => p.id !== vars.postId);
          }
          return old.map(p => p.id === vars.postId ? { ...p, ...returnedPost } : p);
        }
      );
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      if (vars.status === "rejected") toast({ title: "Post rejected and removed" });
      else if (vars.status === "approved") toast({ title: "Post approved" });
      setEditingPostId(null);
      setEditingPostHashtags(null);
      setImagePickerPostId(null);
      setLinkPopoverPostId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkLinkMutation = useMutation({
    mutationFn: async ({ postIds, linkUrl, linkLabel }: { postIds: string[]; linkUrl: string | null; linkLabel: string | null }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/bulk-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postIds, linkUrl, linkLabel }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      if (vars.linkUrl === null) {
        toast({ title: `Link removed from ${vars.postIds.length} post${vars.postIds.length !== 1 ? "s" : ""}` });
      } else {
        setRvBulkLinkOpen(false);
        setLinkUrlInput("");
        setLinkLabelInput("");
      }
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
    mutationFn: async (data: { name: string; description?: string; campaignType?: string; objective?: string | null; goal?: string | null; startDate?: string | null; endDate?: string | null; numberOfDays?: number | null; includeSaturday?: boolean; includeSunday?: boolean; alwaysHashtags?: string[] }) => {
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
    setEditCampaignType(campaign.campaignType || "theme");
    setEditCampaignObjective(campaign.objective || "");
    setEditCampaignGoal(campaign.goal || "");
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
      campaignType: editCampaignType,
      objective: editCampaignObjective.trim() || null,
      goal: editCampaignGoal.trim() || null,
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
  const [minutesBetweenPosts, setMinutesBetweenPosts] = useState("180");
  const [schedulePlatforms, setSchedulePlatforms] = useState<string[]>([]);
  const [scheduleArchiveLeftover, setScheduleArchiveLeftover] = useState(false);

  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [createPostContent, setCreatePostContent] = useState("");
  const [createPostAccountIds, setCreatePostAccountIds] = useState<string[]>([]);
  const [createPostScheduledDate, setCreatePostScheduledDate] = useState("");
  const [createPostBrandAssetId, setCreatePostBrandAssetId] = useState<string>("");
  const [createPostAiPolish, setCreatePostAiPolish] = useState(false);

  const createPostMutation = useMutation({
    mutationFn: async (data: { content: string; socialAccountIds: string[]; scheduledDate?: string; overrideBrandAssetId?: string; aiPolish?: boolean }) => {
      const r = await fetch(`/api/campaigns/${id}/create-posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (data) => {
      setCreatePostOpen(false);
      setCreatePostContent("");
      setCreatePostAccountIds([]);
      setCreatePostScheduledDate("");
      setCreatePostBrandAssetId("");
      setCreatePostAiPolish(false);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: `${data.created} post${data.created !== 1 ? "s" : ""} created` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const schedulePostsMutation = useMutation({
    mutationFn: async ({ time, perDay, daysBetween, spacingMinutes, platforms, archiveLeftover }: { time: string; perDay: number; daysBetween: number; spacingMinutes: number; platforms: string[]; archiveLeftover: boolean }) => {
      if (!campaign?.startDate || !campaign?.numberOfDays) throw new Error("Campaign has no schedule configured");
      const platformSet = new Set(platforms);
      // Only the chosen platforms get distributed; everything else is left as-is
      // (and optionally archived afterward as "leftovers").
      const activePosts = posts.filter(p => p.status !== "deleted" && p.status !== "rejected" && platformSet.has(p.platform));
      if (activePosts.length === 0) throw new Error("No active posts to schedule for the selected platforms");

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
          if (s === 0) {
            slots.push(dateIso);
          } else {
            const base = new Date(dateIso);
            base.setMinutes(base.getMinutes() + s * spacingMinutes);
            const hh = String(base.getHours()).padStart(2, "0");
            const mm = String(base.getMinutes()).padStart(2, "0");
            const offsetIso = dateIso.replace(/T\d{2}:\d{2}:\d{2}/, `T${hh}:${mm}:00`);
            slots.push(offsetIso);
          }
        }
      }

      const postsByAccount = new Map<string, GeneratedPost[]>();
      for (const post of activePosts) {
        const key = post.socialAccountId || post.platform;
        if (!postsByAccount.has(key)) postsByAccount.set(key, []);
        postsByAccount.get(key)!.push(post);
      }

      // Rotate posts so consecutive scheduled days cycle through the available
      // images instead of repeating the same one day after day. Bucket each
      // account's posts by their resolved image (rotating each bucket by its
      // rank so the text copy also spreads out), then greedily emit from the
      // bucket with the most posts left whose image differs from the one just
      // placed. The greedy step guarantees no same-image on consecutive days
      // whenever it is possible (no single image used for more than half the
      // batch) and minimizes repeats otherwise.
      const rotateByImage = (accountPosts: GeneratedPost[]): GeneratedPost[] => {
        const buckets = new Map<string, GeneratedPost[]>();
        for (const p of accountPosts) {
          const key = getPostImage(p) ?? "__no_image__";
          const bucket = buckets.get(key);
          if (bucket) bucket.push(p);
          else buckets.set(key, [p]);
        }
        if (buckets.size <= 1) return accountPosts;
        const groups = Array.from(buckets.entries()).map(([key, items], rank) => {
          const offset = items.length > 1 ? rank % items.length : 0;
          return { key, items: offset ? [...items.slice(offset), ...items.slice(0, offset)] : items, idx: 0 };
        });
        const remaining = (g: typeof groups[number]) => g.items.length - g.idx;
        const ordered: GeneratedPost[] = [];
        let prevKey: string | null = null;
        for (let n = 0; n < accountPosts.length; n++) {
          let pick: typeof groups[number] | null = null;
          // Prefer the largest bucket whose image differs from the last placed.
          for (const g of groups) {
            if (remaining(g) <= 0 || g.key === prevKey) continue;
            if (!pick || remaining(g) > remaining(pick)) pick = g;
          }
          // Tail case: only the previous image's bucket has posts left.
          if (!pick) {
            for (const g of groups) {
              if (remaining(g) <= 0) continue;
              if (!pick || remaining(g) > remaining(pick)) pick = g;
            }
          }
          if (!pick) break;
          ordered.push(pick.items[pick.idx]);
          pick.idx++;
          prevKey = pick.key;
        }
        return ordered;
      };

      const assignments: { postId: string; slot: string | null }[] = [];
      let overflowCount = 0;
      for (const [, accountPosts] of postsByAccount) {
        const rotated = rotateByImage(accountPosts);
        for (let i = 0; i < rotated.length; i++) {
          if (i < slots.length) {
            assignments.push({ postId: rotated[i].id, slot: slots[i] });
          } else {
            assignments.push({ postId: rotated[i].id, slot: null });
            overflowCount++;
          }
        }
      }

      await Promise.all(assignments.map(async ({ postId, slot }) => {
        const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scheduledDate: slot }),
        });
        if (!r.ok) throw new Error(`Failed to schedule post ${postId}`);
        return r.json();
      }));

      // Optionally sweep up everything still without a date (overflow + posts on
      // platforms we didn't schedule) in the same flow.
      let archivedCount = 0;
      if (archiveLeftover) {
        const ar = await fetch(`/api/campaigns/${id}/archive-unscheduled`, { method: "POST", credentials: "include" });
        if (ar.ok) {
          const aj = await ar.json().catch(() => ({ archived: 0 }));
          archivedCount = aj.archived ?? 0;
        }
      }

      return { overflowCount, archivedCount };
    },
    onSuccess: (result) => {
      setShowScheduleDialog(false);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      if (result?.overflowCount && result.overflowCount > 0) {
        toast({
          title: "Not enough timeslots",
          description: `${result.overflowCount} post${result.overflowCount > 1 ? "s" : ""} could not be scheduled because there are more posts per account than available timeslots. Consider increasing the campaign duration, adding more posts per day, or reducing the number of posts.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Posts scheduled across campaign timeline", description: result?.archivedCount ? `${result.archivedCount} leftover post${result.archivedCount === 1 ? "" : "s"} archived.` : undefined });
      }
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

  const addBrandAssetMutation = useMutation({
    mutationFn: async (brandAssetId: string) => {
      const r = await fetch(`/api/campaigns/${id}/brand-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ brandAssetId }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] }),
  });

  const removeBrandAssetMutation = useMutation({
    mutationFn: async (brandAssetId: string) => {
      const r = await fetch(`/api/campaigns/${id}/brand-assets/${brandAssetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to remove brand asset");
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

  const setAutoPublishMutation = useMutation({
    mutationFn: async ({ socialAccountId, autoPublish }: { socialAccountId: string; autoPublish: boolean }) => {
      const r = await fetch(`/api/campaigns/${id}/social-accounts/${socialAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ autoPublish }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to update auto-publish");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] }),
    onError: (err: Error) => toast({ title: "Auto-publish update failed", description: err.message, variant: "destructive" }),
  });

  const publishNowMutation = useMutation({
    mutationFn: async (postId: string) => {
      const r = await fetch(`/api/generated-posts/${postId}/publish`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Publish failed");
      return r.json() as Promise<{ publishedUrl?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: "Published!", description: data.publishedUrl ? `Live at ${data.publishedUrl}` : "Post published successfully" });
    },
    onError: (err: Error) => toast({ title: "Publish failed", description: err.message, variant: "destructive" }),
  });

  // Mark a post as already posted externally (e.g. published before direct
  // posting existed, or posted by hand). Stamps it Published so it drops out of
  // the pending/export pool without going through the scheduler.
  const markPostedMutation = useMutation({
    mutationFn: async (postId: string) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "published" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to mark as posted");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: "Marked as posted", description: "This post is now logged as published and won't show as pending." });
    },
    onError: (err: Error) => toast({ title: "Couldn't mark as posted", description: err.message, variant: "destructive" }),
  });

  const [csvFormat, setCsvFormat] = useState<string>("socialpilot");
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [includeUndated, setIncludeUndated] = useState(false);
  const [includeExported, setIncludeExported] = useState(false);
  const [exportPreview, setExportPreview] = useState<{ totalPosts: number; datedPosts: number; undatedPosts: number; collisions: number; postsWithLink: number } | null>(null);
  // After a download, we confirm the scheduling tool accepted the file before
  // marking anything delivered. These hold the ids that were in the last CSV.
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);
  const [lastExportedIds, setLastExportedIds] = useState<string[]>([]);

  const handleExportClick = async () => {
    setIncludeUndated(false);
    setIncludeExported(false);
    try {
      const r = await fetch(`/api/campaigns/${id}/export-preview`, { credentials: "include" });
      if (!r.ok) throw new Error("Preview failed");
      const preview = await r.json();
      setExportPreview(preview);
    } catch {
      setExportPreview(null);
    }
    // Always show the review step so the user gets format/scope choices and a
    // clear picture of what's about to leave the building.
    setShowExportWarning(true);
  };

  const doExport = (withUndated: boolean) => {
    exportCsvMutation.mutate({ includeUndated: withUndated, includeExported });
  };

  const exportCsvMutation = useMutation({
    mutationFn: async ({ includeUndated: inclUndated, includeExported: inclExported }: { includeUndated: boolean; includeExported: boolean }) => {
      const tzOffset = new Date().getTimezoneOffset();
      const excludeParam = inclUndated ? "false" : "true";
      const r = await fetch(`/api/campaigns/${id}/export-csv?format=${csvFormat}&tzOffset=${tzOffset}&excludeUndated=${excludeParam}&includeExported=${inclExported}`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Export failed");
      const idsHeader = r.headers.get("X-Exported-Post-Ids") || "";
      const exportedIds = idsHeader ? idsHeader.split(",").filter(Boolean) : [];
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign-posts-${csvFormat}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return { exportedIds };
    },
    onSuccess: ({ exportedIds }) => {
      if (exportedIds.length > 0) {
        setLastExportedIds(exportedIds);
        setShowDeliverConfirm(true);
      } else {
        toast({ title: "Exported", description: "No new posts were included in the file." });
      }
    },
    onError: (err: Error) => toast({ title: "Export failed", description: err.message, variant: "destructive" }),
  });

  const markDeliveredMutation = useMutation({
    mutationFn: async (postIds: string[]) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/mark-delivered`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postIds }),
      });
      if (!r.ok) throw new Error("Failed to mark delivered");
      return r.json() as Promise<{ updated: number }>;
    },
    onSuccess: (d) => {
      setShowDeliverConfirm(false);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      toast({ title: `Marked ${d.updated} post${d.updated === 1 ? "" : "s"} as delivered`, description: "They won't appear in future exports unless you choose to include delivered posts." });
    },
    onError: (err: Error) => toast({ title: "Couldn't mark delivered", description: err.message, variant: "destructive" }),
  });


  const linkedAssetIds = new Set(campaign?.assets.map(a => a.assetId) ?? []);
  const linkedSocialIds = new Set(campaign?.socialAccounts.map(a => a.socialAccountId) ?? []);
  const availableAssets = allAssets.filter(a => !linkedAssetIds.has(a.id));
  const filteredAvailableAssets = availableAssets.filter(a =>
    !assetSearch || a.title?.toLowerCase().includes(assetSearch.toLowerCase()) || a.description?.toLowerCase().includes(assetSearch.toLowerCase())
  );
  const availableSocial = allSocialAccounts.filter(a => !linkedSocialIds.has(a.id));

  const isGenerating = jobStatus?.status === "running" || jobStatus?.status === "pending";
  const postsGenJobStatus = useJobStatus(id ? `campaign-posts:${id}` : null, isGenerating);
  const postsGenLabel = jobStatusLabel(postsGenJobStatus, "Generating…");

  const prevJobStatus = useRef(jobStatus?.status);
  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    setActiveTab(getTabFromHash());
  }, [id]);

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


  const campaignBreadcrumbs = [
    { label: "Marketing", href: "/app/marketing" },
    { label: "Campaigns", href: "/app/marketing/campaigns" },
    { label: campaign?.name || "Loading..." },
  ];

  // Generate a graphic for a single post. Component-scoped so both the Review
  // tab and the image-picker dialog can call it (the picker is rendered outside
  // the Review tab's render block).
  const generateGraphic = async (postId: string) => {
    setRvGeneratingIds(prev => new Set(prev).add(postId));
    try {
      const r = await fetch(`/api/generated-posts/${postId}/generate-image`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast({ title: "Image generation failed", description: err.error || "Unknown error", variant: "destructive" });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      }
    } catch {
      toast({ title: "Image generation failed", variant: "destructive" });
    } finally {
      setRvGeneratingIds(prev => { const s = new Set(prev); s.delete(postId); return s; });
    }
  };

  if (isLoading) {
    return (
      <AppLayout breadcrumbs={campaignBreadcrumbs}>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!campaign) {
    return (
      <AppLayout breadcrumbs={[{ label: "Marketing", href: "/app/marketing" }, { label: "Campaigns", href: "/app/marketing/campaigns" }, { label: "Not Found" }]}>
        <div className="p-6 text-center text-muted-foreground">Campaign not found.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={campaignBreadcrumbs}>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" data-testid="text-campaign-name">{campaign.name}</h1>
              {campaign.campaignType && (
                <Badge variant="secondary" className="capitalize" data-testid="badge-campaign-type">{campaign.campaignType}</Badge>
              )}
              {campaign.children && campaign.children.length > 0 && (
                <Badge variant="outline" className="gap-1 text-xs" data-testid="badge-mainline-campaign">
                  <Network className="w-3 h-3" />
                  Mainline · {campaign.children.length} {campaign.children.length === 1 ? "child" : "children"}
                </Badge>
              )}
              {campaign.parentCampaign && (
                <a
                  href={`/app/marketing/campaigns/${campaign.parentCampaign.id}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-parent-campaign"
                >
                  <Network className="w-3 h-3" />
                  Part of: {campaign.parentCampaign.name}
                </a>
              )}
            </div>
            {campaign.objective && <p className="text-muted-foreground text-sm mt-1" data-testid="text-campaign-objective">{campaign.objective}</p>}
            {!campaign.objective && campaign.description && <p className="text-muted-foreground text-sm mt-1">{campaign.description}</p>}
            {(campaign.goal || (campaign.audiencePersonaIds && campaign.audiencePersonaIds.length > 0)) && (
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                {campaign.goal && (
                  <span className="inline-flex items-center gap-1" data-testid="text-campaign-goal">
                    <Target className="w-3 h-3" />{campaign.goal}
                  </span>
                )}
                {campaign.audiencePersonaIds && campaign.audiencePersonaIds.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <AtSign className="w-3 h-3" />
                    {campaign.audiencePersonaIds
                      .map(pid => availablePersonas.find(p => p.id === pid)?.name)
                      .filter(Boolean)
                      .join(", ") || `${campaign.audiencePersonaIds.length} persona(s)`}
                  </span>
                )}
              </div>
            )}
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
              onClick={() => {
                setActiveTab("assets");
                window.history.replaceState(null, "", window.location.pathname + window.location.search + "#assets");
              }}
              data-testid="button-manage-assets"
            >
              <Library className="w-3.5 h-3.5" />
              Manage assets
            </Button>
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
              onValueChange={v => {
                if (v === "archived" && campaign.children && campaign.children.some(c => c.status !== "archived" && c.status !== "deleted")) {
                  setArchiveWithChildrenOpen(true);
                  return;
                }
                updateCampaignStatusMutation.mutate(v);
              }}
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

        {/* Rollup summary bar */}
        {campaign.rollup && (campaign.rollup.emailCount > 0 || campaign.rollup.postCount > 0 || Object.keys(campaign.rollup.assetsByType).length > 0) && (
          <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/40 rounded-lg border" data-testid="campaign-rollup-bar">
            <BarChart3 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {Object.entries(campaign.rollup.assetsByType).map(([type, n]) => (
              <span key={type} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{n}</span> {type.replace(/_/g, " ")}
              </span>
            ))}
            {campaign.rollup.emailCount > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{campaign.rollup.emailCount}</span> {campaign.rollup.emailCount === 1 ? "email" : "emails"}
              </span>
            )}
            {campaign.rollup.postCount > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{campaign.rollup.postCount}</span> social {campaign.rollup.postCount === 1 ? "post" : "posts"}
              </span>
            )}
            {campaign.rollup.batchCount > 0 && (
              <span className="text-xs text-muted-foreground border-l pl-2 ml-1">
                across <span className="font-semibold text-foreground">{campaign.rollup.batchCount}</span> {campaign.rollup.batchCount === 1 ? "batch" : "batches"}
              </span>
            )}
          </div>
        )}

        <CampaignNextActions
          campaignId={id}
          onNavigate={(tab) => {
            setActiveTab(tab as CampaignTab);
            window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + tab);
          }}
        />

        <Tabs value={activeTab} onValueChange={(tab) => {
          setActiveTab(tab as CampaignTab);
          window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + tab);
        }}>
          <TabsList>
            <TabsTrigger value="plan" className="gap-1.5" data-testid="tab-plan"><Target className="w-3.5 h-3.5" />Content Plan{briefs.length ? ` (${briefs.length})` : ""}</TabsTrigger>
            <TabsTrigger value="posts" className="gap-1.5" data-testid="tab-posts"><Share2 className="w-3.5 h-3.5" />Social Posts</TabsTrigger>
            <TabsTrigger value="review" className="gap-1.5" data-testid="tab-review"><ImageLucide className="w-3.5 h-3.5" />Review Images</TabsTrigger>
            <TabsTrigger value="assets" className="gap-1.5" data-testid="tab-assets"><Library className="w-3.5 h-3.5" />Assets ({campaign.assets.length})</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1.5" data-testid="tab-accounts"><AtSign className="w-3.5 h-3.5" />Social Accounts ({campaign.socialAccounts.length})</TabsTrigger>
            <TabsTrigger value="links" className="gap-1.5" data-testid="tab-links"><Link2 className="w-3.5 h-3.5" />Links</TabsTrigger>
            <TabsTrigger value="children" className="gap-1.5" data-testid="tab-children">
              <Network className="w-3.5 h-3.5" />
              Campaigns{campaign.children && campaign.children.length > 0 ? ` (${campaign.children.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="hub" className="gap-1.5" data-testid="tab-hub">
              <Layers className="w-3.5 h-3.5" />Hub{hub ? ` (${hub.rollup.total})` : ""}
            </TabsTrigger>
          </TabsList>

          {/* Content Plan — briefs that support this campaign */}
          <TabsContent value="plan" className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Content plan</h3>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Demand-scored briefs that support this campaign's objective, grounded in your messaging framework, competitive gaps, and the selected audience.
                </p>
              </div>
              <Button
                onClick={() => generateBriefsMutation.mutate()}
                disabled={generateBriefsMutation.isPending}
                className="gap-2"
                data-testid="button-generate-briefs"
              >
                {generateBriefsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {briefs.length ? "Generate more briefs" : "Generate content briefs"}
              </Button>
            </div>

            {/* Campaign Grounding — personas targeted + news hooks used in the interview */}
            {((campaign.audiencePersonaIds && campaign.audiencePersonaIds.length > 0) || (campaign.interview?.newsItems && campaign.interview.newsItems.length > 0)) && (
              <Card data-testid="card-campaign-grounding" className="border-dashed">
                <CardHeader className="pb-2 pt-3 px-4">
                  <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Users className="w-3.5 h-3.5 text-primary" />
                    Campaign grounding
                  </span>
                </CardHeader>
                <CardContent className="pt-0 pb-4 px-4 space-y-4">
                  {campaign.audiencePersonaIds && campaign.audiencePersonaIds.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Targeted personas</h4>
                      <div className="flex flex-wrap gap-2">
                        {campaign.audiencePersonaIds.map(pid => {
                          const p = availablePersonas.find(x => x.id === pid);
                          return p ? (
                            <div key={pid} className="flex items-center gap-1.5" data-testid={`grounding-persona-${pid}`}>
                              <Badge variant={p.isIcp ? "default" : "secondary"} className="text-xs gap-1">
                                {p.isIcp && <span className="font-bold">ICP</span>}
                                {p.name}
                                {p.role && <span className="opacity-70">· {p.role}</span>}
                              </Badge>
                            </div>
                          ) : (
                            <Badge key={pid} variant="outline" className="text-xs text-muted-foreground" data-testid={`grounding-persona-${pid}`}>
                              Unknown persona
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {campaign.interview?.newsItems && campaign.interview.newsItems.length > 0 && (
                    <div>
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        <Newspaper className="w-3.5 h-3.5" /> News hooks
                      </h4>
                      <ul className="space-y-1 list-disc pl-5">
                        {campaign.interview.newsItems.map((item, i) => (
                          <li key={i} className="text-sm text-muted-foreground" data-testid={`grounding-news-${i}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Founding Signals — collapsed by default so it doesn't push briefs down */}
            {(() => {
              const fs = campaign.foundingSignals;
              const hasSignals = !!fs && ((fs.newsArticles?.length ?? 0) > 0 || (fs.actionItems?.length ?? 0) > 0 || (fs.ideaSignals?.length ?? 0) > 0);
              const capturedLabel = fs?.capturedAt ? new Date(fs.capturedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;
              return (
                <Card data-testid="card-founding-signals" className="border-dashed">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <button
                      className="flex items-center justify-between w-full gap-2 text-left"
                      onClick={() => setFsOpen(o => !o)}
                      data-testid="button-toggle-founding-signals"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        Founding Signals
                        {capturedLabel && <span className="text-[10px] font-normal">· captured {capturedLabel}</span>}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${fsOpen ? "rotate-180" : ""}`} />
                    </button>
                  </CardHeader>
                  {fsOpen && (
                    <CardContent className="pt-0 pb-4 px-4">
                      {!hasSignals ? (
                        <p className="text-sm text-muted-foreground" data-testid="text-founding-signals-empty">No founding signals were captured for this campaign.</p>
                      ) : (
                        <div className="space-y-5">
                          {(fs!.newsArticles?.length ?? 0) > 0 && (
                            <div>
                              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                <Newspaper className="w-3.5 h-3.5" /> News
                              </h4>
                              <ul className="space-y-2">
                                {fs!.newsArticles.map((n, i) => (
                                  <li key={i} className="text-sm" data-testid={`founding-news-${i}`}>
                                    {n.url ? (
                                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline inline-flex items-center gap-1">
                                        {n.title}<ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                    ) : <span className="font-medium">{n.title}</span>}
                                    {(n.source || n.publishedAt) && (
                                      <span className="text-muted-foreground text-xs ml-1">
                                        {n.source}{n.source && n.publishedAt ? " · " : ""}{n.publishedAt ? new Date(n.publishedAt).toLocaleDateString() : ""}
                                      </span>
                                    )}
                                    {n.description && <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{n.description}</p>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(fs!.actionItems?.length ?? 0) > 0 && (
                            <div>
                              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                <Zap className="w-3.5 h-3.5" /> Intelligence Action Items
                              </h4>
                              <ul className="space-y-2">
                                {fs!.actionItems.map((a, i) => (
                                  <li key={i} className="text-sm" data-testid={`founding-action-${i}`}>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <Badge variant="secondary" className="text-[10px] capitalize">{a.urgency.replace(/_/g, " ")}</Badge>
                                      <span className="font-medium">{a.title}</span>
                                    </div>
                                    {a.description && <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{a.description}</p>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(fs!.ideaSignals?.length ?? 0) > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Founding Notes</h4>
                              <ul className="space-y-1 list-disc pl-5">
                                {fs!.ideaSignals!.map((s, i) => (
                                  <li key={i} className="text-sm text-muted-foreground" data-testid={`founding-signal-${i}`}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })()}

            {briefs.length === 0 ? (
              <Card>
                <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
                  <p className="text-sm text-muted-foreground max-w-md">
                    No briefs yet. Click below to generate 10–15 demand-scored content briefs grounded in this campaign's objective, audience, and competitive gaps.
                  </p>
                  <Button
                    onClick={() => generateBriefsMutation.mutate()}
                    disabled={generateBriefsMutation.isPending}
                    className="gap-2"
                    data-testid="button-generate-briefs-empty"
                  >
                    {generateBriefsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {generateBriefsMutation.isPending ? "Generating briefs…" : "Generate content briefs"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {briefs.map((b) => (
                  <Card key={b.id} data-testid={`brief-${b.id}`}>
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{b.title}</span>
                            <Badge variant="outline" className="text-xs">{BRIEF_FORMAT_LABELS[b.format] ?? b.format}</Badge>
                            <Badge variant={FUNNEL_BADGE_VARIANT[b.funnelStage] ?? "secondary"} className="text-xs capitalize">{b.funnelStage}</Badge>
                            <Badge variant="secondary" className="text-xs capitalize">{b.status}</Badge>
                          </div>
                          {b.differentiationAngle && (
                            <p className="text-xs text-muted-foreground mt-1">{b.differentiationAngle}</p>
                          )}
                          {(b.targetReader || b.demandSignal) && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {b.targetReader ? <span><span className="font-medium">For:</span> {b.targetReader}. </span> : null}
                              {b.demandSignal ? <span><span className="font-medium">Signal:</span> {b.demandSignal}</span> : null}
                            </p>
                          )}
                          {b.cta && (
                            <p className="text-xs text-muted-foreground mt-1" data-testid={`text-brief-cta-${b.id}`}>
                              <span className="font-medium">CTA:</span> {b.cta}
                            </p>
                          )}
                          {((b.channels && b.channels.length > 0) || b.estimatedHours != null) && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                              {b.channels?.map((ch) => (
                                <Badge key={ch} variant="outline" className="text-xs capitalize" data-testid={`badge-brief-channel-${b.id}-${ch}`}>
                                  {ch}
                                </Badge>
                              ))}
                              {b.estimatedHours != null && (
                                <span className="text-xs text-muted-foreground" data-testid={`text-brief-hours-${b.id}`}>
                                  ~{b.estimatedHours}h
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {contentPlan?.calendar && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => navigate(`/app/marketing/editorial-calendar?calendar=${contentPlan.calendar!.id}`)}
                              data-testid={`button-open-brief-${b.id}`}
                            >
                              Open in calendar <ExternalLink className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteBriefMutation.mutate(b.id)}
                            disabled={deleteBriefMutation.isPending && (deleteBriefMutation.variables as string) === b.id}
                            title="Remove this brief from the campaign plan"
                            data-testid={`button-delete-brief-${b.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {linkedEvents.length > 0 && (
              <div className="space-y-2 pt-2" data-testid="campaign-events">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Calendar className="w-4 h-4" />Events</h3>
                {linkedEvents.map((ev) => (
                  <Card key={ev.id} data-testid={`event-${ev.id}`}>
                    <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{ev.name}</span>
                          <Badge variant="secondary" className="text-[10px] capitalize">{ev.status}</Badge>
                          <Badge variant="outline" className="text-[10px]">{ev.postCount} posts</Badge>
                        </div>
                        {ev.startDate && (
                          <p className="text-xs text-muted-foreground mt-1">{format(new Date(ev.startDate), "MMM d, yyyy")}</p>
                        )}
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/app/marketing/conferences/${ev.id}`)} data-testid={`button-open-event-${ev.id}`}>
                        Open event <ExternalLink className="w-3 h-3" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="links" className="space-y-4">
            <LinkBuilderTab campaignId={id!} campaignName={campaign.name} />
          </TabsContent>

          {/* Child / Mainline Campaigns */}
          <TabsContent value="children" className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Child campaigns</h3>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Link existing campaigns as children of this mainline campaign to group related batches and roll up their activity here.
                </p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setLinkChildOpen(true)} data-testid="button-link-child-campaign">
                <Plus className="w-3.5 h-3.5" />
                Link campaign
              </Button>
            </div>

            {campaign.parentCampaign && (
              <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30 text-sm">
                <Network className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">This campaign is a child of</span>
                <a
                  href={`/app/marketing/campaigns/${campaign.parentCampaign.id}`}
                  className="font-medium hover:underline"
                  data-testid="link-parent-campaign-children-tab"
                >
                  {campaign.parentCampaign.name}
                </a>
                <Badge variant="secondary" className="capitalize text-xs">{campaign.parentCampaign.status}</Badge>
              </div>
            )}

            {(!campaign.children || campaign.children.length === 0) ? (
              <div className="py-10 text-center text-muted-foreground text-sm border rounded-lg" data-testid="text-no-child-campaigns">
                No child campaigns linked yet.
              </div>
            ) : (
              <div className="grid gap-2" data-testid="child-campaigns-list">
                {campaign.children.map(child => (
                  <div key={child.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border" data-testid={`card-child-campaign-${child.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Network className="w-4 h-4 text-muted-foreground shrink-0" />
                      <a
                        href={`/app/marketing/campaigns/${child.id}`}
                        className="text-sm font-medium hover:underline truncate"
                        data-testid={`link-child-campaign-${child.id}`}
                      >
                        {child.name}
                      </a>
                      <Badge variant="secondary" className="capitalize text-xs shrink-0">{child.status}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => unlinkChildMutation.mutate(child.id)}
                      disabled={unlinkChildMutation.isPending}
                      data-testid={`button-unlink-child-${child.id}`}
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      Unlink
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Hub — planning-hub view scoped to this campaign */}
          <TabsContent value="hub" className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Campaign Hub</h3>
                <p className="text-sm text-muted-foreground max-w-xl">
                  All social posts, emails, and content briefs attached to this campaign, grouped by type. Attach existing items or add a new planned action.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHubAttachOpen(true)} data-testid="button-hub-attach">
                  <Link2 className="w-3.5 h-3.5" /> Attach Existing
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setHubCreateOpen(true)} data-testid="button-hub-create-action">
                  <Plus className="w-3.5 h-3.5" /> New Action
                </Button>
              </div>
            </div>

            {hubLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : hub ? (
              <>
                {/* Rollup stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <RollupStat label="Total" value={hub.rollup.total} testId="hub-rollup-total" highlight />
                  {STAGE_ORDER.map((st) => (
                    <RollupStat
                      key={st}
                      label={STAGE_META[st].label}
                      value={hub.rollup.byStage[st]}
                      testId={`hub-rollup-stage-${st}`}
                    />
                  ))}
                  <RollupStat label="Types" value={Object.values(hub.rollup.byType).filter((n) => n > 0).length} testId="hub-rollup-types" />
                </div>

                {/* Items list */}
                <HubItemsList
                  hub={hub}
                  scope="campaign"
                  id={id}
                  onDetach={(item) => hubDetachMutation.mutate(item)}
                  detachPending={hubDetachMutation.isPending}
                />
              </>
            ) : null}
          </TabsContent>

          {/* Social Posts */}
          <TabsContent value="posts" className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setGenerateDialogOpen(true)}
                disabled={isGenerating || generatePostsMutation.isPending}
                className="gap-2"
                data-testid="button-generate-posts"
              >
                {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" />{postsGenLabel}</> : <><Sparkles className="w-4 h-4" />Generate Posts</>}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setCreatePostAccountIds(
                    campaign?.socialAccounts.map(sa => sa.socialAccountId) ?? []
                  );
                  setCreatePostOpen(true);
                }}
                className="gap-2"
                data-testid="button-create-post"
              >
                <Pencil className="w-4 h-4" />Create Post
              </Button>
              {posts.length > 0 && (
                <Button
                  variant={postSelectMode ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setPostSelectMode(v => !v);
                    setPostSelectedIds(new Set());
                  }}
                  data-testid="button-posts-select-mode"
                >
                  {postSelectMode ? <SquareCheck className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {postSelectMode ? "Cancel" : "Select"}
                </Button>
              )}
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
                      <SelectItem value="generic">Generic (Copy/Paste)</SelectItem>
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
              {posts.filter(p => !["exported", "published", "posted", "delivered"].includes(p.status)).length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const count = posts.filter(p => !["exported", "published", "posted", "delivered"].includes(p.status)).length;
                    if (window.confirm(`Delete all ${count} draft post${count !== 1 ? "s" : ""}? This cannot be undone — but you can regenerate them.`)) {
                      wipeDraftPostsMutation.mutate();
                    }
                  }}
                  disabled={wipeDraftPostsMutation.isPending}
                  title="Delete all drafts so you can regenerate on-mission posts"
                  data-testid="button-wipe-draft-posts"
                >
                  {wipeDraftPostsMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Clear drafts
                </Button>
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
                    onClick={() => { setSchedulePlatforms(schedulablePlatforms); setScheduleArchiveLeftover(false); setShowScheduleDialog(true); }}
                    disabled={schedulePostsMutation.isPending}
                    title={needsScheduling ? `${unscheduledCount} post${unscheduledCount !== 1 ? "s" : ""} not yet scheduled — schedule before exporting` : "Configure and distribute posts across the campaign date range"}
                    data-testid="button-schedule-posts"
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    {schedulePostsMutation.isPending ? "Scheduling..." : "Schedule Posts"}
                    {needsScheduling && (
                      <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-primary-foreground text-primary" data-testid="badge-unscheduled-count">
                        {unscheduledCount}
                      </span>
                    )}
                  </Button>
                );
              })()}
            </div>

            {/* Bulk action bar — shown when Select mode is active in Social Posts tab */}
            {postSelectMode && (
              <div className="flex items-center gap-2 flex-wrap rounded-md border bg-muted/40 px-3 py-2" data-testid="posts-bulk-bar">
                <span className="text-xs font-medium text-muted-foreground">
                  {postSelectedIds.size} selected
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const visibleIds = posts.filter(p => {
                      const src = batchSourceOf(p);
                      const isBatched = src != null && batchKeySet.has(src);
                      if (batchFilter) { if (src !== batchFilter) return false; }
                      else if (isBatched) return false;
                      if (postFilter === "all") return p.status !== "deleted";
                      if (postFilter === "active") return p.status !== "deleted" && p.status !== "rejected" && p.status !== "archived";
                      if (postFilter === "missing_image") return p.status !== "deleted" && !p.overrideImageUrl && !p.overrideBrandAssetId;
                      return p.status === postFilter;
                    }).map(p => p.id);
                    setPostSelectedIds(new Set(visibleIds));
                  }}
                  data-testid="button-posts-select-all"
                >
                  Select all visible
                </Button>
                {postSelectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setPostSelectedIds(new Set())}
                    data-testid="button-posts-clear-selection"
                  >
                    Clear
                  </Button>
                )}
                {postSelectedIds.size > 0 && (
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    disabled={postBulkTotal > 0}
                    onClick={async () => {
                      const ids = Array.from(postSelectedIds);
                      setPostBulkTotal(ids.length);
                      setPostBulkProgress(0);
                      for (let i = 0; i < ids.length; i++) {
                        await generateGraphic(ids[i]);
                        setPostBulkProgress(i + 1);
                      }
                      setPostBulkTotal(0);
                      setPostBulkProgress(0);
                      toast({ title: "Graphics generated", description: `Generated images for ${ids.length} post(s).` });
                    }}
                    data-testid="button-posts-bulk-generate"
                  >
                    {postBulkTotal > 0 ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />{postBulkProgress}/{postBulkTotal}</>
                    ) : (
                      <><Wand2 className="w-3.5 h-3.5" />Generate graphics</>
                    )}
                  </Button>
                )}
                {postSelectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      const firstId = Array.from(postSelectedIds)[0];
                      setImagePickerPostId(firstId);
                      setPickerTab("brand");
                    }}
                    data-testid="button-posts-bulk-replace-image"
                  >
                    <ImageLucide className="w-3.5 h-3.5" />Replace image
                  </Button>
                )}
              </div>
            )}

            {isGenerating && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-primary/30 bg-primary/5" data-testid="status-generating-posts">
                <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{postsGenLabel}</p>
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
                    <SelectItem value="missing_image">Missing image</SelectItem>
                    {archivedCount > 0 && <SelectItem value="archived">Archived ({archivedCount})</SelectItem>}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-muted-foreground"
                  onClick={() =>
                    setExpandedPosts(prev =>
                      prev.size > 0 ? new Set() : new Set(posts.map(p => p.id)),
                    )
                  }
                  data-testid="button-toggle-expand-all"
                >
                  <ChevronDown className={expandedPosts.size > 0 ? "w-3.5 h-3.5 rotate-180" : "w-3.5 h-3.5"} />
                  {expandedPosts.size > 0 ? "Collapse all" : "Expand all"}
                </Button>
                {unscheduledDraftCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={archiveUnscheduledMutation.isPending}
                    onClick={() => archiveUnscheduledMutation.mutate()}
                    title="Move unscheduled draft posts to the archive so they stop cluttering planning"
                    data-testid="button-archive-unscheduled"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Archive {unscheduledDraftCount} unscheduled
                  </Button>
                )}
                {archivedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive"
                    disabled={purgeArchivedMutation.isPending}
                    onClick={() => { if (confirm(`Permanently delete ${archivedCount} archived post(s)? This cannot be undone.`)) purgeArchivedMutation.mutate(); }}
                    title="Permanently delete archived/rejected posts"
                    data-testid="button-purge-archived"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Purge archived
                  </Button>
                )}
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
                <CardContent className="py-10 text-center text-muted-foreground space-y-2" data-testid="text-no-posts">
                  <p>
                    {jobStatus?.status === "failed"
                      ? "Generation failed. Click Generate Posts to try again."
                      : "No posts yet. Click Generate Posts for AI-powered content, or Create Post to write your own."}
                  </p>
                  <p className="text-xs">
                    This <span className="font-medium">Content Plan</span> is where you draft, generate, and schedule a
                    campaign's posts. Once scheduled, they appear on the{" "}
                    <a href="/app/marketing/calendar" onClick={(e) => { e.preventDefault(); navigate("/app/marketing/calendar"); }} className="text-primary underline" data-testid="link-social-posts-calendar">Social Posts calendar</a>.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* WS4: collapse dense batches so we don't show a wall of identical posts */}
                {!batchFilter && postBatches.batches.length > 0 && (
                  <div className="space-y-2" data-testid="batch-overview">
                    <p className="text-xs text-muted-foreground">
                      {postBatches.batches.length} social {postBatches.batches.length === 1 ? "batch" : "batches"} —
                      open one to review and act on its posts.
                    </p>
                    {postBatches.batches.map((b) => (
                      <Card key={b.key} data-testid={`batch-${b.key}`}>
                        <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Share2 className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium text-sm">{b.count} social posts</span>
                              {b.posts[0]?.conferenceId && <Badge variant="outline" className="text-[10px]">Event</Badge>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {Object.entries(b.platforms).sort((a, c) => c[1] - a[1]).map(([pl, n]) => (
                                <Badge key={pl} variant="secondary" className="text-[10px] capitalize">{pl} {n}</Badge>
                              ))}
                              {Object.entries(b.statusCounts).map(([st, n]) => (
                                <span key={st} className="text-[10px] text-muted-foreground capitalize">· {n} {st}</span>
                              ))}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setBatchFilter(b.key)}
                            data-testid={`button-open-batch-${b.key}`}
                          >
                            Review {b.count} posts
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {batchFilter && (
                  <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950" data-testid="banner-batch-drill">
                    <Share2 className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                    <span className="text-blue-800 dark:text-blue-200">
                      Reviewing one batch — {activeBatch?.count ?? 0} posts
                    </span>
                    <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => setBatchFilter(null)} data-testid="button-exit-batch">
                      <X className="w-3 h-3 mr-1" /> Back to batches
                    </Button>
                  </div>
                )}

                <div className="grid gap-4 grid-cols-1">
                {posts.filter(p => {
                  // Hide posts that belong to a collapsed batch unless we're
                  // drilling into that batch; loose posts always show.
                  const src = batchSourceOf(p);
                  const isBatched = src != null && batchKeySet.has(src);
                  if (batchFilter) { if (src !== batchFilter) return false; }
                  else if (isBatched) return false;
                  if (postFilter === "all") return p.status !== "deleted";
                  if (postFilter === "active") return p.status !== "deleted" && p.status !== "rejected" && p.status !== "archived";
                  if (postFilter === "missing_image") return p.status !== "deleted" && !p.overrideImageUrl && !p.overrideBrandAssetId;
                  return p.status === postFilter;
                }).map(post => {
                  const postImage = getPostImage(post);
                  // Inline editors live in the expanded body, so editing a
                  // collapsed card implicitly expands it.
                  const isExpanded =
                    expandedPosts.has(post.id) ||
                    editingPostId === post.id ||
                    editingPostHashtags === post.id;
                  return (
                    <Card
                      key={post.id}
                      data-testid={`card-post-${post.id}`}
                      className={postSelectMode && postSelectedIds.has(post.id) ? "ring-2 ring-primary" : ""}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {postSelectMode && (
                              <Checkbox
                                checked={postSelectedIds.has(post.id)}
                                onCheckedChange={() => {
                                  setPostSelectedIds(prev => {
                                    const s = new Set(prev);
                                    if (s.has(post.id)) s.delete(post.id); else s.add(post.id);
                                    return s;
                                  });
                                }}
                                data-testid={`checkbox-post-${post.id}`}
                              />
                            )}
                            <Badge>{post.platform}</Badge>
                            {!post.overrideImageUrl && !post.overrideBrandAssetId && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[10px] text-muted-foreground border-muted-foreground/30"
                                data-testid={`badge-no-image-${post.id}`}
                                title="No branded graphic assigned"
                              >
                                <ImageOff className="w-2.5 h-2.5" />No image
                              </Badge>
                            )}
                            {post.variantGroup && <span className="text-[10px] text-muted-foreground">variant</span>}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Generate branded graphic"
                              disabled={rvGeneratingIds.has(post.id)}
                              onClick={() => generateGraphic(post.id)}
                              data-testid={`button-generate-graphic-${post.id}`}
                            >
                              {rvGeneratingIds.has(post.id)
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Wand2 className="w-3.5 h-3.5" />}
                            </Button>
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
                            {post.status === "approved" && !post.publishedAt && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-blue-600"
                                title="Publish now to the linked social account"
                                onClick={() => publishNowMutation.mutate(post.id)}
                                disabled={publishNowMutation.isPending}
                                data-testid={`button-publish-now-${post.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />Publish now
                              </Button>
                            )}
                            {!post.publishedAt && post.status !== "rejected" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-green-600"
                                title="This was already posted somewhere else — log it as posted so it's not pending"
                                onClick={() => markPostedMutation.mutate(post.id)}
                                disabled={markPostedMutation.isPending}
                                data-testid={`button-mark-posted-${post.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />Mark as posted
                              </Button>
                            )}
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
                        {!isExpanded ? (
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={false}
                            className="flex items-start gap-3 cursor-pointer group/compact"
                            onClick={() => togglePostExpanded(post.id)}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                togglePostExpanded(post.id);
                              }
                            }}
                            title="Click to expand"
                            data-testid={`post-compact-${post.id}`}
                          >
                            {postImage && (
                              <img
                                src={postImage}
                                alt=""
                                loading="lazy"
                                className="w-14 h-14 rounded object-cover border border-border shrink-0"
                                onError={e => (e.currentTarget.style.display = "none")}
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm line-clamp-2">{post.editedContent ?? post.content}</p>
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                {post.scheduledDate ? (
                                  <Badge variant="secondary" className="text-[10px] gap-1">
                                    <Calendar className="w-2.5 h-2.5" />{format(new Date(post.scheduledDate), "MMM d, h:mm a")}
                                  </Badge>
                                ) : post.status !== "exported" && post.status !== "published" && (
                                  <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
                                    <Calendar className="w-2.5 h-2.5" />No date
                                  </Badge>
                                )}
                                <PostStageBadge post={post} />
                                {(post.hashtags?.length ?? 0) > 0 && (
                                  <span className="text-[10px] text-muted-foreground">{post.hashtags.length} hashtag{post.hashtags.length === 1 ? "" : "s"}</span>
                                )}
                              </div>
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground/50 group-hover/compact:text-foreground shrink-0 mt-1 transition-colors" />
                          </div>
                        ) : (
                        <>
                        <div className="flex items-center gap-2 flex-wrap">
                        <PostStageBadge post={post} />
                        {post.scheduledDate ? (
                          <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-schedule-${post.id}`}>
                            <Calendar className="w-2.5 h-2.5" />{format(new Date(post.scheduledDate), "MMM d, yyyy h:mm a")}
                          </Badge>
                        ) : post.status !== "exported" && post.status !== "published" && (
                          <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300" data-testid={`badge-no-date-${post.id}`}>
                            <Calendar className="w-2.5 h-2.5" />No date — excluded from export
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 px-2 text-xs text-muted-foreground"
                          onClick={() => {
                            setExpandedPosts(prev => {
                              const next = new Set(prev);
                              next.delete(post.id);
                              return next;
                            });
                            if (editingPostId === post.id) setEditingPostId(null);
                            if (editingPostHashtags === post.id) setEditingPostHashtags(null);
                          }}
                          data-testid={`button-collapse-${post.id}`}
                        >
                          Collapse <ChevronDown className="w-3 h-3 ml-1 rotate-180" />
                        </Button>
                        </div>
                        {post.publishedAt && (
                          <div className="flex items-center gap-2 text-xs text-green-600" data-testid={`badge-published-${post.id}`}>
                            <CheckCircle className="w-3 h-3" />
                            Published {format(new Date(post.publishedAt), "MMM d, h:mm a")}
                            {post.publishedUrl && (
                              <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer" className="underline" data-testid={`link-published-${post.id}`}>view</a>
                            )}
                          </div>
                        )}
                        {post.publishError && !post.publishedAt && (
                          <div className="text-xs text-amber-600" data-testid={`text-publish-error-${post.id}`}>
                            Publish error: {post.publishError}
                          </div>
                        )}
                        {postImage && (
                          <button
                            type="button"
                            className="block max-w-md w-full text-left group/img"
                            onClick={() => setLightboxImage(postImage)}
                            title="Click to preview the full-size graphic"
                            data-testid={`button-preview-image-${post.id}`}
                          >
                            <OptimizedThumbnail
                              src={postImage}
                              containerClassName="w-full transition-opacity group-hover/img:opacity-90"
                              data-testid={`img-post-${post.id}`}
                            >
                              {post.overrideImageUrl && (
                                <Badge variant="secondary" className="absolute bottom-1 right-1 text-[10px] z-10">
                                  <ImageIcon className="w-2.5 h-2.5 mr-0.5" /> Override
                                </Badge>
                              )}
                            </OptimizedThumbnail>
                          </button>
                        )}
                        {editingPostId === post.id ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editContent}
                              onChange={e => setEditContent(e.target.value)}
                              rows={5}
                              data-testid={`textarea-edit-${post.id}`}
                            />
                            {post.socialAccountId && (
                              <AIRewritePanel
                                socialAccountId={post.socialAccountId}
                                draft={editContent}
                                postId={post.id}
                                onApply={(variant) => setEditContent(variant)}
                              />
                            )}
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => updatePostMutation.mutate({ postId: post.id, editedContent: editContent })} data-testid={`button-save-edit-${post.id}`}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingPostId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{post.editedContent ?? post.content}</p>
                        )}
                        {post.sourceUrl && !(post.editedContent ?? post.content).includes(post.sourceUrl) && (
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
                        {["linkedin", "facebook", "twitter"].includes(post.platform) && (
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap" data-testid={`posts-link-row-${post.id}`}>
                            {post.linkUrl ? (
                              <>
                                <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 bg-primary/5 border-primary/30 min-w-0">
                                  <Link2 className="w-3 h-3 text-primary shrink-0" />
                                  <a
                                    href={post.linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline truncate max-w-[200px]"
                                    data-testid={`posts-link-url-${post.id}`}
                                  >
                                    {post.linkLabel || post.linkUrl}
                                  </a>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs gap-1 px-2 text-muted-foreground"
                                  onClick={() => { setLinkUrlInput(post.linkUrl || ""); setLinkLabelInput(post.linkLabel || ""); setLinkPopoverPostId(post.id); }}
                                  data-testid={`button-posts-edit-link-${post.id}`}
                                >
                                  <Pencil className="w-3 h-3" />Edit link
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs gap-1 px-2 text-muted-foreground"
                                onClick={() => { setLinkUrlInput(""); setLinkLabelInput(""); setLinkPopoverPostId(post.id); }}
                                data-testid={`button-posts-add-link-${post.id}`}
                              >
                                <Link2 className="w-3 h-3" />Add link
                              </Button>
                            )}
                          </div>
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
                        </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                </div>
              </div>
            )}
          </TabsContent>


          {/* Assets */}
          <TabsContent value="assets" className="space-y-6">
            {/* ── Pinned content library assets ── */}
            {campaign.assets.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Content Library — in this campaign</h3>
                <div className="grid gap-2">
                  {[...campaign.assets].reverse().map(ca => {
                    const asset = allAssets.find(a => a.id === ca.assetId);
                    return (
                      <Card key={ca.id} data-testid={`card-campaign-asset-${ca.assetId}`}>
                        <CardContent className="py-3 flex items-center gap-3">
                          {asset?.leadImageUrl && (
                            <img
                              src={asset.leadImageUrl}
                              alt=""
                              className="w-10 h-10 rounded object-cover shrink-0"
                              onError={e => (e.currentTarget.style.display = "none")}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ca.overrideTitle ?? asset?.title ?? ca.assetId}</p>
                            {asset?.description && <p className="text-xs text-muted-foreground truncate">{asset.description}</p>}
                          </div>
                          {asset?.assetType && (
                            <Badge variant="outline" className="shrink-0 text-xs">{asset.assetType}</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => removeAssetMutation.mutate(ca.assetId)}
                            disabled={removeAssetMutation.isPending}
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

            {/* ── Pinned visual/brand assets ── */}
            {(campaign.pinnedBrandAssets ?? []).length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Visual/Brand Assets — in this campaign</h3>
                <div className="grid gap-2">
                  {[...(campaign.pinnedBrandAssets ?? [])].reverse().map(cba => {
                    const ba = brandAssets.find(b => b.id === cba.brandAssetId);
                    const thumb = ba?.fileUrl || ba?.url;
                    return (
                      <Card key={cba.id} data-testid={`card-campaign-brand-asset-${cba.brandAssetId}`}>
                        <CardContent className="py-3 flex items-center gap-3">
                          {thumb ? (
                            <img src={thumb} alt="" className="w-10 h-10 rounded object-cover shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                              <ImageIcon className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ba?.name ?? cba.brandAssetId}</p>
                            {ba?.categoryName && <p className="text-xs text-muted-foreground truncate">{ba.categoryName}</p>}
                          </div>
                          <Badge variant="outline" className="shrink-0 text-xs">Visual</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => removeBrandAssetMutation.mutate(cba.brandAssetId)}
                            disabled={removeBrandAssetMutation.isPending}
                            data-testid={`button-remove-brand-asset-${cba.brandAssetId}`}
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

            {/* ── Add from Visual/Brand Assets ── */}
            {(() => {
              const pinnedBrandAssetIds = new Set((campaign.pinnedBrandAssets ?? []).map(p => p.brandAssetId));
              const imageOnlyBrandAssets = brandAssets.filter(ba => (ba.fileUrl || ba.url) && !pinnedBrandAssetIds.has(ba.id));
              const filteredByCategory = brandAssetCategoryFilter === "all"
                ? imageOnlyBrandAssets
                : imageOnlyBrandAssets.filter(ba => ba.categoryId === brandAssetCategoryFilter);
              const filteredBrandAssets = brandAssetSearch
                ? filteredByCategory.filter(ba => ba.name.toLowerCase().includes(brandAssetSearch.toLowerCase()))
                : filteredByCategory;
              const categoriesInUse = brandAssetCategories.filter(cat =>
                imageOnlyBrandAssets.some(ba => ba.categoryId === cat.id)
              );
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-medium">Add from Visual/Brand Assets</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Pinned images appear first in the Review Images picker.</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-3">{imageOnlyBrandAssets.length} available</span>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="p-2 border-b bg-muted/30 flex gap-2">
                      <Input
                        placeholder="Search brand assets…"
                        value={brandAssetSearch}
                        onChange={e => setBrandAssetSearch(e.target.value)}
                        className="h-8 text-sm flex-1"
                        data-testid="input-brand-asset-search"
                      />
                      {categoriesInUse.length > 0 && (
                        <Select value={brandAssetCategoryFilter} onValueChange={v => setBrandAssetCategoryFilter(v)}>
                          <SelectTrigger className="h-8 text-xs w-44 shrink-0" data-testid="select-brand-asset-category">
                            <SelectValue placeholder="All categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All categories</SelectItem>
                            {categoriesInUse.map(cat => (
                              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="divide-y max-h-72 overflow-y-auto">
                      {imageOnlyBrandAssets.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No images found in Visual/Brand Assets. Add some there first.</p>
                      ) : filteredBrandAssets.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No assets match your filter.</p>
                      ) : (
                        filteredBrandAssets.map(ba => {
                          const thumb = ba.fileUrl || ba.url;
                          return (
                            <div
                              key={ba.id}
                              className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
                              data-testid={`row-brand-asset-${ba.id}`}
                            >
                              {thumb ? (
                                <img src={thumb} alt="" className="w-8 h-8 rounded object-cover shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                                  <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{ba.name}</p>
                                {ba.categoryName && <p className="text-xs text-muted-foreground truncate">{ba.categoryName}</p>}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0"
                                disabled={addBrandAssetMutation.isPending}
                                onClick={() => addBrandAssetMutation.mutate(ba.id)}
                                data-testid={`button-add-brand-asset-${ba.id}`}
                              >
                                <Plus className="w-3.5 h-3.5 mr-1" />
                                Pin
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Add from Content Library ── */}
            {availableAssets.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-medium">Add from Content Library</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Digital/web assets — pinned items appear first in the link picker when reviewing posts.</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-3">{availableAssets.length} available</span>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-2 border-b bg-muted/30">
                    <Input
                      placeholder="Search assets…"
                      value={assetSearch}
                      onChange={e => setAssetSearch(e.target.value)}
                      className="h-8 text-sm"
                      data-testid="input-asset-search"
                    />
                  </div>
                  <div className="divide-y max-h-72 overflow-y-auto">
                    {filteredAvailableAssets.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">No assets match your search.</p>
                    ) : (
                      filteredAvailableAssets.map(asset => (
                        <div
                          key={asset.id}
                          className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
                          data-testid={`row-available-asset-${asset.id}`}
                        >
                          {asset.leadImageUrl ? (
                            <img src={asset.leadImageUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                          ) : (
                            <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                              <Library className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{asset.title}</p>
                            {asset.description && <p className="text-xs text-muted-foreground truncate">{asset.description}</p>}
                          </div>
                          {asset.assetType && (
                            <Badge variant="outline" className="shrink-0 text-xs hidden sm:inline-flex">{asset.assetType}</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            disabled={addAssetsMutation.isPending}
                            onClick={() => addAssetsMutation.mutate([asset.id])}
                            data-testid={`button-add-asset-${asset.id}`}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            Add
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {campaign.assets.length === 0 && (campaign.pinnedBrandAssets ?? []).length === 0 && availableAssets.length === 0 && brandAssets.filter(ba => ba.fileUrl || ba.url).length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-assets">
                  <Library className="w-8 h-8 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium mb-1">No assets yet</p>
                  <p className="text-xs">Add images to Visual/Brand Assets or digital/web items to the Content Library, then pin them here.</p>
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
                          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" title="Automatically publish approved scheduled posts to this account">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-primary"
                              checked={!!csa.autoPublish}
                              onChange={e => setAutoPublishMutation.mutate({ socialAccountId: csa.socialAccountId, autoPublish: e.target.checked })}
                              data-testid={`toggle-autopublish-${csa.socialAccountId}`}
                            />
                            Auto-publish
                          </label>
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

          {/* Review Posts — visual image-forward grid for bulk image QA */}
          <TabsContent value="review" className="space-y-4">
            {(() => {
              // ── helpers ──────────────────────────────────────────────────
              const activePosts = posts.filter(p => p.status !== "deleted");

              // filter
              const rvFiltered = activePosts.filter(p => {
                if (rvStatusFilter === "active" && (p.status === "rejected" || p.status === "archived")) return false;
                if (rvStatusFilter !== "active" && rvStatusFilter !== "all" && p.status !== rvStatusFilter) return false;
                if (rvPlatforms.length > 0 && !rvPlatforms.includes(p.platform)) return false;
                if (rvMissingImage && getPostImage(p)) return false;
                return true;
              });

              // grouping
              const dateLabel = (p: GeneratedPost): string => {
                if (!p.scheduledDate || !campaign.startDate || !campaign.numberOfDays) return "Unscheduled";
                const start = new Date(campaign.startDate).getTime();
                const end = start + campaign.numberOfDays * 86400000;
                const t = new Date(p.scheduledDate).getTime();
                const pct = (t - start) / (end - start);
                if (pct < 0.33) return "Early";
                if (pct < 0.67) return "Mid";
                return "Late";
              };

              const groupMap = new Map<string, GeneratedPost[]>();
              for (const p of rvFiltered) {
                let key: string;
                if (rvGroupBy === "channel") key = p.platform;
                else if (rvGroupBy === "concept") key = p.variantGroup || "Ungrouped";
                else key = dateLabel(p);
                if (!groupMap.has(key)) groupMap.set(key, []);
                groupMap.get(key)!.push(p);
              }
              const groups = Array.from(groupMap.entries()).sort(([a], [b]) => {
                if (rvGroupBy === "date") {
                  const order = ["Early", "Mid", "Late", "Unscheduled"];
                  return order.indexOf(a) - order.indexOf(b);
                }
                return a.localeCompare(b);
              });

              const allPlatforms = Array.from(new Set(activePosts.map(p => p.platform))).sort();

              // ── bulk generate ─────────────────────────────────────────────
              const bulkGenerateGraphics = async (postIds: string[]) => {
                setRvBulkTotal(postIds.length);
                setRvBulkProgress(0);
                for (let i = 0; i < postIds.length; i++) {
                  await generateGraphic(postIds[i]);
                  setRvBulkProgress(i + 1);
                }
                setRvBulkTotal(0);
                setRvBulkProgress(0);
                toast({ title: "Graphics generated", description: `Generated images for ${postIds.length} post(s).` });
              };

              const toggleSelect = (postId: string) => {
                setRvSelectedIds(prev => {
                  const s = new Set(prev);
                  if (s.has(postId)) s.delete(postId); else s.add(postId);
                  return s;
                });
              };

              const selectAll = () => setRvSelectedIds(new Set(rvFiltered.map(p => p.id)));
              const clearSelection = () => setRvSelectedIds(new Set());
              const rvSelectedHasLink = rvFiltered.some(p => rvSelectedIds.has(p.id) && p.linkUrl);

              const bulkStatusForSelected = async (status: "approved" | "rejected") => {
                if (status === "approved") setRvBulkApproving(true);
                else setRvBulkRejecting(true);
                try {
                  const ids = Array.from(rvSelectedIds);
                  await Promise.all(ids.map(postId =>
                    fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ status }),
                    })
                  ));
                  queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
                  toast({ title: `${ids.length} post${ids.length !== 1 ? "s" : ""} ${status === "approved" ? "approved" : "rejected"}` });
                  clearSelection();
                  setRvSelectMode(false);
                } catch {
                  toast({ title: "Error updating posts", variant: "destructive" });
                } finally {
                  setRvBulkApproving(false);
                  setRvBulkRejecting(false);
                }
              };

              return (
                <div className="space-y-4">
                  {/* Toolbar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Grouping */}
                    <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5" data-testid="rv-groupby-toggle">
                      {(["channel", "concept", "date"] as const).map(g => (
                        <button
                          key={g}
                          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors capitalize ${rvGroupBy === g ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => setRvGroupBy(g)}
                          data-testid={`button-rv-group-${g}`}
                        >
                          {g === "channel" && <LayoutGrid className="w-3 h-3" />}
                          {g === "concept" && <Layers className="w-3 h-3" />}
                          {g === "date" && <CalendarDays className="w-3 h-3" />}
                          {g}
                        </button>
                      ))}
                    </div>

                    {/* Platform multi-select */}
                    {allPlatforms.length > 1 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1.5 h-8" data-testid="button-rv-platform-filter">
                            <Filter className="w-3 h-3" />
                            {rvPlatforms.length === 0 ? "All platforms" : rvPlatforms.join(", ")}
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {allPlatforms.map(pl => (
                            <DropdownMenuCheckboxItem
                              key={pl}
                              checked={rvPlatforms.includes(pl)}
                              onCheckedChange={checked => {
                                setRvPlatforms(prev => checked ? [...prev, pl] : prev.filter(p => p !== pl));
                              }}
                              data-testid={`checkbox-rv-platform-${pl}`}
                            >
                              <span className="capitalize">{pl}</span>
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    {/* Status filter */}
                    <Select value={rvStatusFilter} onValueChange={setRvStatusFilter}>
                      <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-rv-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="exported">Exported</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Missing image toggle */}
                    <button
                      onClick={() => setRvMissingImage(v => !v)}
                      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${rvMissingImage ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid="button-rv-missing-image"
                    >
                      <ImageIcon className="w-3 h-3" />
                      Missing image only
                    </button>

                    {/* Select mode toggle */}
                    <Button
                      variant={rvSelectMode ? "secondary" : "outline"}
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => { setRvSelectMode(v => !v); clearSelection(); }}
                      data-testid="button-rv-select-mode"
                    >
                      {rvSelectMode ? <SquareCheck className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                      {rvSelectMode ? "Cancel" : "Select"}
                    </Button>

                    <span className="text-xs text-muted-foreground ml-auto">
                      {rvFiltered.length} post{rvFiltered.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Bulk action bar */}
                  {rvSelectMode && (
                    <div className="flex items-center gap-2 flex-wrap rounded-md border bg-muted/40 px-3 py-2" data-testid="rv-bulk-bar">
                      <span className="text-xs font-medium text-muted-foreground">
                        {rvSelectedIds.size} selected
                      </span>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={selectAll} data-testid="button-rv-select-all">
                        Select all ({rvFiltered.length})
                      </Button>
                      {rvSelectedIds.size > 0 && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={clearSelection} data-testid="button-rv-clear-selection">
                          Clear
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => {
                            const first = Array.from(rvSelectedIds)[0];
                            setImagePickerPostId(first || null);
                            setPickerTab("brand");
                          }}
                          data-testid="button-rv-bulk-replace-image"
                        >
                          <ImageLucide className="w-3.5 h-3.5" />
                          Replace image for selected…
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && (
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          disabled={rvBulkTotal > 0}
                          onClick={() => bulkGenerateGraphics(Array.from(rvSelectedIds))}
                          data-testid="button-rv-bulk-generate"
                        >
                          {rvBulkTotal > 0 ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" />{rvBulkProgress}/{rvBulkTotal}</>
                          ) : (
                            <><Wand2 className="w-3.5 h-3.5" />Generate graphics for selected</>
                          )}
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => {
                            setLinkUrlInput("");
                            setLinkLabelInput("");
                            setRvBulkLinkOpen(true);
                          }}
                          data-testid="button-rv-bulk-add-link"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Add link to selected…
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && rvSelectedHasLink && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          disabled={bulkLinkMutation.isPending}
                          onClick={() => bulkLinkMutation.mutate({ postIds: Array.from(rvSelectedIds), linkUrl: null, linkLabel: null })}
                          data-testid="button-rv-bulk-remove-link"
                        >
                          {bulkLinkMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                          Remove link from selected…
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950"
                          disabled={rvBulkApproving || rvBulkRejecting || rvBulkTotal > 0}
                          onClick={() => bulkStatusForSelected("approved")}
                          data-testid="button-rv-bulk-approve"
                        >
                          {rvBulkApproving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          Approve selected
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                          disabled={rvBulkApproving || rvBulkRejecting || rvBulkTotal > 0}
                          onClick={() => bulkStatusForSelected("rejected")}
                          data-testid="button-rv-bulk-reject"
                        >
                          {rvBulkRejecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                          Reject selected
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5 text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-950"
                          disabled={rvGeneratingIds.size > 0 || rvBulkApproving || rvBulkRejecting}
                          onClick={() => Array.from(rvSelectedIds).forEach(pid => generateGraphic(pid))}
                          title="Composite a text + logo graphic onto each selected post. Posts that already have a background image use it; others get one generated from the post text."
                          data-testid="button-rv-bulk-generate-graphics"
                        >
                          {rvGeneratingIds.size > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          Generate graphics{rvGeneratingIds.size > 0 ? ` (${rvGeneratingIds.size} left…)` : ""}
                        </Button>
                      )}
                    </div>
                  )}

                  {rvFiltered.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground text-sm border rounded-lg" data-testid="rv-empty">
                      {posts.length === 0 ? "No posts yet — generate some in the Social Posts tab." : "No posts match the current filters."}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {groups.map(([groupKey, groupPosts]) => (
                        <div key={groupKey} data-testid={`rv-group-${groupKey}`}>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                            <span className="capitalize">{groupKey}</span>
                            <span className="normal-case font-normal">({groupPosts.length})</span>
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {groupPosts.map(post => {
                              const img = getPostImage(post);
                              const isGenerating = rvGeneratingIds.has(post.id);
                              const isSelected = rvSelectedIds.has(post.id);
                              const fullCopy = post.editedContent ?? post.content ?? "";
                              const hashtags = fullCopy.match(/#[\w]+/g) ?? [];
                              const copyWithoutTags = fullCopy.replace(/#[\w]+/g, "").trim();
                              const isApproved = post.status === "approved";
                              const isRejected = post.status === "rejected";
                              return (
                                <Popover key={post.id} open={!rvSelectMode && rvHoveredPostId === post.id}>
                                  <PopoverTrigger asChild>
                                <div
                                  className={`group relative flex flex-col rounded-lg border bg-card overflow-hidden transition-all ${rvSelectMode ? "cursor-pointer" : ""} ${isSelected ? "ring-2 ring-primary border-primary" : isApproved ? "border-green-500/60 bg-green-500/5 hover:border-green-500/80" : isRejected ? "border-destructive/40 bg-destructive/5 opacity-75 hover:border-destructive/60 hover:opacity-90" : "hover:border-primary/50"}`}
                                  onClick={rvSelectMode ? () => toggleSelect(post.id) : undefined}
                                  onMouseEnter={() => { if (!rvSelectMode) setRvHoveredPostId(post.id); }}
                                  onMouseLeave={() => setRvHoveredPostId(null)}
                                  data-testid={`rv-card-${post.id}`}
                                >
                                  {/* Select checkbox */}
                                  {rvSelectMode && (
                                    <div className="absolute top-2 left-2 z-10">
                                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-primary border-primary" : "bg-background/80 border-muted-foreground"}`}>
                                        {isSelected && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
                                      </div>
                                    </div>
                                  )}

                                  {/* Image area */}
                                  <div className="relative aspect-video bg-muted/40 flex items-center justify-center overflow-hidden">
                                    {isGenerating ? (
                                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10 gap-1">
                                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                        <span className="text-[10px] text-muted-foreground">Generating…</span>
                                      </div>
                                    ) : null}
                                    {img ? (
                                      <img
                                        src={img}
                                        alt="Post image"
                                        className={`w-full h-full object-cover ${rvSelectMode ? "" : "cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary"}`}
                                        loading="lazy"
                                        role={rvSelectMode ? undefined : "button"}
                                        tabIndex={rvSelectMode ? undefined : 0}
                                        onClick={rvSelectMode ? undefined : (e) => { e.stopPropagation(); setLightboxImage(img); }}
                                        onKeyDown={rvSelectMode ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setLightboxImage(img); } }}
                                        title={rvSelectMode ? undefined : "Click to preview the full-size graphic"}
                                        data-testid={`rv-img-${post.id}`}
                                      />
                                    ) : (
                                      <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50 py-4" data-testid={`rv-no-img-${post.id}`}>
                                        <ImageIcon className="w-8 h-8" />
                                        <span className="text-[10px]">No image</span>
                                      </div>
                                    )}
                                    {post.overrideImageUrl && (
                                      <Badge variant="secondary" className="absolute bottom-1 right-1 text-[10px] z-10 pointer-events-none">
                                        Override
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Card body */}
                                  <div className="p-2 flex flex-col gap-1.5 flex-1">
                                    {/* Badges row */}
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <Badge className="text-[10px] capitalize px-1.5 py-0" data-testid={`rv-badge-platform-${post.id}`}>{post.platform}</Badge>
                                      <PostStageBadge post={post} className="px-1.5 py-0" />
                                    </div>

                                    {/* Copy excerpt */}
                                    <p className="text-xs text-muted-foreground line-clamp-2 leading-tight" data-testid={`rv-copy-${post.id}`}>
                                      {post.editedContent ?? post.content}
                                    </p>

                                    {/* Date */}
                                    {post.scheduledDate && (
                                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`rv-date-${post.id}`}>
                                        <Calendar className="w-2.5 h-2.5 shrink-0" />
                                        {format(new Date(post.scheduledDate), "MMM d")}
                                      </div>
                                    )}

                                    {/* Link chip */}
                                    {post.linkUrl && (
                                      <div className="flex items-center gap-1 mt-0.5" data-testid={`rv-link-chip-${post.id}`}>
                                        <Link2 className="w-2.5 h-2.5 text-primary shrink-0" />
                                        <span className="text-[10px] text-primary truncate max-w-[120px]">
                                          {post.linkLabel || post.linkUrl}
                                        </span>
                                      </div>
                                    )}

                                    {/* Action buttons */}
                                    {!rvSelectMode && (
                                      <div className="flex flex-col gap-1 mt-auto pt-1">
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-[10px] flex-1 gap-1 px-2"
                                            onClick={e => { e.stopPropagation(); setImagePickerPostId(post.id); setPickerTab("brand"); }}
                                            data-testid={`button-rv-replace-img-${post.id}`}
                                          >
                                            <ImageLucide className="w-3 h-3 shrink-0" />Replace
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-[10px] flex-1 gap-1 px-2"
                                            disabled={isGenerating}
                                            onClick={e => { e.stopPropagation(); generateGraphic(post.id); }}
                                            data-testid={`button-rv-generate-img-${post.id}`}
                                          >
                                            <Wand2 className="w-3 h-3 shrink-0" />Generate
                                          </Button>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-[10px] flex-1 gap-1 px-2 text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950"
                                            disabled={updatePostMutation.isPending}
                                            onClick={e => { e.stopPropagation(); updatePostMutation.mutate({ postId: post.id, status: "approved" }); }}
                                            data-testid={`button-rv-approve-${post.id}`}
                                          >
                                            <CheckCircle className="w-3 h-3 shrink-0" />Approve
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-[10px] flex-1 gap-1 px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                                            disabled={updatePostMutation.isPending}
                                            onClick={e => { e.stopPropagation(); updatePostMutation.mutate({ postId: post.id, status: "rejected" }); }}
                                            data-testid={`button-rv-reject-${post.id}`}
                                          >
                                            <XCircle className="w-3 h-3 shrink-0" />Reject
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                    {/* Link attach button — LinkedIn, Facebook, X only */}
                                    {!rvSelectMode && ["linkedin", "facebook", "twitter"].includes(post.platform) && (
                                      <Button
                                        size="sm"
                                        variant={post.linkUrl ? "default" : "ghost"}
                                        className="h-6 text-[10px] w-full gap-1 px-2 mt-0.5"
                                        onClick={e => {
                                          e.stopPropagation();
                                          setLinkUrlInput(post.linkUrl || "");
                                          setLinkLabelInput(post.linkLabel || "");
                                          setLinkPopoverPostId(post.id);
                                        }}
                                        data-testid={`button-rv-add-link-${post.id}`}
                                      >
                                        <Link2 className="w-3 h-3 shrink-0" />
                                        {post.linkUrl ? "Edit link" : "Add link"}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="right"
                                    align="start"
                                    className="w-72 p-3 space-y-2.5"
                                    onMouseEnter={() => setRvHoveredPostId(post.id)}
                                    onMouseLeave={() => setRvHoveredPostId(null)}
                                    data-testid={`rv-post-popover-${post.id}`}
                                  >
                                    <p className="text-xs font-medium text-foreground leading-snug whitespace-pre-wrap break-words">
                                      {copyWithoutTags || fullCopy}
                                    </p>
                                    {hashtags.length > 0 && (
                                      <div className="flex flex-wrap gap-1" data-testid={`rv-popover-hashtags-${post.id}`}>
                                        {hashtags.map(tag => (
                                          <span key={tag} className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {post.scheduledDate && (
                                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border-t pt-2" data-testid={`rv-popover-date-${post.id}`}>
                                        <Calendar className="w-3 h-3 shrink-0" />
                                        <span>Scheduled: {format(new Date(post.scheduledDate), "MMM d, yyyy")}</span>
                                      </div>
                                    )}
                                  </PopoverContent>
                                </Popover>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      </div>

      {/* Image Override Picker Dialog — brand assets + content assets */}
      <Dialog open={!!imagePickerPostId} onOpenChange={v => { if (!v) { setImagePickerPostId(null); setPickerCategoryFilter("all"); setPickerContentCategoryFilter("all"); setPickerPage(0); setPickerTab("brand"); setPickerShowAll(false); } }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Image</DialogTitle>
            <DialogDescription>
              Pick a brand asset or a content library item, or clear the override to use the post's default image.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">Generate a branded graphic</p>
              <p className="text-xs text-muted-foreground">
                Overlays the post headline and your logo on the currently selected photo (or uses a brand-color gradient if no photo is set).
              </p>
              <Button
                variant="default"
                size="sm"
                className="mt-2 gap-1.5"
                disabled={isGenerating}
                onClick={async () => {
                  if (!imagePickerPostId) return;
                  await generateGraphic(imagePickerPostId);
                  setImagePickerPostId(null);
                }}
                data-testid="button-picker-generate-image"
              >
                {isGenerating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                  : <><Wand2 className="w-3.5 h-3.5" /> Generate branded image</>}
              </Button>
            </div>
            <div className="relative flex items-center gap-2 text-xs text-muted-foreground before:flex-1 before:h-px before:bg-border after:flex-1 after:h-px after:bg-border">
              or pick a photo
            </div>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                if (imagePickerPostId) {
                  updatePostMutation.mutate({
                    postId: imagePickerPostId,
                    overrideImageUrl: null,
                    overrideBrandAssetId: null,
                  });
                }
              }}
              data-testid="button-reset-image"
            >
              <X className="w-4 h-4" /> Clear override (use default)
            </Button>

            {/* Tab toggle: brand assets vs content assets */}
            <div className="flex rounded-md border overflow-hidden" data-testid="picker-tab-toggle">
              <button
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${pickerTab === "brand" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setPickerTab("brand"); setPickerPage(0); setPickerCategoryFilter("all"); setPickerContentCategoryFilter("all"); }}
                data-testid="button-picker-tab-brand"
              >
                Brand Assets
              </button>
              <button
                className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l ${pickerTab === "content" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setPickerTab("content"); setPickerPage(0); setPickerCategoryFilter("all"); setPickerContentCategoryFilter("all"); }}
                data-testid="button-picker-tab-content"
              >
                Content Library
              </button>
            </div>

            {/* Brand assets tab */}
            {pickerTab === "brand" && (() => {
              const imageAssets = brandAssets.filter(ba => ba.fileUrl || ba.url);
              if (imageAssets.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-4">No brand assets available. Add images in Visual/Brand Assets first.</p>;
              }
              const pinnedBrandAssetIds = new Set((campaign?.pinnedBrandAssets ?? []).map(p => p.brandAssetId));
              const campaignFirst = imageAssets.filter(ba => pinnedBrandAssetIds.has(ba.id));
              const displayList = pickerShowAll || campaignFirst.length === 0 ? imageAssets : campaignFirst;
              const pickerCategories = [...new Set(displayList.map(ba => ba.categoryName).filter(Boolean))] as string[];
              const filtered = pickerCategoryFilter === "all" ? displayList : displayList.filter(ba => ba.categoryName === pickerCategoryFilter);
              const totalPages = Math.ceil(filtered.length / BRAND_PAGE_SIZE);
              const paged = filtered.slice(pickerPage * BRAND_PAGE_SIZE, (pickerPage + 1) * BRAND_PAGE_SIZE);
              return (
                <div className="space-y-3">
                  {campaignFirst.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {pickerShowAll ? `All ${imageAssets.length} brand assets` : `${campaignFirst.length} pinned to this campaign`}
                      </span>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => { setPickerShowAll(s => !s); setPickerPage(0); setPickerCategoryFilter("all"); }}
                        data-testid="button-picker-show-all-brand"
                      >
                        {pickerShowAll ? "Show campaign only" : `Show all ${imageAssets.length}`}
                      </button>
                    </div>
                  )}
                  {pickerCategories.length > 1 && (
                    <Select value={pickerCategoryFilter} onValueChange={v => { setPickerCategoryFilter(v); setPickerPage(0); }}>
                      <SelectTrigger className="h-8 text-xs" data-testid="select-picker-category">
                        <SelectValue placeholder="All categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories ({displayList.length})</SelectItem>
                        {pickerCategories.sort().map(cat => (
                          <SelectItem key={cat} value={cat}>{cat} ({displayList.filter(a => a.categoryName === cat).length})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {paged.map(ba => (
                      <button
                        key={ba.id}
                        className={`border rounded-lg p-2 hover:border-primary transition-colors text-left ${pinnedBrandAssetIds.has(ba.id) ? "ring-1 ring-primary/30" : ""}`}
                        onClick={() => {
                          if (imagePickerPostId) {
                            const targets = rvSelectMode && rvSelectedIds.size > 0
                              ? Array.from(rvSelectedIds)
                              : postSelectMode && postSelectedIds.size > 0
                                ? Array.from(postSelectedIds)
                                : [imagePickerPostId];
                            targets.forEach(pid => updatePostMutation.mutate({
                              postId: pid,
                              overrideImageUrl: ba.fileUrl || ba.url || "",
                              overrideBrandAssetId: ba.id,
                            }));
                            if (targets.length > 1) {
                              setImagePickerPostId(null);
                              setPickerTab("brand");
                              setRvSelectMode(false);
                              setRvSelectedIds(new Set());
                              setPostSelectMode(false);
                              setPostSelectedIds(new Set());
                            }
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

            {/* Content assets tab — campaign assets first, full library below */}
            {pickerTab === "content" && (() => {
              const allContentImageAssets = allAssets.filter(a => a.url || a.fileUrl);
              if (allContentImageAssets.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-4">No content library items found. Add assets with a URL in the Content Library first.</p>;
              }
              // Only offer categories that actually have assets in this set.
              const presentCategoryIds = new Set(allContentImageAssets.map(a => a.categoryId).filter(Boolean) as string[]);
              const availableCategories = contentCategories.filter(c => presentCategoryIds.has(c.id));
              // Defensive: if the active filter no longer maps to an available
              // category (e.g. assets changed underneath it), treat it as "all".
              const activeContentCategory = pickerContentCategoryFilter !== "all" && presentCategoryIds.has(pickerContentCategoryFilter)
                ? pickerContentCategoryFilter
                : "all";
              const contentImageAssets = activeContentCategory === "all"
                ? allContentImageAssets
                : allContentImageAssets.filter(a => a.categoryId === activeContentCategory);
              const campaignAssetIds = new Set((campaign?.assets ?? []).map(ca => ca.assetId));
              const campaignFirst = contentImageAssets.filter(a => campaignAssetIds.has(a.id));
              const restAssets = contentImageAssets.filter(a => !campaignAssetIds.has(a.id));
              const displayList = pickerShowAll ? contentImageAssets : (campaignFirst.length > 0 ? campaignFirst : contentImageAssets);
              const totalPages = Math.ceil(displayList.length / BRAND_PAGE_SIZE);
              const paged = displayList.slice(pickerPage * BRAND_PAGE_SIZE, (pickerPage + 1) * BRAND_PAGE_SIZE);
              const renderAssetButton = (ca: ContentAsset) => {
                const imageUrl = ca.leadImageUrl || ca.url || ca.fileUrl || "";
                const overrideUrl = ca.leadImageUrl || ca.url || ca.fileUrl || "";
                return (
                  <button
                    key={ca.id}
                    className="border rounded-lg p-2 hover:border-primary transition-colors text-left"
                    onClick={() => {
                      if (imagePickerPostId) {
                        const targets = rvSelectMode && rvSelectedIds.size > 0
                          ? Array.from(rvSelectedIds)
                          : postSelectMode && postSelectedIds.size > 0
                            ? Array.from(postSelectedIds)
                            : [imagePickerPostId];
                        targets.forEach(pid => updatePostMutation.mutate({
                          postId: pid,
                          overrideImageUrl: overrideUrl,
                          overrideBrandAssetId: null,
                        }));
                        if (targets.length > 1) {
                          setImagePickerPostId(null);
                          setPickerTab("brand");
                          setPickerShowAll(false);
                          setRvSelectMode(false);
                          setRvSelectedIds(new Set());
                          setPostSelectMode(false);
                          setPostSelectedIds(new Set());
                        }
                      }
                    }}
                    data-testid={`button-content-asset-${ca.id}`}
                  >
                    {imageUrl ? (
                      <OptimizedThumbnail
                        src={imageUrl}
                        alt={ca.title}
                        containerClassName="rounded"
                      />
                    ) : (
                      <div className="aspect-video flex items-center justify-center bg-muted/40 rounded">
                        <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                      </div>
                    )}
                    <p className="text-xs mt-1 truncate">{ca.title}</p>
                    {ca.description && <p className="text-[10px] text-muted-foreground truncate">{ca.description}</p>}
                  </button>
                );
              };
              return (
                <div className="space-y-3">
                  {availableCategories.length > 0 && (
                    <Select value={activeContentCategory} onValueChange={v => { setPickerContentCategoryFilter(v); setPickerPage(0); }}>
                      <SelectTrigger className="h-8 text-xs" data-testid="select-picker-content-category">
                        <SelectValue placeholder="All categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories ({allContentImageAssets.length})</SelectItem>
                        {availableCategories.map(cat => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name} ({allContentImageAssets.filter(a => a.categoryId === cat.id).length})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!pickerShowAll && campaignFirst.length > 0 && (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Campaign assets</p>
                      <div className="grid grid-cols-2 gap-2">
                        {campaignFirst.map(renderAssetButton)}
                      </div>
                      {restAssets.length > 0 && (
                        <button
                          className="text-xs text-primary underline-offset-2 hover:underline w-full text-center py-1"
                          onClick={() => { setPickerShowAll(true); setPickerPage(0); }}
                          data-testid="button-picker-show-all"
                        >
                          Show full library ({contentImageAssets.length} items)
                        </button>
                      )}
                    </>
                  )}
                  {(pickerShowAll || campaignFirst.length === 0) && (
                    <>
                      {campaignFirst.length > 0 && pickerShowAll && (
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Full library</p>
                          <button
                            className="text-xs text-primary underline-offset-2 hover:underline"
                            onClick={() => { setPickerShowAll(false); setPickerPage(0); }}
                            data-testid="button-picker-show-campaign"
                          >
                            Show campaign assets only
                          </button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {paged.map(renderAssetButton)}
                      </div>
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-1">
                          <Button variant="outline" size="sm" disabled={pickerPage === 0} onClick={() => setPickerPage(p => p - 1)} data-testid="button-picker-content-prev">Previous</Button>
                          <span className="text-xs text-muted-foreground">Page {pickerPage + 1} of {totalPages}</span>
                          <Button variant="outline" size="sm" disabled={pickerPage >= totalPages - 1} onClick={() => setPickerPage(p => p + 1)} data-testid="button-picker-content-next">Next</Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Image preview lightbox — see the full-size logo + headline overlay */}
      <Dialog open={!!lightboxImage} onOpenChange={(o) => { if (!o) setLightboxImage(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Image preview</DialogTitle>
            <DialogDescription>
              Full-size preview of the graphic, including the logo and headline overlay.
            </DialogDescription>
          </DialogHeader>
          {lightboxImage && (
            <img
              src={lightboxImage}
              alt="Full-size preview"
              className="w-full h-auto rounded-md border"
              data-testid="img-lightbox-preview"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Link attachment dialog — LinkedIn, Facebook, X */}
      <Dialog
        open={!!linkPopoverPostId || rvBulkLinkOpen}
        onOpenChange={v => {
          if (!v) {
            setLinkPopoverPostId(null);
            setRvBulkLinkOpen(false);
            setLinkUrlInput("");
            setLinkLabelInput("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{rvBulkLinkOpen ? `Attach link to ${rvSelectedIds.size} post${rvSelectedIds.size !== 1 ? "s" : ""}` : "Attach link to post"}</DialogTitle>
            <DialogDescription>
              {rvBulkLinkOpen
                ? `The same URL will be applied to all ${rvSelectedIds.size} selected post${rvSelectedIds.size !== 1 ? "s" : ""}. The link won't be inserted into the copy — the social publisher handles that.`
                : "Add a URL to accompany this post. The link won't be inserted into the copy — the social publisher handles that."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Quick-pick: campaign digital assets */}
            {(() => {
              const campaignAssetIds = new Set((campaign?.assets ?? []).map(ca => ca.assetId));
              const digitalCampaignAssets = allAssets.filter(a => campaignAssetIds.has(a.id) && !!a.url);
              if (digitalCampaignAssets.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Campaign digital assets</p>
                  <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                    {digitalCampaignAssets.map(a => (
                      <button
                        key={a.id}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 transition-colors"
                        onClick={() => { setLinkUrlInput(a.url || ""); setLinkLabelInput(a.title); }}
                        data-testid={`button-link-quickpick-${a.id}`}
                      >
                        <span className="font-medium block truncate">{a.title}</span>
                        <span className="text-muted-foreground truncate block">{a.url}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label htmlFor="link-url-input">URL</Label>
              <Input
                id="link-url-input"
                type="url"
                value={linkUrlInput}
                onChange={e => setLinkUrlInput(e.target.value)}
                placeholder="https://example.com"
                data-testid="input-link-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="link-label-input">Label (optional)</Label>
              <Input
                id="link-label-input"
                value={linkLabelInput}
                onChange={e => setLinkLabelInput(e.target.value)}
                placeholder="e.g. Read the case study"
                data-testid="input-link-label"
              />
            </div>

            <div className="flex gap-2 pt-1">
              {!rvBulkLinkOpen && linkPopoverPostId && posts.find(p => p.id === linkPopoverPostId)?.linkUrl && (
                <Button
                  variant="outline"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => updatePostMutation.mutate({ postId: linkPopoverPostId!, linkUrl: null, linkLabel: null })}
                  disabled={updatePostMutation.isPending}
                  data-testid="button-link-clear"
                >
                  <Unlink className="w-3.5 h-3.5" />Clear
                </Button>
              )}
              <Button
                className="flex-1"
                disabled={!linkUrlInput.trim() || updatePostMutation.isPending || bulkLinkMutation.isPending}
                onClick={() => {
                  if (rvBulkLinkOpen) {
                    bulkLinkMutation.mutate({
                      postIds: Array.from(rvSelectedIds),
                      linkUrl: linkUrlInput.trim(),
                      linkLabel: linkLabelInput.trim() || null,
                    });
                  } else {
                    if (!linkPopoverPostId) return;
                    updatePostMutation.mutate({ postId: linkPopoverPostId, linkUrl: linkUrlInput.trim(), linkLabel: linkLabelInput.trim() || null });
                  }
                }}
                data-testid="button-link-save"
              >
                {(updatePostMutation.isPending || bulkLinkMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {rvBulkLinkOpen ? `Apply to ${rvSelectedIds.size} post${rvSelectedIds.size !== 1 ? "s" : ""}` : "Save link"}
              </Button>
            </div>
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
            <div className="grid gap-2">
              <Label>Campaign Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {CAMPAIGN_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEditCampaignType(opt.value)}
                    className={`text-left rounded-md border p-2.5 transition-colors ${
                      editCampaignType === opt.value
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-input hover:bg-muted/50"
                    }`}
                    data-testid={`button-edit-campaign-type-${opt.value}`}
                  >
                    <span className="block text-sm font-medium">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-objective">Objective</Label>
              <Textarea
                id="edit-campaign-objective"
                value={editCampaignObjective}
                onChange={e => setEditCampaignObjective(e.target.value)}
                placeholder="What are we promoting, and why? e.g. Drive registrations for the June security webinar."
                rows={3}
                data-testid="input-edit-campaign-objective"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-goal">Goal</Label>
              <Input
                id="edit-campaign-goal"
                value={editCampaignGoal}
                onChange={e => setEditCampaignGoal(e.target.value)}
                placeholder="Measurable target, e.g. 200 webinar registrations"
                data-testid="input-edit-campaign-goal"
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

      {/* Archive with active children warning */}
      <Dialog open={archiveWithChildrenOpen} onOpenChange={setArchiveWithChildrenOpen}>
        <DialogContent className="sm:max-w-[420px]" data-testid="dialog-archive-with-children">
          <DialogHeader>
            <DialogTitle>Archive mainline campaign?</DialogTitle>
            <DialogDescription>
              This campaign has {(campaign?.children ?? []).filter(c => c.status !== "archived" && c.status !== "deleted").length} active child {(campaign?.children ?? []).filter(c => c.status !== "archived" && c.status !== "deleted").length === 1 ? "campaign" : "campaigns"}. Archiving the mainline does not archive its children — they will remain active and independent.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setArchiveWithChildrenOpen(false)} data-testid="button-cancel-archive-mainline">Cancel</Button>
            <Button
              onClick={() => {
                setArchiveWithChildrenOpen(false);
                updateCampaignStatusMutation.mutate("archived");
              }}
              data-testid="button-confirm-archive-mainline"
            >
              Archive anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Child Campaign Dialog */}
      <Dialog open={linkChildOpen} onOpenChange={open => { setLinkChildOpen(open); if (!open) setLinkChildSearch(""); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-link-child-campaign">
          <DialogHeader>
            <DialogTitle>Link child campaign</DialogTitle>
            <DialogDescription>
              Select an existing campaign to attach as a child of this mainline campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <input
              type="text"
              placeholder="Search campaigns…"
              value={linkChildSearch}
              onChange={e => setLinkChildSearch(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-link-child-search"
            />
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {allCampaigns
                .filter(c =>
                  c.id !== id &&
                  c.status !== "deleted" &&
                  !c.parentCampaignId &&
                  (campaign.children ?? []).every(ch => ch.id !== c.id) &&
                  c.name.toLowerCase().includes(linkChildSearch.toLowerCase())
                )
                .map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
                    onClick={() => linkChildMutation.mutate(c.id)}
                    disabled={linkChildMutation.isPending}
                    data-testid={`option-link-child-${c.id}`}
                  >
                    <span className="font-medium truncate">{c.name}</span>
                    <Badge variant="secondary" className="capitalize text-xs shrink-0">{c.status}</Badge>
                  </button>
                ))}
              {allCampaigns.filter(c =>
                c.id !== id &&
                c.status !== "deleted" &&
                !c.parentCampaignId &&
                (campaign.children ?? []).every(ch => ch.id !== c.id) &&
                c.name.toLowerCase().includes(linkChildSearch.toLowerCase())
              ).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No eligible campaigns found.</p>
              )}
            </div>
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
              <p className="text-xs text-muted-foreground">{parseInt(postsPerDay) > 1 ? "First post of each day starts at this time." : "All posts will be scheduled at this time of day."}</p>
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
            {parseInt(postsPerDay) > 1 && (
              <div className="space-y-2">
                <Label htmlFor="minutes-between">Minutes Between Posts</Label>
                <Input
                  id="minutes-between"
                  type="number"
                  min="15"
                  max="480"
                  step="15"
                  value={minutesBetweenPosts}
                  onChange={e => setMinutesBetweenPosts(e.target.value)}
                  data-testid="input-minutes-between"
                />
                <p className="text-xs text-muted-foreground">
                  {parseInt(postsPerDay) > 1
                    ? `${postsPerDay} posts per day spaced ${minutesBetweenPosts} min apart (${parseFloat((parseInt(minutesBetweenPosts) / 60).toFixed(1))} hrs). First post at ${scheduleTime}, last at ${(() => {
                        const [h, m] = scheduleTime.split(":").map(Number);
                        const totalMin = h * 60 + m + (parseInt(postsPerDay) - 1) * parseInt(minutesBetweenPosts);
                        const fh = Math.floor(totalMin / 60) % 24;
                        const fm = totalMin % 60;
                        return `${String(fh).padStart(2, "0")}:${String(fm).padStart(2, "0")}`;
                      })()}.`
                    : ""}
                </p>
              </div>
            )}
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
            {schedulablePlatforms.length > 0 && (
              <div className="space-y-2">
                <Label>Platforms to schedule</Label>
                <div className="flex flex-wrap gap-3">
                  {schedulablePlatforms.map((pl) => (
                    <label key={pl} className="flex items-center gap-2 text-sm cursor-pointer capitalize" data-testid={`checkbox-schedule-platform-${pl}`}>
                      <Checkbox
                        checked={schedulePlatforms.includes(pl)}
                        onCheckedChange={(c) =>
                          setSchedulePlatforms((prev) => (c ? [...prev, pl] : prev.filter((x) => x !== pl)))
                        }
                      />
                      {pl}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Only the checked platforms get dated. Posts on the others are left untouched.</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Weekends:{" "}
              {campaign?.includeSaturday && campaign?.includeSunday
                ? "Saturdays and Sundays included"
                : !campaign?.includeSaturday && !campaign?.includeSunday
                ? "skipped (weekdays only)"
                : campaign?.includeSaturday
                ? "Sundays skipped"
                : "Saturdays skipped"}
              . Change this in Edit Campaign.
            </p>
            <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="checkbox-archive-leftover">
              <Checkbox
                checked={scheduleArchiveLeftover}
                onCheckedChange={(c) => setScheduleArchiveLeftover(!!c)}
              />
              Archive any leftover posts that still have no date
            </label>
            <div className="text-sm text-muted-foreground" data-testid="text-schedule-preview">
              {(() => {
                const active = posts.filter(p => p.status !== "deleted" && p.status !== "rejected" && schedulePlatforms.includes(p.platform)).length;
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
                const spacingLabel = perDay > 1 ? `, ${minutesBetweenPosts} min apart` : "";
                return `${active} active post${active !== 1 ? "s" : ""} will be distributed across ${postingDays} posting day${postingDays !== 1 ? "s" : ""} (${perDay}/day${spacingLabel}, ${intervalLabel}${dayTypeLabel}).`;
              })()}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)} data-testid="button-cancel-schedule">Cancel</Button>
            <Button
              onClick={() => schedulePostsMutation.mutate({ time: scheduleTime, perDay: parseInt(postsPerDay), daysBetween: parseInt(daysBetweenPosts), spacingMinutes: parseInt(minutesBetweenPosts) || 180, platforms: schedulePlatforms, archiveLeftover: scheduleArchiveLeftover })}
              disabled={schedulePostsMutation.isPending || schedulePlatforms.length === 0}
              data-testid="button-confirm-schedule"
            >
              {schedulePostsMutation.isPending ? "Scheduling..." : "Schedule Posts"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generateDialogOpen} onOpenChange={(o) => { if (!o) { setGenerateDialogOpen(false); setSelectedBrandImageIds([]); setBrandCategoryFilter("all"); setBrandPage(0); setThematicBrief(""); setThematicUrl(""); setGenerateMode("asset"); setVariantsPerPlatform(null); setSelectedBriefId(null); } else { setGenerateDialogOpen(true); } }}>
        <DialogContent className="max-w-lg flex flex-col max-h-[80vh]">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Generate Social Posts</DialogTitle>
            <DialogDescription>
              Choose how to source the content for your generated posts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">

            {/* Variants-per-platform control */}
            {(() => {
              const days = campaign?.numberOfDays ?? 7;
              const dpw = 5 + (campaign?.includeSaturday ? 1 : 0) + (campaign?.includeSunday ? 1 : 0);
              const eligibleDays = Math.max(1, Math.ceil(days * dpw / 7));
              const autoTarget = Math.min(Math.max(eligibleDays, minVariants), maxVariants);
              const effective = variantsPerPlatform ?? autoTarget;
              const accountCount = campaign?.socialAccounts?.length || 1;
              return (
                <div className="rounded-lg border bg-primary/5 border-primary/20 px-3 py-2.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm font-medium">Variants per channel</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">How many unique text variants to draft for each social channel.</p>
                    </div>
                    <Select
                      value={variantsPerPlatform === null ? "auto" : String(variantsPerPlatform)}
                      onValueChange={(v) => setVariantsPerPlatform(v === "auto" ? null : Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[150px] text-xs flex-shrink-0" data-testid="select-variants-per-platform">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto ({autoTarget})</SelectItem>
                        {Array.from({ length: maxVariants - minVariants + 1 }, (_, i) => minVariants + i).map(n => (
                          <SelectItem key={n} value={String(n)}>{n} per channel</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-foreground" data-testid="text-variant-count-hint">
                    Will generate <strong>{effective} unique text variants per channel</strong> ({effective * accountCount} total across {accountCount} channel{accountCount !== 1 ? "s" : ""}), each committed to a distinct creative angle — question hook, statistic, story, contrarian take, behind-the-scenes, comparison, and more. Consecutive scheduled days never repeat the same post.
                    {eligibleDays > effective && (
                      <span className="block mt-1 text-muted-foreground">
                        Your campaign has {eligibleDays} eligible posting days, so the {effective} variants will recycle roughly every {effective} scheduled days. Choose a higher number for more variety (max {maxVariants}).
                      </span>
                    )}
                  </p>
                </div>
              );
            })()}

            {/* Mode Toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setGenerateMode("asset")}
                className={`flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${generateMode === "asset" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"}`}
                data-testid="button-mode-asset"
              >
                <span className="text-sm font-semibold">From Digital Assets</span>
                <span className="text-xs text-muted-foreground mt-0.5">Each pinned content asset <em>drives</em> the post content — posts are written about the asset itself</span>
              </button>
              <button
                onClick={() => setGenerateMode("thematic")}
                className={`flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${generateMode === "thematic" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"}`}
                data-testid="button-mode-thematic"
              >
                <span className="text-sm font-semibold">From Brief / Theme</span>
                <span className="text-xs text-muted-foreground mt-0.5">Posts come from your brief text — pinned links and images are applied <em>after</em> generation</span>
              </button>
            </div>

            {/* Thematic Brief Fields */}
            {generateMode === "thematic" && (
              <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
                {/* Brief picker — uses existing campaign briefs */}
                {briefs.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium">Pick a content brief</Label>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">Select a brief to load its context automatically, or skip this and type below.</p>
                    <Select
                      value={selectedBriefId ?? "__none__"}
                      onValueChange={(v) => {
                        if (v === "__none__") {
                          setSelectedBriefId(null);
                          setThematicBrief("");
                          return;
                        }
                        const picked = briefs.find(b => b.id === v);
                        if (!picked) return;
                        setSelectedBriefId(v);
                        const parts: string[] = [`Brief: ${picked.title}`];
                        if (picked.summary) parts.push(`Summary: ${picked.summary}`);
                        if (picked.demandSignal) parts.push(`Why this matters: ${picked.demandSignal}`);
                        if (picked.differentiationAngle) parts.push(`Our angle: ${picked.differentiationAngle}`);
                        if (picked.targetReader) parts.push(`Audience: ${picked.targetReader}`);
                        if (picked.cta) parts.push(`Call to action: ${picked.cta}`);
                        if (picked.ideaSignals?.length) parts.push(`News hooks / signals:\n${picked.ideaSignals.map(s => `- ${s}`).join("\n")}`);
                        setThematicBrief(parts.join("\n\n"));
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm" data-testid="select-brief-picker">
                        <SelectValue placeholder="Select a brief…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None (type manually) —</SelectItem>
                        {briefs.filter(b => b.status !== "removed").map(b => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.title}
                            {b.format ? ` · ${BRIEF_FORMAT_LABELS[b.format] ?? b.format}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-sm font-medium">
                    {selectedBriefId ? "Context (loaded from brief — edit if needed)" : "Campaign Brief"}
                  </Label>
                  {!selectedBriefId && (
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">Describe the theme, story, or message you want to share. AI will rewrite this into platform-native posts — don't worry about polish.</p>
                  )}
                  <textarea
                    value={thematicBrief}
                    onChange={e => setThematicBrief(e.target.value)}
                    placeholder={briefs.length > 0 ? "Pick a brief above, or describe the theme here…" : "Describe the theme, story, or message you want to share…"}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 mt-1.5"
                    data-testid="input-thematic-brief"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Reference URL (optional)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">A link to include with a call-to-action. Leave blank to omit links.</p>
                  <input
                    type="url"
                    value={thematicUrl}
                    onChange={e => setThematicUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    data-testid="input-thematic-url"
                  />
                </div>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium">Visual/Brand Assets (optional)</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Select up to {Math.max(3, campaign?.socialAccounts?.length ? campaign.socialAccounts.length * 3 : 3)} images. More images = more unique combinations per day.
              </p>
              {(() => {
                const imageBrandAssets = brandAssets.filter(ba => ba.fileUrl || ba.url);
                if (imageBrandAssets.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-4">No brand images available. Add images in Visual/Brand Assets first.</p>;
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
          <div className="pt-3 border-t flex-shrink-0">
            <label className="flex items-start gap-2 cursor-pointer text-sm py-2" data-testid="toggle-wrap-post-links-label">
              <Checkbox
                checked={wrapPostLinks}
                onCheckedChange={(v) => setWrapPostLinks(!!v)}
                className="mt-0.5"
                data-testid="checkbox-wrap-post-links"
              />
              <div>
                <span className="font-medium">Wrap outbound URLs in tracked redirects</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Replace any URLs the AI generates with /r/short-codes that record click counts and append UTM tags. Visit the Links tab afterwards to see them.
                </p>
              </div>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => { setGenerateDialogOpen(false); setSelectedBrandImageIds([]); setSelectedPersonaIds([]); setBrandCategoryFilter("all"); setBrandPage(0); setThematicBrief(""); setThematicUrl(""); setGenerateMode("asset"); setWrapPostLinks(false); setVariantsPerPlatform(null); setSelectedBriefId(null); }} data-testid="button-cancel-generate">Cancel</Button>
            <Button
              onClick={() => generatePostsMutation.mutate({
                brandImageIds: selectedBrandImageIds.length > 0 ? selectedBrandImageIds : undefined,
                personaIds: selectedPersonaIds.length > 0 ? selectedPersonaIds : undefined,
                thematicBrief: generateMode === "thematic" ? thematicBrief : undefined,
                thematicUrl: generateMode === "thematic" ? thematicUrl : undefined,
                wrapLinks: wrapPostLinks,
                variantsPerPlatform,
              })}
              disabled={generatePostsMutation.isPending || isGenerating || (generateMode === "thematic" && !thematicBrief.trim())}
              className="gap-2"
              data-testid="button-confirm-generate"
            >
              {generatePostsMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Starting...</> : <><Sparkles className="w-4 h-4" />Generate Posts</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={createPostOpen} onOpenChange={setCreatePostOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-create-post-title">Create Post</DialogTitle>
            <DialogDescription>Write or paste your post content and select which social accounts should receive it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="create-post-content">Post Content</Label>
              <Textarea
                id="create-post-content"
                placeholder="Type or paste your post text here..."
                value={createPostContent}
                onChange={e => setCreatePostContent(e.target.value)}
                rows={6}
                className="mt-1"
                data-testid="textarea-create-post-content"
              />
              <p className="text-xs text-muted-foreground mt-1">{createPostContent.length} characters</p>
            </div>
            <div>
              <Label>Social Accounts</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {campaign?.socialAccounts.map(csa => {
                  const account = allSocialAccounts.find(a => a.id === csa.socialAccountId);
                  if (!account) return null;
                  const selected = createPostAccountIds.includes(account.id);
                  return (
                    <Badge
                      key={account.id}
                      variant={selected ? "default" : "outline"}
                      className="cursor-pointer gap-1"
                      onClick={() => setCreatePostAccountIds(prev =>
                        selected ? prev.filter(x => x !== account.id) : [...prev, account.id]
                      )}
                      data-testid={`badge-create-account-${account.id}`}
                    >
                      {account.platform} — {account.accountName}
                    </Badge>
                  );
                })}
                {(!campaign?.socialAccounts || campaign.socialAccounts.length === 0) && (
                  <p className="text-xs text-muted-foreground">No social accounts linked to this campaign.</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="create-post-date">Scheduled Date (optional)</Label>
                <Input
                  id="create-post-date"
                  type="datetime-local"
                  value={createPostScheduledDate}
                  onChange={e => setCreatePostScheduledDate(e.target.value)}
                  className="mt-1"
                  data-testid="input-create-post-date"
                />
              </div>
              <div>
                <Label htmlFor="create-post-image">Brand Image (optional)</Label>
                <Select value={createPostBrandAssetId} onValueChange={setCreatePostBrandAssetId}>
                  <SelectTrigger className="mt-1" data-testid="select-create-post-image">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {brandAssets.filter(ba => ba.fileUrl || ba.url).map(ba => (
                      <SelectItem key={ba.id} value={ba.id}>{ba.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="create-post-ai-polish"
                checked={createPostAiPolish}
                onCheckedChange={(checked) => setCreatePostAiPolish(checked === true)}
                data-testid="checkbox-ai-polish"
              />
              <Label htmlFor="create-post-ai-polish" className="text-sm cursor-pointer">
                AI Polish — adapt text per platform (adjust tone, suggest hashtags, trim for character limits)
              </Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setCreatePostOpen(false)} data-testid="button-cancel-create-post">Cancel</Button>
            <Button
              onClick={() => createPostMutation.mutate({
                content: createPostContent,
                socialAccountIds: createPostAccountIds,
                scheduledDate: createPostScheduledDate || undefined,
                overrideBrandAssetId: createPostBrandAssetId && createPostBrandAssetId !== "none" ? createPostBrandAssetId : undefined,
                aiPolish: createPostAiPolish,
              })}
              disabled={createPostMutation.isPending || !createPostContent.trim() || createPostAccountIds.length === 0}
              className="gap-2"
              data-testid="button-confirm-create-post"
            >
              {createPostMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : "Create Post"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showExportWarning} onOpenChange={setShowExportWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-export-warning-title">Export Review</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3" data-testid="text-export-warning-description">
                {exportPreview && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Total active posts:</span>
                      <span className="font-medium">{exportPreview.totalPosts}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Posts with valid dates:</span>
                      <span className="font-medium text-green-600">{exportPreview.datedPosts}</span>
                    </div>
                    {exportPreview.undatedPosts > 0 && (
                      <div className="flex justify-between">
                        <span>Posts without dates:</span>
                        <span className="font-medium text-amber-600">{exportPreview.undatedPosts}</span>
                      </div>
                    )}
                    {exportPreview.collisions > 0 && (
                      <div className="flex justify-between">
                        <span>Time slot collisions:</span>
                        <span className="font-medium text-amber-600">{exportPreview.collisions} (auto-staggered by 15 min)</span>
                      </div>
                    )}
                  </div>
                )}
                {csvFormat === "socialpilot" && exportPreview && exportPreview.postsWithLink > 0 && (
                  <div className="rounded-md border p-3 bg-muted/50 text-sm">
                    <p className="font-medium mb-1">Link URLs included</p>
                    <p className="text-muted-foreground">
                      {exportPreview.postsWithLink} post{exportPreview.postsWithLink !== 1 ? "s have" : " has"} a link URL attached. These are exported in a dedicated column (LinkedIn, Facebook, and X) so the link carries through to SocialPilot.
                    </p>
                  </div>
                )}
                {exportPreview && exportPreview.undatedPosts > 0 && (
                  <div className="rounded-md border p-3 bg-muted/50">
                    <p className="text-sm mb-2">
                      {exportPreview.undatedPosts} post{exportPreview.undatedPosts > 1 ? "s" : ""} {exportPreview.undatedPosts > 1 ? "have" : "has"} no scheduled date or {exportPreview.undatedPosts > 1 ? "have" : "has"} a date in the past. Undated posts can cause import failures in scheduling tools.
                    </p>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeUndated}
                        onChange={(e) => setIncludeUndated(e.target.checked)}
                        className="rounded"
                        data-testid="checkbox-include-undated"
                      />
                      Include undated posts anyway (not recommended)
                    </label>
                  </div>
                )}
                {exportPreview && exportPreview.undatedPosts > 0 && !includeUndated && (
                  <p className="text-sm text-muted-foreground">
                    Export will include only the {exportPreview.datedPosts} post{exportPreview.datedPosts !== 1 ? "s" : ""} with valid future dates.
                  </p>
                )}
                {exportPreview && exportPreview.datedPosts === 0 && !includeUndated && (
                  <p className="text-sm text-destructive font-medium">
                    No posts with valid dates to export. Use the Schedule Posts button first, or check the box above to include undated posts.
                  </p>
                )}
                <div className="rounded-md border p-3 bg-muted/50">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeExported}
                      onChange={(e) => setIncludeExported(e.target.checked)}
                      className="rounded"
                      data-testid="checkbox-include-exported"
                    />
                    Re-export posts already marked delivered
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    By default, exports skip posts you've already confirmed as delivered, so you never re-send the same ones.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-export">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowExportWarning(false); doExport(includeUndated); }}
              disabled={exportPreview !== null && exportPreview.datedPosts === 0 && !includeUndated}
              data-testid="button-export-confirm"
            >
              Export {includeUndated ? `All ${exportPreview?.totalPosts ?? 0}` : `${exportPreview?.datedPosts ?? 0} Scheduled`} Posts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeliverConfirm} onOpenChange={setShowDeliverConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-deliver-confirm-title">Did your scheduling tool accept the file?</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-deliver-confirm-description">
              The CSV with {lastExportedIds.length} post{lastExportedIds.length === 1 ? "" : "s"} downloaded. Import it into SocialPilot (or your tool) and confirm it was accepted before marking these as delivered. If the import was rejected, choose "Not yet" and they'll stay ready to export again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-deliver-not-yet">Not yet — keep them exportable</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => markDeliveredMutation.mutate(lastExportedIds)}
              disabled={markDeliveredMutation.isPending}
              data-testid="button-deliver-confirm"
            >
              {markDeliveredMutation.isPending ? "Marking…" : `Yes — mark ${lastExportedIds.length} delivered`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hub tab dialogs */}
      {id && (
        <>
          <AttachDialog open={hubAttachOpen} onOpenChange={setHubAttachOpen} scope="campaign" id={id} onDone={refreshHub} />
          <CreateActionDialog open={hubCreateOpen} onOpenChange={setHubCreateOpen} scope="campaign" id={id} onDone={refreshHub} />
        </>
      )}
    </AppLayout>
  );
}
