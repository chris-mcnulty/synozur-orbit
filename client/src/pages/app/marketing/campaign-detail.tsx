import { useState, useEffect, useRef, useMemo } from "react";
import { rollupPosts, batchSourceOf } from "@shared/social-rollup";
import { deriveBulkDeliveryScope, postPassesScopeFilters as _postPassesScopeFilters } from "@/lib/bulk-delivery-scope";
import { OptimizedThumbnail, thumbnailUrl, buildSrcSet } from "@/components/ui/optimized-thumbnail";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, useSearch } from "wouter";
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
  Send,
  FileDown,
  Globe,
  Lightbulb,
  Upload,
  CheckCircle2,
  Info,
  UserCheck,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useJobStatus, jobStatusLabel } from "@/hooks/use-job-status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { LinkBuilderTab } from "@/components/marketing/LinkBuilderTab";
import { CampaignLinkClicks } from "@/components/marketing/CampaignLinkClicks";
import {
  type HubResponse, type ItemType,
  RollupStat, HubItemsList, AttachDialog, CreateActionDialog,
  STAGE_META, STAGE_ORDER,
} from "./hub-components";
import AIRewritePanel from "@/components/marketing/AIRewritePanel";
import SocialPostEditor from "@/components/marketing/SocialPostEditor";
import { PostStageBadge } from "@/components/marketing/post-stage";
import { CampaignNextActions } from "@/components/marketing/NextActionsByBatch";
import { CAMPAIGN_TABS, type CampaignTab, tabFromHash, filterFromSearch } from "@/lib/campaign-url-helpers";
import { useDeepLinkFocus } from "@/lib/use-deep-link-focus";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  briefOnlyMode?: boolean;
  thematicUrl?: string | null;
  thematicBrief?: string | null;
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
  contentAssetId?: string | null;
  draftTitle?: string | null;
  websitePostSlug?: string | null;
  websitePostStatus?: string | null;
  websiteScheduledFor?: string | null;
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
  assetDate?: string | null;
  isExternal?: boolean;
}

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  status?: string;
  isConnected?: boolean;
}

interface GeneratedPost {
  id: string;
  platform: string;
  content: string;
  editedContent?: string;
  hashtags: string[];
  status: string;
  deliveryMode?: string | null;
  postFormat?: string | null;
  carouselSlides?: unknown[] | null;
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
  sourceBriefId?: string | null;
  campaignId?: string | null;
}

interface BrandAsset {
  id: string;
  name: string;
  fileUrl?: string;
  url?: string;
  categoryId?: string;
  categoryName?: string;
}

// A deep-link may carry a `?filter=` so a nudge (e.g. the hub's "Fix failures"
// next-action) lands on the posts tab already scoped to the exact items —
// rather than the default "active" view where failures are buried.
// tabFromHash / filterFromSearch live in @/lib/campaign-url-helpers (imported above).

function generateAccountsKey(campaignId: string) {
  return `generate-dialog-accounts-${campaignId}`;
}

function loadSavedAccountIds(campaignId: string): string[] | null {
  try {
    const raw = localStorage.getItem(generateAccountsKey(campaignId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function saveAccountIds(campaignId: string, ids: string[] | null): void {
  try {
    if (ids === null) {
      localStorage.removeItem(generateAccountsKey(campaignId));
    } else {
      localStorage.setItem(generateAccountsKey(campaignId), JSON.stringify(ids));
    }
  } catch {
    // ignore storage errors
  }
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [activeTab, setActiveTab] = useState<CampaignTab>(() => tabFromHash(window.location.hash));
  const [fsOpen, setFsOpen] = useState(false);
  // Post editing now happens in the shared SocialPostEditor dialog.
  const [sharedEditorPostId, setSharedEditorPostId] = useState<string | null>(null);
  const [imagePickerPostId, setImagePickerPostId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [brandAssetCategoryFilter, setBrandAssetCategoryFilter] = useState("all");
  const [brandAssetSearch, setBrandAssetSearch] = useState("");
  const [postFilter, setPostFilter] = useState<string>(() => filterFromSearch(window.location.search) ?? "active");
  const [postAccountFilter, setPostAccountFilter] = useState<string>("all");
  const [postPlatformFilter, setPostPlatformFilter] = useState<string>("all");
  // Lifecycle filter: pending = still editable (not yet published/exported),
  // completed = already out the door. Date range applies to scheduledDate.
  const [postTimeFilter, setPostTimeFilter] = useState<string>("all");
  const [postDateFrom, setPostDateFrom] = useState<string>("");
  const [postDateTo, setPostDateTo] = useState<string>("");

  // Shared platform/lifecycle/date-range predicate for the Social Posts tab —
  // used by the visible-post list AND "Select all visible" so bulk edits
  // operate on exactly what the user is looking at.
  // Delegates to the pure utility in @/lib/bulk-delivery-scope so the logic
  // can be unit-tested without mounting the full component.
  const postPassesScopeFilters = (p: { platform: string; status: string; publishedAt?: string; scheduledDate?: string }) =>
    _postPassesScopeFilters(p, { postPlatformFilter, postTimeFilter, postDateFrom, postDateTo });
  const [manualPostedAtMap, setManualPostedAtMap] = useState<Record<string, string>>({});
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
  const [editCampaignThematicUrl, setEditCampaignThematicUrl] = useState("");
  const [editCampaignThematicBrief, setEditCampaignThematicBrief] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [linkChildOpen, setLinkChildOpen] = useState(false);
  const [copyBriefOpen, setCopyBriefOpen] = useState(false);
  const [copyBriefId, setCopyBriefId] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState<"existing" | "new">("existing");
  const [copyTargetCampaignId, setCopyTargetCampaignId] = useState("");
  const [copyNewCampaignName, setCopyNewCampaignName] = useState("");
  const [linkChildSearch, setLinkChildSearch] = useState("");
  const [archiveWithChildrenOpen, setArchiveWithChildrenOpen] = useState(false);
  const [editCampaignAlwaysHashtags, setEditCampaignAlwaysHashtags] = useState("");
  const [editCampaignBriefOnly, setEditCampaignBriefOnly] = useState(false);
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
  const [digestDialogOpen, setDigestDialogOpen] = useState(false);
  const [digestSourceContent, setDigestSourceContent] = useState("");
  const [digestTitle, setDigestTitle] = useState("");
  const [digestSocialAccountId, setDigestSocialAccountId] = useState("");
  const [digestScrapeUrl, setDigestScrapeUrl] = useState("");
  const [digestScrapeFrom, setDigestScrapeFrom] = useState("");
  const [digestScrapeTo, setDigestScrapeTo] = useState("");
  const [digestScrapedPosts, setDigestScrapedPosts] = useState<Array<{ id: string; text: string; postedAt: string; kept: boolean }>>([]);
  const [digestScrapeLoading, setDigestScrapeLoading] = useState(false);
  const [digestScrapeError, setDigestScrapeError] = useState("");
  const [newBlogDialogOpen, setNewBlogDialogOpen] = useState(false);
  const [blogIdeaText, setBlogIdeaText] = useState("");
  const [suggestedBlogTitle, setSuggestedBlogTitle] = useState("");
  const [linkPostOpen, setLinkPostOpen] = useState(false);
  const [linkPostUrl, setLinkPostUrl] = useState("");
  const [linkPostTitle, setLinkPostTitle] = useState("");
  const [synozurSearch, setSynozurSearch] = useState("");
  const [synozurSearchTerm, setSynozurSearchTerm] = useState("");
  const [selectedBrandImageIds, setSelectedBrandImageIds] = useState<string[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  // null = all campaign accounts (no explicit selection / no pre-selection from brief)
  // []   = explicitly none selected (blocks Generate; user must pick at least one)
  // [id] = a specific subset the user / brief has targeted
  const [generateDialogAccountIds, setGenerateDialogAccountIds] = useState<string[] | null>(null);
  const [brandCategoryFilter, setBrandCategoryFilter] = useState<string>("all");
  const [brandPage, setBrandPage] = useState(0);
  const [generateMode, setGenerateMode] = useState<"asset" | "thematic" | "blog">("asset");
  const [thematicBrief, setThematicBrief] = useState("");
  const [thematicUrl, setThematicUrl] = useState("");
  const [blogAssetId, setBlogAssetId] = useState<string | null>(null);
  const [blogSearch, setBlogSearch] = useState("");
  const [blogImportUrl, setBlogImportUrl] = useState("");
  const [blogImportStatus, setBlogImportStatus] = useState<"idle" | "fetching" | "done" | "error">("idle");
  const [blogImportError, setBlogImportError] = useState("");
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  // Tracks which brief row triggered the current generation job so we can show
  // an inline spinner on that row while the job is running.
  const [generatingForBriefId, setGeneratingForBriefId] = useState<string | null>(null);
  const [wrapPostLinks, setWrapPostLinks] = useState(false);
  const [variantsPerPlatform, setVariantsPerPlatform] = useState<number | null>(null);
  const [onePostPerAsset, setOnePostPerAsset] = useState(false);
  const BRAND_PAGE_SIZE = 12;
  const [pickerCategoryFilter, setPickerCategoryFilter] = useState<string>("all");
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerTab, setPickerTab] = useState<"brand" | "content" | "upload">("brand");
  const [pickerUploadFile, setPickerUploadFile] = useState<File | null>(null);
  const [pickerUploadPreview, setPickerUploadPreview] = useState<string | null>(null);
  const [pickerUploadAlt, setPickerUploadAlt] = useState("");
  const [pickerIsUploading, setPickerIsUploading] = useState(false);
  const [pickerUploadResult, setPickerUploadResult] = useState<{ url: string; source: "website" | "local" } | null>(null);
  const [pickerUploadError, setPickerUploadError] = useState<string | null>(null);
  const pickerFileInputRef = useRef<HTMLInputElement>(null);
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
  const [bulkAssignAccountOpen, setBulkAssignAccountOpen] = useState(false);
  const [bulkAssignAccountId, setBulkAssignAccountId] = useState<string>("");

  // Brief source navigation — highlights the source brief in the Content Plan tab
  const [highlightedBriefId, setHighlightedBriefId] = useState<string | null>(null);

  // Link / unlink event state
  const [linkEventOpen, setLinkEventOpen] = useState(false);
  const [linkEventSearch, setLinkEventSearch] = useState("");
  const [unlinkEventConfirmId, setUnlinkEventConfirmId] = useState<string | null>(null);

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

  const generateDigestMutation = useMutation({
    mutationFn: async () => {
      const keptPosts = digestScrapedPosts.filter((p) => p.kept).map((p) => {
        const dateLabel = p.postedAt ? `[${new Date(p.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}] ` : "";
        return `${dateLabel}${p.text}`;
      });
      const combined = [...keptPosts, digestSourceContent.trim()].filter(Boolean).join("\n\n---\n\n");
      const r = await fetch(`/api/campaigns/${id}/generate-digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourceContent: combined,
          title: digestTitle.trim() || undefined,
          socialAccountId: digestSocialAccountId || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to generate digest");
      return r.json() as Promise<{ title: string; digestBriefId: string; newsletterBriefId: string; postId: string | null; calendarId: string }>;
    },
    onSuccess: (data) => {
      refreshHub();
      setDigestDialogOpen(false);
      setDigestSourceContent("");
      setDigestTitle("");
      setDigestSocialAccountId("");
      setDigestScrapeUrl("");
      setDigestScrapeFrom("");
      setDigestScrapeTo("");
      setDigestScrapedPosts([]);
      setDigestScrapeError("");
      const parts = ["digest article", "newsletter"];
      if (data.postId) parts.push("LinkedIn post");
      toast({ title: `"${data.title}" created`, description: `${parts.join(", ")} — all linked to this campaign.` });
    },
    onError: (e: any) => toast({ title: "Failed to generate digest", description: e.message, variant: "destructive" }),
  });

  const hubCreateBlogPostMutation = useMutation({
    mutationFn: async ({ title, writeMyself }: { title?: string; writeMyself?: boolean }) => {
      const res = await fetch("/api/planning-hub/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scope: "campaign", id, type: "content", format: "blog_post", title: title?.trim() || "New blog post" }),
      });
      if (!res.ok) throw new Error("Failed to create blog post brief");
      const brief = (await res.json()) as { type: string; id: string };
      if (writeMyself) {
        // Create a blank draft immediately (no AI) so the editor opens ready to write.
        const draftRes = await fetch(`/api/content-briefs/${brief.id}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ blank: true }),
        });
        if (!draftRes.ok) throw new Error("Brief created, but the blank draft could not be created. Open it from the Content Briefs page.");
      }
      return brief;
    },
    onSuccess: (data) => {
      refreshHub();
      setNewBlogDialogOpen(false);
      setBlogIdeaText("");
      setSuggestedBlogTitle("");
      navigate(`/app/marketing/editorial-calendar?campaignId=${id}&brief=${data.id}`);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const suggestBlogTitleMutation = useMutation({
    mutationFn: async (idea: string) => {
      const res = await fetch("/api/planning-hub/suggest-blog-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campaignId: id, idea }),
      });
      if (!res.ok) throw new Error("Failed to suggest title");
      return res.json() as Promise<{ title: string }>;
    },
    onSuccess: (data) => setSuggestedBlogTitle(data.title),
    onError: (e: any) => toast({ title: "Could not suggest title", description: e.message, variant: "destructive" }),
  });

  const { data: synozurPosts, isFetching: synozurPostsFetching } = useQuery<{ id: string; title: string; slug: string; status: string; publishedAt?: string }[]>({
    queryKey: ["/api/integrations/website/posts", synozurSearchTerm],
    queryFn: async () => {
      const q = synozurSearchTerm.trim();
      const url = q ? `/api/integrations/website/posts?q=${encodeURIComponent(q)}` : "/api/integrations/website/posts";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: linkPostOpen,
    staleTime: 30_000,
  });

  const linkPostMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/planning-hub/link-website-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          campaignId: id,
          postId: "url-only",
          postSlug: linkPostUrl.replace(/.*\//, "") || "linked-post",
          postTitle: linkPostTitle.trim(),
          postStatus: "published",
          siteUrl: null,
          url: linkPostUrl.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to link post");
      return res.json();
    },
    onSuccess: () => {
      refreshHub();
      setLinkPostOpen(false);
      setLinkPostUrl("");
      setLinkPostTitle("");
      setSynozurSearch("");
      setSynozurSearchTerm("");
      toast({ title: "Post linked", description: "The blog post has been added to this campaign." });
    },
    onError: (e: any) => toast({ title: "Failed to link", description: e.message, variant: "destructive" }),
  });

  const linkSynozurPostMutation = useMutation({
    mutationFn: async (post: { id: string; title: string; slug: string; status: string }) => {
      const siteUrl = (websiteStatus as any)?.siteUrl ?? "";
      const res = await fetch("/api/planning-hub/link-website-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          campaignId: id,
          postId: post.id,
          postSlug: post.slug,
          postTitle: post.title,
          postStatus: post.status,
          siteUrl,
        }),
      });
      if (!res.ok) throw new Error("Failed to link post");
      return res.json();
    },
    onSuccess: () => {
      refreshHub();
      setLinkPostOpen(false);
      setSynozurSearch("");
      setSynozurSearchTerm("");
      toast({ title: "Post linked", description: "The Synozur post has been added to this campaign." });
    },
    onError: (e: any) => toast({ title: "Failed to link", description: e.message, variant: "destructive" }),
  });

  const hubUpdateBlogDateMutation = useMutation({
    mutationFn: async ({ briefId, date }: { briefId: string; date: string | null }) => {
      const res = await fetch(`/api/marketing-calendar/items/content/${briefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ date: date || null }),
      });
      if (!res.ok) throw new Error("Failed to update date");
      return res.json();
    },
    onSuccess: () => refreshHub(),
    onError: (e: any) => toast({ title: "Failed to update date", description: e.message, variant: "destructive" }),
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
    // includeInactive: posts may still reference a disconnected/replaced
    // account — we need its name for filters/badges instead of a raw GUID.
    queryKey: ["/api/social-accounts", "includeInactive"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts?includeInactive=true", { credentials: "include" });
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

  // Post deep-link: ?post=<id> (always paired with #posts in the URL).
  // preReveal fires first — switching to the posts tab + clearing all filters
  // so the target card exists in the DOM.  The hook then waits 120 ms for
  // React to re-render before querying the DOM and scrolling.
  // currentSearch keeps the hook reactive to in-page URL changes (no remount).
  const [focusedPostId] = useDeepLinkFocus({
    paramName: "post",
    items: posts,
    testIdPrefix: "card-post",
    currentSearch: searchStr,
    preReveal: (post) => {
      setActiveTab("posts");
      setPostFilter("all");
      setPostAccountFilter("all");
      setBatchFilter(batchSourceOf(post) ?? null);
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
  // Count of unscheduled drafts visible under every active filter (platform,
  // lifecycle, date range, account, batch drill, and status-list).  Mirrors the
  // predicate used by _bulkFilteredIds so the button label and the actual
  // archive operation always agree.
  const unscheduledDraftCount = useMemo(() => {
    const visiblePosts = postSelectedIds.size > 0
      ? posts.filter(p => postSelectedIds.has(p.id))
      : posts.filter(p => {
          const src = batchSourceOf(p);
          const isBatched = src != null && batchKeySet.has(src);
          if (batchFilter) { if (src !== batchFilter) return false; }
          else if (isBatched) return false;
          if (postAccountFilter !== "all" && p.socialAccountId !== postAccountFilter) return false;
          if (!postPassesScopeFilters(p)) return false;
          if (postFilter === "all") return p.status !== "deleted";
          if (postFilter === "active") return p.status !== "deleted" && p.status !== "rejected" && p.status !== "archived";
          if (postFilter === "missing_image") return p.status !== "deleted" && !p.overrideImageUrl && !p.overrideBrandAssetId;
          return p.status === postFilter;
        });
    return visiblePosts.filter(p => p.status === "draft" && !p.scheduledDate).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, postSelectedIds, batchFilter, batchKeySet, postAccountFilter, postFilter, postPlatformFilter, postTimeFilter, postDateFrom, postDateTo]);
  const archivedCount = useMemo(() => posts.filter((p) => p.status === "archived").length, [posts]);
  // Progress funnel for the header summary. Buckets follow the same precedence
  // as getPostStage() so the summary and the per-post badges always agree.
  // (Rejected/archived/deleted posts are left out of the funnel.)
  const postStageCounts = useMemo(() => {
    const c = { draft: 0, needs_date: 0, orbit: 0, exported: 0, posted: 0, failed: 0, total: 0 };
    for (const p of posts) {
      if (p.status === "deleted" || p.status === "archived" || p.status === "rejected") continue;
      let key: "draft" | "needs_date" | "orbit" | "exported" | "posted" | "failed";
      if (p.publishedAt || p.status === "published") key = "posted";
      else if (p.status === "publish_failed" || p.publishError) key = "failed";
      else if (p.status === "exported" || p.status === "scheduled_external") key = "exported";
      else if (p.status === "approved") {
        if (!p.scheduledDate) key = "needs_date";
        else if (p.deliveryMode === "csv") key = "exported";
        else key = "orbit";
      } else key = "draft";
      c[key]++;
      c.total++;
    }
    return c;
  }, [posts]);
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

  const { data: websiteStatus } = useQuery<{ connected: boolean; siteUrl?: string }>({
    queryKey: ["/api/integrations/website/status"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/status", { credentials: "include" });
      return r.ok ? r.json() : { connected: false };
    },
    staleTime: 60_000,
  });

  const { data: linkedEvents = [] } = useQuery<{ id: string; name: string; status: string; startDate?: string; postCount: number }[]>({
    queryKey: [`/api/campaigns/${id}/events`],
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/events`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  // All conferences in this market — powers the "Link event" picker and orphan detection
  const { data: allConferences = [] } = useQuery<{ id: string; name: string; status: string; startDate?: string | null; campaignId?: string | null }[]>({
    queryKey: ["/api/conferences", "for-link-picker"],
    queryFn: async () => {
      const r = await fetch("/api/conferences", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  // Detect events that previously generated posts for this campaign but have since been
  // reassigned to a different campaign (or cleared). These are conferenceIds present on
  // posts for this campaign that no longer appear in linkedEvents.
  const orphanedConferences = useMemo(() => {
    if (!posts.length || !allConferences.length) return [];
    const linkedIds = new Set(linkedEvents.map((e) => e.id));
    const orphanedIds = new Set(
      posts
        .filter((p) => p.conferenceId && !linkedIds.has(p.conferenceId))
        .map((p) => p.conferenceId as string),
    );
    if (!orphanedIds.size) return [];
    return allConferences.filter((c) => orphanedIds.has(c.id));
  }, [posts, linkedEvents, allConferences]);

  const linkEventMutation = useMutation({
    mutationFn: async (conferenceId: string) => {
      const r = await fetch(`/api/conferences/${conferenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campaignId: id }),
      });
      if (!r.ok) throw new Error("Failed to link event");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/events`] });
      queryClient.invalidateQueries({ queryKey: ["/api/conferences", "for-link-picker"] });
      setLinkEventOpen(false);
      setLinkEventSearch("");
      toast({ title: "Event linked", description: "The event is now associated with this campaign." });
    },
    onError: () => toast({ title: "Error", description: "Could not link the event. Please try again.", variant: "destructive" }),
  });

  const unlinkEventMutation = useMutation({
    mutationFn: async (conferenceId: string) => {
      const r = await fetch(`/api/conferences/${conferenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campaignId: null }),
      });
      if (!r.ok) throw new Error("Failed to unlink event");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/events`] });
      queryClient.invalidateQueries({ queryKey: ["/api/conferences", "for-link-picker"] });
      setUnlinkEventConfirmId(null);
      toast({ title: "Event unlinked", description: "The event has been detached from this campaign." });
    },
    onError: () => toast({ title: "Error", description: "Could not unlink the event. Please try again.", variant: "destructive" }),
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
    enabled: linkChildOpen || copyBriefOpen,
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
    mutationFn: async (postIds: string[]) => {
      const r = await fetch(`/api/campaigns/${id}/archive-unscheduled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postIds }),
      });
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

  const copyBriefMutation = useMutation({
    mutationFn: async ({ briefId, campaignId, newCampaignName }: { briefId: string; campaignId?: string; newCampaignName?: string }) => {
      const r = await fetch(`/api/content-briefs/${briefId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(campaignId ? { campaignId } : { newCampaignName }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to copy brief");
      return r.json() as Promise<{ campaignId: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${data.campaignId}/content-plan`] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Brief copied to campaign" });
      setCopyBriefOpen(false);
      setCopyBriefId(null);
      setCopyTargetCampaignId("");
      setCopyNewCampaignName("");
      setCopyMode("existing");
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


  const importBlogMutation = useMutation({
    mutationFn: async (url: string) => {
      setBlogImportStatus("fetching");
      const extractRes = await fetch("/api/content-assets/extract", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({}));
        throw new Error((err as any).error || "Could not extract content from this URL");
      }
      const extracted = await extractRes.json();
      const createRes = await fetch("/api/content-assets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: extracted.title || url,
          description: extracted.description || "",
          url,
          content: extracted.content || "",
          aiSummary: extracted.aiSummary || null,
          leadImageUrl: extracted.leadImageUrl || null,
          extractionStatus: "extracted",
          assetType: "blog_post",
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error((err as any).error || "Could not save asset");
      }
      return createRes.json() as Promise<ContentAsset>;
    },
    onSuccess: (asset: ContentAsset) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      setBlogAssetId(asset.id);
      setBlogImportStatus("done");
      setBlogImportUrl("");
    },
    onError: (err: Error) => {
      setBlogImportStatus("error");
      setBlogImportError(err.message);
    },
  });

  const generatePostsMutation = useMutation({
    mutationFn: async ({ brandImageIds, personaIds, thematicBrief: brief, thematicUrl: url, wrapLinks, variantsPerPlatform: variants, sourceBriefId, accountIds, blogAssetId: bAssetId, onePostPerAsset: onePerAsset }: { brandImageIds?: string[]; personaIds?: string[]; thematicBrief?: string; thematicUrl?: string; wrapLinks?: boolean; variantsPerPlatform?: number | null; sourceBriefId?: string | null; accountIds?: string[] | null; blogAssetId?: string; onePostPerAsset?: boolean }) => {
      const r = await fetch(`/api/campaigns/${id}/generate-posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandImageIds: brandImageIds || [], personaIds: personaIds || [], thematicBrief: brief || "", thematicUrl: url || "", wrapLinks: !!wrapLinks, variantsPerPlatform: variants ?? null, includeAssetLeadImages: false, sourceBriefId: sourceBriefId ?? null, accountIds: accountIds ?? [], blogAssetId: bAssetId || "", onePostPerAsset: !!onePerAsset }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (_data, vars) => {
      // If the generation was triggered from a brief row, keep track of which
      // brief so we can show an inline spinner until the job completes.
      setGeneratingForBriefId(vars.sourceBriefId ?? null);
      saveAccountIds(id, generateDialogAccountIds);
      setGenerateDialogOpen(false);
      setSelectedBrandImageIds([]);
      setSelectedPersonaIds([]);
      setGenerateDialogAccountIds(null);
      setThematicBrief("");
      setThematicUrl("");
      setBlogAssetId(null);
      setBlogSearch("");
      setBlogImportUrl("");
      setBlogImportStatus("idle");
      setBlogImportError("");
      setGenerateMode("asset");
      setSelectedBriefId(null);
      setVariantsPerPlatform(null);
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generate-posts-status`] });
      toast({ title: "Post generation started", description: "Social post drafts will appear in the Posts tab below once generation is complete." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updatePostMutation = useMutation({
    mutationFn: async ({ postId, editedContent, status, overrideImageUrl, overrideBrandAssetId, hashtags, linkUrl, linkLabel, socialAccountId }: {
      postId: string; editedContent?: string; status?: string;
      overrideImageUrl?: string | null; overrideBrandAssetId?: string | null; hashtags?: string[];
      linkUrl?: string | null; linkLabel?: string | null; socialAccountId?: string | null;
    }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ editedContent, status, overrideImageUrl, overrideBrandAssetId, hashtags, linkUrl, linkLabel, socialAccountId }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id, "next-actions"] });
      if (vars.status === "rejected") toast({ title: "Post rejected and removed" });
      else if (vars.status === "approved") toast({ title: "Post approved" });
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
    mutationFn: async ({ status, postIds }: { status: string; postIds?: string[] }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/bulk-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, postIds: postIds ?? [] }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id, "next-actions"] });
      setPostSelectedIds(new Set());
      toast({ title: `${data.updated} post${data.updated !== 1 ? "s" : ""} ${vars.status === "approved" ? "approved" : "rejected"}` });
    },
  });

  const bulkAssignAccountMutation = useMutation({
    mutationFn: async ({ socialAccountId, postIds }: { socialAccountId: string | null; postIds?: string[] }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/bulk-assign-account`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialAccountId, postIds: postIds ?? [] }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      setBulkAssignAccountOpen(false);
      setBulkAssignAccountId("");
      setPostSelectedIds(new Set());
      toast({ title: `Account assigned to ${data.updated} post${data.updated !== 1 ? "s" : ""}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to assign account", description: err.message, variant: "destructive" });
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
    mutationFn: async (data: { name: string; description?: string; campaignType?: string; objective?: string | null; goal?: string | null; startDate?: string | null; endDate?: string | null; numberOfDays?: number | null; includeSaturday?: boolean; includeSunday?: boolean; briefOnlyMode?: boolean; alwaysHashtags?: string[]; thematicUrl?: string | null; thematicBrief?: string | null }) => {
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

  const refreshSignalsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/campaigns/${id}/refresh-founding-signals`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to refresh signals");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({ title: "Founding signals refreshed", description: "Pulled from the latest intelligence briefing." });
    },
    onError: (err: Error) => toast({ title: "Error refreshing signals", description: err.message, variant: "destructive" }),
  });

  const removeSignalMutation = useMutation({
    mutationFn: async (body: { removeNewsIndex?: number; removeActionIndex?: number; removeIdeaIndex?: number }) => {
      const r = await fetch(`/api/campaigns/${id}/founding-signals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to remove signal");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] }),
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
    setEditCampaignBriefOnly(campaign.briefOnlyMode || false);
    setEditCampaignThematicUrl(campaign.thematicUrl || "");
    setEditCampaignThematicBrief(campaign.thematicBrief || "");
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
      briefOnlyMode: editCampaignBriefOnly,
      alwaysHashtags,
      thematicUrl: editCampaignThematicUrl.trim() || null,
      thematicBrief: editCampaignThematicBrief.trim() || null,
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
  const [scheduleSkipScheduled, setScheduleSkipScheduled] = useState(true);

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
      if (!campaign?.startDate) throw new Error("Campaign has no start date configured");
      const effectiveDays = campaign.numberOfDays ?? (campaign.endDate ? Math.max(1, Math.round((new Date(campaign.endDate).getTime() - new Date(campaign.startDate).getTime()) / 86400000) + 1) : null);
      if (!effectiveDays) throw new Error("Campaign has no duration configured — set an end date or number of days");
      const platformSet = new Set(platforms);
      // Only the chosen platforms get distributed; everything else is left as-is
      // (and optionally archived afterward as "leftovers").
      // When scheduleSkipScheduled is true, skip posts that already have a date
      // so that scheduling one platform doesn't overwrite another's dates.
      const activePosts = posts.filter(p =>
        p.status !== "deleted" &&
        p.status !== "rejected" &&
        platformSet.has(p.platform) &&
        (!scheduleSkipScheduled || !p.scheduledDate)
      );
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
      const origEnd = addDays(campaignStart, effectiveDays - 1);
      const effectiveEnd = origEnd < localToday ? addDays(localToday, effectiveDays - 1) : origEnd;

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

  // Date / external are asset-level; editing them here PATCHes the shared
  // content asset so the value matches the Content Library.
  const updateAssetMetaMutation = useMutation({
    mutationFn: async ({ assetId, assetDate, isExternal }: { assetId: string; assetDate?: string | null; isExternal?: boolean }) => {
      const r = await fetch(`/api/content-assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(assetDate !== undefined ? { assetDate: assetDate ? new Date(assetDate).toISOString() : null } : {}),
          ...(isExternal !== undefined ? { isExternal } : {}),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to update asset");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] }),
    onError: (e: any) => toast({ title: "Couldn't update asset", description: e.message, variant: "destructive" }),
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

  const setDeliveryModeMutation = useMutation({
    mutationFn: async ({ postId, deliveryMode }: { postId: string; deliveryMode: string | null }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deliveryMode }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to update delivery mode");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] }),
    onError: (err: Error) => toast({ title: "Delivery mode update failed", description: err.message, variant: "destructive" }),
  });

  const bulkDeliveryModeMutation = useMutation({
    mutationFn: async ({ deliveryMode, postIds }: { deliveryMode: string | null; postIds?: string[] }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/bulk-delivery-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deliveryMode, postIds: postIds ?? [] }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      return r.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      setPostSelectedIds(new Set());
      toast({ title: `${data.updated} post${data.updated !== 1 ? "s" : ""} ${vars.deliveryMode === "csv" ? "reserved for CSV only" : "returned to Orbit scheduling"}` });
    },
    onError: (err: Error) => toast({ title: "Bulk delivery mode failed", description: err.message, variant: "destructive" }),
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
    mutationFn: async ({ postId, publishedAt }: { postId: string; publishedAt?: string }) => {
      const r = await fetch(`/api/campaigns/${id}/generated-posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "published", ...(publishedAt ? { publishedAt } : {}) }),
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
  const [exportPreview, setExportPreview] = useState<{ totalPosts: number; orbitCount: number; datedPosts: number; undatedPosts: number; collisions: number; postsWithLink: number } | null>(null);
  // After a download, we confirm the scheduling tool accepted the file before
  // marking anything delivered. These hold the ids that were in the last CSV.
  // Persisted to sessionStorage so a page refresh doesn't strand them.
  const SESSION_KEY = `orbit-exported-ids-${id}`;
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);
  const [lastExportedIds, setLastExportedIds] = useState<string[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]"); } catch { return []; }
  });
  const persistExportedIds = (ids: string[]) => {
    setLastExportedIds(ids);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(ids)); } catch {}
  };
  const clearExportedIds = () => {
    setLastExportedIds([]);
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  };

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
        persistExportedIds(exportedIds);
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
      clearExportedIds();
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/generated-posts`] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns", id, "next-actions"] });
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
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onHashChange = () => setActiveTab(tabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // Reset post-tab state to clean defaults when the campaign changes.
    // When ?post= is present the useDeepLinkFocus preReveal callback will set
    // the correct filter/batch state — don't clobber those values here.
    // (React batches all effects from one commit, and this effect is registered
    // after the hook, so it runs last; without the guard it would overwrite
    // the preReveal state before the delayed scroll can fire.)
    const focusPostId = new URLSearchParams(searchStr).get("post");
    setActiveTab(tabFromHash(window.location.hash));
    if (!focusPostId) {
      setPostFilter(filterFromSearch(window.location.search) ?? "active");
      setPostAccountFilter("all");
      setBatchFilter(null);
    }
  }, [id, searchStr]);

  useEffect(() => {
    const prev = prevJobStatus.current;
    const curr = jobStatus?.status;
    if ((prev === "running" || prev === "pending") && (curr === "completed" || curr === "failed")) {
      // Clear the brief-row spinner now that the job has finished.
      setGeneratingForBriefId(null);
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

  // Pre-populate the generate dialog from a content brief row and open it in
  // thematic mode so the user lands with the brief context already loaded.
  const briefChannelMatchesPlatform = (channel: string, platform: string): boolean => {
    const ch = channel.toLowerCase().replace(/_post$/, "");
    const pl = platform.toLowerCase();
    if (ch === pl) return true;
    if ((ch === "x" || ch === "twitter") && (pl === "x" || pl === "twitter")) return true;
    return false;
  };

  const openGenerateFromBrief = (brief: ContentBrief) => {
    const parts: string[] = [`Brief: ${brief.title}`];
    if (brief.summary) parts.push(`Summary: ${brief.summary}`);
    if (brief.demandSignal) parts.push(`Why this matters: ${brief.demandSignal}`);
    if (brief.differentiationAngle) parts.push(`Our angle: ${brief.differentiationAngle}`);
    if (brief.targetReader) parts.push(`Audience: ${brief.targetReader}`);
    if (brief.cta) parts.push(`Call to action: ${brief.cta}`);
    if (brief.ideaSignals?.length) parts.push(`News hooks / signals:\n${brief.ideaSignals.map(s => `- ${s}`).join("\n")}`);
    setThematicBrief(parts.join("\n\n"));
    setSelectedBriefId(brief.id);
    setGenerateMode("thematic");
    setSelectedBrandImageIds([]);
    setBrandCategoryFilter("all");
    setBrandPage(0);
    setVariantsPerPlatform(null);
    setWrapPostLinks(false);
    // Pre-select social accounts whose platform matches the brief's channels.
    //   matched accounts found  → pre-select exactly those accounts
    //   channels set, no match  → [] (no pre-selection; Generate disabled until user picks)
    //   no channels on brief    → saved preference (falls back to null if none saved)
    if (brief.channels && brief.channels.length > 0) {
      const matched = (campaign?.socialAccounts ?? [])
        .filter(csa => {
          const account = allSocialAccounts.find(a => a.id === csa.socialAccountId);
          if (!account) return false;
          return brief.channels!.some(ch => briefChannelMatchesPlatform(ch, account.platform ?? ""));
        })
        .map(csa => csa.socialAccountId);
      // If no accounts matched, leave as [] so the user is prompted to pick rather
      // than silently generating for all accounts on an unintended platform.
      setGenerateDialogAccountIds(matched);
    } else {
      setGenerateDialogAccountIds(loadSavedAccountIds(id));
    }
    setGenerateDialogOpen(true);
  };

  // Navigate to the Content Plan tab and briefly highlight the source brief.
  const navigateToBrief = (briefId: string) => {
    setActiveTab("plan");
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "#plan");
    setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    setHighlightedBriefId(briefId);
    setTimeout(() => setHighlightedBriefId(null), 2500);
  };

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

  // Returns the featured/lead image URL for the article that sourced a post,
  // if one is available in the content library. Used to offer "Use article image"
  // as an alternative to generating a branded graphic.
  const getArticleLeadImage = (post: GeneratedPost): string | null => {
    if (post.sourceUrl) {
      const matched = allAssets.find(a => a.url === post.sourceUrl && a.leadImageUrl);
      if (matched?.leadImageUrl) return matched.leadImageUrl;
    }
    for (const ca of campaign?.assets || []) {
      const asset = allAssets.find(a => a.id === ca.assetId && a.leadImageUrl);
      if (asset?.leadImageUrl) return asset.leadImageUrl;
    }
    return null;
  };

  // Campaign-level article lead image: the first campaign-linked asset with a
  // leadImageUrl. Used to power "Use article image" in bulk controls.
  const campaignArticleLeadImage = (() => {
    for (const ca of campaign?.assets || []) {
      const asset = allAssets.find(a => a.id === ca.assetId && a.leadImageUrl);
      if (asset?.leadImageUrl) return asset.leadImageUrl;
    }
    return null;
  })();

  // Sequentially generates a photo + overlay composite (option 3) for every
  // post in postIds by calling generate-image with the article photo as the
  // background. Updates the shared progress counters as it goes.
  const applyArticleImageBatch = async (
    postIds: string[],
    imageUrl: string,
    setTotal: (n: number) => void,
    setProgress: (n: number) => void,
  ) => {
    setTotal(postIds.length);
    setProgress(0);
    for (let i = 0; i < postIds.length; i++) {
      await generateGraphic(postIds[i], imageUrl);
      setProgress(i + 1);
    }
    setTotal(0);
    setProgress(0);
    toast({ title: `Photo + overlay applied to ${postIds.length} post${postIds.length === 1 ? "" : "s"}` });
  };


  const campaignBreadcrumbs = [
    { label: "Marketing", href: "/app/marketing" },
    { label: "Campaigns", href: "/app/marketing/campaigns" },
    { label: campaign?.name || "Loading..." },
  ];

  // Generate a graphic for a single post. Component-scoped so both the Review
  // tab and the image-picker dialog can call it (the picker is rendered outside
  // the Review tab's render block).
  // backgroundUrl — when provided, the server uses this photo as the background
  // and composites the text + logo on top (option 3: photo + overlay).
  // When omitted the server generates a chromatic background (option 4).
  const generateGraphic = async (postId: string, backgroundUrl?: string) => {
    setRvGeneratingIds(prev => new Set(prev).add(postId));
    try {
      const r = await fetch(`/api/generated-posts/${postId}/generate-image`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backgroundUrl ? { backgroundUrl } : {}),
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
        <div className="p-6 flex flex-col items-center gap-4 text-center text-muted-foreground">
          <p>Campaign not found.</p>
          <div className="flex gap-2 flex-wrap justify-center">
            <a href="/app/marketing/pipeline" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">← Back to Content Pipeline</a>
            <span className="text-muted-foreground/40">·</span>
            <a href="/app/marketing/campaigns" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">All Campaigns</a>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Effective scope for the bulk Orbit / CSV delivery-mode buttons and the
  // Approve All / Reject All actions.
  // • If posts are individually selected, use exactly those.
  // • Otherwise, use every post that matches the current filters
  //   (same predicate as "Select all visible") so the buttons act on
  //   what the user can see — not silently on the whole campaign.
  // Delegates to the pure utility in @/lib/bulk-delivery-scope (unit-tested).
  const bulkDeliveryScope: string[] = deriveBulkDeliveryScope(posts, postSelectedIds, {
    postFilter,
    postAccountFilter,
    postPlatformFilter,
    postTimeFilter,
    postDateFrom,
    postDateTo,
    batchFilter,
    batchKeySet,
  });
  // Alias used by Approve All / Reject All sub-filters below.
  const _bulkFilteredIds = bulkDeliveryScope;

  // Approve All / Reject All are also scoped to the filtered-visible posts
  // (or selected posts when a selection is active), not the whole campaign.
  const _postById = new Map(posts.map(p => [p.id, p]));
  const bulkApproveIds = _bulkFilteredIds.filter(id => {
    const p = _postById.get(id);
    return p && !["approved", "exported", "scheduled_external", "published", "publish_failed", "rejected", "deleted"].includes(p.status);
  });
  const bulkRejectIds = _bulkFilteredIds.filter(id => {
    const p = _postById.get(id);
    return p && p.status !== "rejected" && p.status !== "deleted";
  });
  // Archive unscheduled: scoped to the same filtered-visible set as every
  // other bulk action (account, batch-drill, status-list, scope filters), then
  // narrowed to only draft posts without a scheduled date.
  const bulkArchiveIds = _bulkFilteredIds.filter(id => {
    const p = _postById.get(id);
    return p && p.status === "draft" && !p.scheduledDate;
  });

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

        {/* Conference origin banner — shown when this campaign was auto-created from one or more events */}
        {linkedEvents.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/40 rounded-lg border text-sm" data-testid="campaign-conference-origin-banner">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              {linkedEvents.length === 1
                ? "Linked event:"
                : "Linked events:"}
            </span>
            {linkedEvents.map((ev) => (
              <span key={ev.id} className="inline-flex items-center gap-1.5">
                <a
                  href={`/app/marketing/conferences/${ev.id}`}
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  data-testid={`link-conference-origin-${ev.id}`}
                >
                  {ev.name}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-muted-foreground hover:text-destructive gap-1"
                  onClick={() => setUnlinkEventConfirmId(ev.id)}
                  data-testid={`button-unlink-event-banner-${ev.id}`}
                >
                  <Unlink className="w-3 h-3" />
                  Unlink
                </Button>
              </span>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="How event linking works"
                  data-testid="button-event-link-info"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="max-w-xs text-sm space-y-1.5">
                <p className="font-medium">Link controlled by the event</p>
                <p className="text-muted-foreground">
                  This campaign association is set on the event side via the{" "}
                  <span className="font-medium text-foreground">Parent Campaign</span> field. If the
                  event is reassigned to a different campaign (or cleared), it will no longer appear
                  here.
                </p>
                <p className="text-muted-foreground">
                  To change the assignment, open the event's detail page and click{" "}
                  <span className="font-medium text-foreground">Edit event → Parent Campaign</span>.
                </p>
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border text-sm" data-testid="campaign-no-event-banner">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">No event linked to this campaign.</span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 ml-auto"
              onClick={() => setLinkEventOpen(true)}
              data-testid="button-link-event-banner"
            >
              <Link2 className="w-3.5 h-3.5" />
              Link event
            </Button>
          </div>
        )}

        {/* Orphaned-event warning — shown when one or more events that generated posts for this
            campaign have since been reassigned to a different campaign (or cleared entirely).
            The posts remain here, but the event no longer appears in linkedEvents. */}
        {orphanedConferences.length > 0 && (
          <div
            className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm"
            data-testid="campaign-orphaned-event-warning"
          >
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {orphanedConferences.length === 1
                  ? "An event was reassigned away from this campaign"
                  : `${orphanedConferences.length} events were reassigned away from this campaign`}
              </p>
              <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                {orphanedConferences.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <a
                      href={`/app/marketing/conferences/${c.id}`}
                      className="font-medium underline underline-offset-2 hover:no-underline"
                      data-testid={`link-orphaned-conference-${c.id}`}
                    >
                      {c.name}
                    </a>
                  </span>
                ))}{" "}
                {orphanedConferences.length === 1 ? "is" : "are"} no longer linked here. Posts
                generated for this campaign from{" "}
                {orphanedConferences.length === 1 ? "that event" : "those events"} still exist but
                the event's <span className="font-medium">Parent Campaign</span> field now points
                elsewhere. To restore the link, open the event and change{" "}
                <span className="font-medium">Edit event → Parent Campaign</span> back to this
                campaign.
              </p>
            </div>
          </div>
        )}

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

        {/* Post progress — where this campaign's posts stand right now.
            Each cell jumps to the Social Posts tab filtered to that state. */}
        {postStageCounts.total > 0 && (() => {
          const goToPosts = (filter: string) => {
            setPostFilter(filter);
            setActiveTab("posts");
            window.history.replaceState(null, "", window.location.pathname + window.location.search + "#posts");
            setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
          };
          const cells = [
            { key: "draft", label: "Draft", n: postStageCounts.draft, color: "bg-gray-400", filter: "draft" },
            { key: "needs_date", label: "Needs a date", n: postStageCounts.needs_date, color: "bg-amber-500", filter: "approved" },
            { key: "orbit", label: "Orbit-scheduled", n: postStageCounts.orbit, color: "bg-emerald-500", filter: "approved", zap: true },
            { key: "exported", label: "Exported", n: postStageCounts.exported, color: "bg-blue-500", filter: "exported" },
            { key: "posted", label: "Posted", n: postStageCounts.posted, color: "bg-green-500", filter: "published" },
            { key: "failed", label: "Failed", n: postStageCounts.failed, color: "bg-red-500", filter: "publish_failed", alert: true },
          ];
          const total = postStageCounts.total;
          const delivered = postStageCounts.posted + postStageCounts.exported;
          return (
            <div className="rounded-lg border bg-card p-4" data-testid="campaign-progress-summary">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                  Post progress
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">{delivered} of {total} delivered</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted mb-3" role="img" aria-label={`${delivered} of ${total} posts delivered`}>
                {cells.filter((c) => c.n > 0).map((c) => (
                  <div key={c.key} className={c.color} style={{ width: `${(c.n / total) * 100}%` }} />
                ))}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-px rounded-md overflow-hidden border bg-border">
                {cells.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => goToPosts(c.filter)}
                    disabled={c.n === 0}
                    className="bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50 disabled:cursor-default disabled:hover:bg-card"
                    data-testid={`progress-cell-${c.key}`}
                  >
                    <div className={`text-xl font-bold tabular-nums ${c.alert && c.n > 0 ? "text-destructive" : ""}`}>{c.n}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${c.color}`} />
                      <span className="truncate">{c.label}</span>
                      {c.zap && <Zap className="w-2.5 h-2.5 text-emerald-500 shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        <CampaignNextActions
          campaignId={id}
          onNavigate={(tab, filter) => {
            if (filter) setPostFilter(filter);
            setActiveTab(tab as CampaignTab);
            window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + tab);
            setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
          }}
        />

        <div ref={tabsRef} />
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
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  className="gap-2"
                  data-testid="button-linkedin-digest"
                  onClick={() => {
                    setDigestDialogOpen(true);
                  }}
                >
                  <Newspaper className="w-4 h-4" />
                  LinkedIn Digest
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  data-testid="button-new-blog-post"
                  onClick={() => { setBlogIdeaText(""); setSuggestedBlogTitle(""); setNewBlogDialogOpen(true); }}
                >
                  <Plus className="w-4 h-4" />
                  New Blog Post
                </Button>
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
                    <div className="flex items-center gap-2">
                      <button
                        className="flex items-center justify-between flex-1 gap-2 text-left"
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
                      <button
                        className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors p-0.5"
                        title="Refresh from latest intelligence briefing"
                        onClick={e => { e.stopPropagation(); refreshSignalsMutation.mutate(); }}
                        disabled={refreshSignalsMutation.isPending}
                        data-testid="button-refresh-founding-signals"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshSignalsMutation.isPending ? "animate-spin" : ""}`} />
                      </button>
                    </div>
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
                                  <li key={i} className="text-sm group flex items-start gap-1.5" data-testid={`founding-news-${i}`}>
                                    <div className="flex-1 min-w-0">
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
                                    </div>
                                    <button
                                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity mt-0.5"
                                      title="Remove this signal"
                                      onClick={() => removeSignalMutation.mutate({ removeNewsIndex: i })}
                                      data-testid={`remove-news-${i}`}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
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
                                  <li key={i} className="text-sm group flex items-start gap-1.5" data-testid={`founding-action-${i}`}>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <Badge variant="secondary" className="text-[10px] capitalize">{a.urgency.replace(/_/g, " ")}</Badge>
                                        <span className="font-medium">{a.title}</span>
                                      </div>
                                      {a.description && <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{a.description}</p>}
                                    </div>
                                    <button
                                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity mt-0.5"
                                      title="Remove this signal"
                                      onClick={() => removeSignalMutation.mutate({ removeActionIndex: i })}
                                      data-testid={`remove-action-${i}`}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(fs!.ideaSignals?.length ?? 0) > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Founding Notes</h4>
                              <ul className="space-y-1">
                                {fs!.ideaSignals!.map((s, i) => (
                                  <li key={i} className="text-sm text-muted-foreground group flex items-start gap-1.5" data-testid={`founding-signal-${i}`}>
                                    <span className="flex-1">· {s}</span>
                                    <button
                                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                                      title="Remove this signal"
                                      onClick={() => removeSignalMutation.mutate({ removeIdeaIndex: i })}
                                      data-testid={`remove-idea-${i}`}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </li>
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
                  <Card
                    key={b.id}
                    data-testid={`brief-${b.id}`}
                    className={highlightedBriefId === b.id ? "ring-2 ring-primary transition-shadow" : ""}
                  >
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                            <Lightbulb className="h-3.5 w-3.5" />
                            Plan
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{b.title}</span>
                            <Badge variant="outline" className="text-xs">{BRIEF_FORMAT_LABELS[b.format] ?? b.format}</Badge>
                            <Badge variant={FUNNEL_BADGE_VARIANT[b.funnelStage] ?? "secondary"} className="text-xs capitalize">{b.funnelStage}</Badge>
                            <Badge variant="secondary" className="text-xs capitalize">{b.status}</Badge>
                            {b.format === "blog_post" && b.websitePostSlug && websiteStatus?.siteUrl && (
                              <a
                                href={`${websiteStatus.siteUrl}/insights/${b.websitePostSlug}?utm_source=orbit&utm_medium=blog`}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`link-brief-website-${b.id}`}
                              >
                                <Badge variant="outline" className="text-xs gap-1 text-violet-600 border-violet-300 hover:bg-violet-50">
                                  <Globe className="h-3 w-3" />
                                  {b.websitePostStatus === "published" ? "Live" : b.websitePostStatus === "scheduled" ? "Scheduled" : "Draft"} on website
                                </Badge>
                              </a>
                            )}
                            {(b.contentAssetId || b.draftTitle) ? (
                              <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-300" data-testid={`badge-brief-has-draft-${b.id}`}>
                                <FileText className="h-3 w-3" />
                                {b.draftTitle ? b.draftTitle : "Has draft"}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid={`badge-brief-no-draft-${b.id}`}>
                                <FileText className="h-3 w-3" />
                                No draft yet
                              </Badge>
                            )}
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
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          {/* Generate social posts directly from this brief — opens the
                              generate dialog pre-populated with the brief's context so the
                              user never has to leave the campaign page. */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => openGenerateFromBrief(b)}
                            disabled={isGenerating}
                            title="Generate social posts grounded in this brief"
                            data-testid={`button-gen-posts-brief-${b.id}`}
                          >
                            {isGenerating && generatingForBriefId === b.id ? (
                              <><Loader2 className="w-3 h-3 animate-spin" />Generating…</>
                            ) : (
                              <><Share2 className="w-3 h-3" />Generate posts</>
                            )}
                          </Button>
                          {contentPlan?.calendar && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => navigate(`/app/marketing/editorial-calendar?campaignId=${id}`)}
                              data-testid={`button-open-brief-${b.id}`}
                            >
                              Open in Content Calendar <ExternalLink className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={() => { setCopyBriefId(b.id); setCopyBriefOpen(true); }}
                            title="Copy this brief to another campaign"
                            data-testid={`button-copy-brief-${b.id}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
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

            <div className="space-y-2 pt-2" data-testid="campaign-events">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Calendar className="w-4 h-4" />Events</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setLinkEventOpen(true)}
                  data-testid="button-link-event-overview"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Link event
                </Button>
              </div>
              {linkedEvents.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">No events linked to this campaign yet.</p>
              )}
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
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setUnlinkEventConfirmId(ev.id)}
                        data-testid={`button-unlink-event-${ev.id}`}
                      >
                        <Unlink className="w-3.5 h-3.5" />
                        Unlink
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/app/marketing/conferences/${ev.id}`)} data-testid={`button-open-event-${ev.id}`}>
                        Open event <ExternalLink className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="links" className="space-y-4">
            <CampaignLinkClicks campaignId={id!} />
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
                  excludeBlogPostsFromContent
                />

                {/* Blog Posts section — dedicated list of blog_post format briefs */}
                {(() => {
                  const blogItems = hub.items.filter(
                    (it) => it.type === "content" && it.format === "blog_post",
                  );
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold flex items-center gap-1.5">
                            <Newspaper className="w-3.5 h-3.5" /> Blog Posts
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            Content briefs of format blog post linked to this campaign.
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => setLinkPostOpen(true)}
                            data-testid="button-hub-link-post"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            Link existing
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={hubCreateBlogPostMutation.isPending}
                            onClick={() => hubCreateBlogPostMutation.mutate({})}
                            data-testid="button-hub-new-blog-post"
                          >
                            {hubCreateBlogPostMutation.isPending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Plus className="w-3.5 h-3.5" />
                            )}
                            New Blog Post
                          </Button>
                        </div>
                      </div>
                      {blogItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2" data-testid="text-hub-no-blog-posts">
                          No blog posts yet. Click "New Blog Post" to draft one scoped to this campaign.
                        </p>
                      ) : (
                        <div className="space-y-2" data-testid="list-hub-blog-posts">
                          {blogItems.map((it) => {
                            const stageCls = STAGE_META[it.stage]?.className ?? "bg-muted text-muted-foreground";
                            const stageLabel = STAGE_META[it.stage]?.label ?? it.stage;
                            const href = it.campaignId
                              ? `/app/marketing/editorial-calendar?campaignId=${it.campaignId}&brief=${it.id}`
                              : `/app/marketing/editorial-calendar?brief=${it.id}`;
                            return (
                              <div
                                key={it.id}
                                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
                                data-testid={`row-hub-blog-post-${it.id}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Newspaper className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                                  <span className="text-sm font-medium truncate">{it.title || "(untitled)"}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Input
                                    type="date"
                                    className="h-6 w-[130px] text-xs px-1.5 py-0"
                                    value={it.date ? format(new Date(it.date), "yyyy-MM-dd") : ""}
                                    onChange={(e) =>
                                      hubUpdateBlogDateMutation.mutate({ briefId: it.id, date: e.target.value || null })
                                    }
                                    data-testid={`input-blog-date-${it.id}`}
                                  />
                                  <Badge className={`text-[10px] px-1.5 py-0 ${stageCls}`} data-testid={`badge-blog-stage-${it.id}`}>
                                    {stageLabel}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs gap-1"
                                    onClick={(e) => { e.preventDefault(); navigate(href); }}
                                    data-testid={`button-open-blog-brief-${it.id}`}
                                  >
                                    Open
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : null}
          </TabsContent>

          {/* Social Posts */}
          <TabsContent value="posts" className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={() => { setGenerateDialogAccountIds(loadSavedAccountIds(id)); setGenerateMode(campaign && campaign.assets.length > 0 ? "asset" : "thematic"); setGenerateDialogOpen(true); }}
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
              {posts.filter(p => !["exported", "scheduled_external", "published", "posted", "delivered"].includes(p.status)).length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const count = posts.filter(p => !["exported", "scheduled_external", "published", "posted", "delivered"].includes(p.status)).length;
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
              {posts.length > 0 && campaign?.startDate && (campaign?.numberOfDays || campaign?.endDate) && (() => {
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
                      if (postAccountFilter !== "all" && p.socialAccountId !== postAccountFilter) return false;
                      if (!postPassesScopeFilters(p)) return false;
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
                      const withExisting = ids.filter(pid => {
                        const p = posts.find(x => x.id === pid);
                        return p && (p.overrideImageUrl || p.overrideBrandAssetId);
                      });
                      if (withExisting.length > 0) {
                        const ok = window.confirm(`${withExisting.length} of the selected posts already have an image. Generating graphics will replace them. Continue?`);
                        if (!ok) return;
                      }
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
                {postSelectedIds.size > 0 && campaignArticleLeadImage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={postBulkTotal > 0}
                    onClick={() => applyArticleImageBatch(Array.from(postSelectedIds), campaignArticleLeadImage, setPostBulkTotal, setPostBulkProgress)}
                    data-testid="button-posts-bulk-use-article-image"
                  >
                    {postBulkTotal > 0 ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />{postBulkProgress}/{postBulkTotal}</>
                    ) : (
                      <><ImageLucide className="w-3.5 h-3.5" />Use article images</>
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
                {postSelectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setBulkAssignAccountOpen(true)}
                    data-testid="button-posts-bulk-assign-account"
                  >
                    <UserCheck className="w-3.5 h-3.5" />Assign account
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
                {(() => {
                  const accountIdsWithPosts = [...new Set(posts.filter(p => p.socialAccountId).map(p => p.socialAccountId!))];
                  if (accountIdsWithPosts.length < 2) return null;
                  return (
                    <Select value={postAccountFilter} onValueChange={setPostAccountFilter}>
                      <SelectTrigger className="w-44" data-testid="select-post-account-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All accounts</SelectItem>
                        {accountIdsWithPosts.map(aid => {
                          const acct = allSocialAccounts.find(a => a.id === aid);
                          // Same name can appear twice after an account is
                          // recreated — tag non-active rows so they're
                          // distinguishable from the live connection.
                          const suffix = acct && acct.status !== "active" ? " (disconnected)" : "";
                          return (
                            <SelectItem key={aid} value={aid}>
                              {acct ? `${acct.accountName ?? aid}${suffix}` : `${aid.slice(0, 8)}… (removed account)`}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  );
                })()}
                {(() => {
                  const platformsWithPosts = [...new Set(posts.filter(p => p.status !== "deleted").map(p => p.platform))].sort();
                  if (platformsWithPosts.length < 2) return null;
                  return (
                    <Select value={postPlatformFilter} onValueChange={setPostPlatformFilter}>
                      <SelectTrigger className="w-36" data-testid="select-post-platform-filter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All platforms</SelectItem>
                        {platformsWithPosts.map(pl => (
                          <SelectItem key={pl} value={pl}>{pl.charAt(0).toUpperCase() + pl.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
                <Select value={postTimeFilter} onValueChange={setPostTimeFilter}>
                  <SelectTrigger className="w-36" data-testid="select-post-time-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any stage</SelectItem>
                    <SelectItem value="pending">Pending / upcoming</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Input
                    type="date"
                    value={postDateFrom}
                    onChange={e => setPostDateFrom(e.target.value)}
                    className="h-9 w-36 text-xs"
                    title="Scheduled on or after"
                    data-testid="input-post-date-from"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    type="date"
                    value={postDateTo}
                    onChange={e => setPostDateTo(e.target.value)}
                    className="h-9 w-36 text-xs"
                    title="Scheduled on or before"
                    data-testid="input-post-date-to"
                  />
                  {(postDateFrom || postDateTo || postPlatformFilter !== "all" || postTimeFilter !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => { setPostDateFrom(""); setPostDateTo(""); setPostPlatformFilter("all"); setPostTimeFilter("all"); }}
                      data-testid="button-clear-post-scope-filters"
                    >
                      <X className="w-3 h-3 mr-0.5" />Clear
                    </Button>
                  )}
                </div>
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
                    onClick={() => archiveUnscheduledMutation.mutate(bulkArchiveIds)}
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
                {bulkApproveIds.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-green-600 border-green-200 hover:bg-green-50"
                    onClick={() => bulkStatusMutation.mutate({ status: "approved", postIds: bulkApproveIds })}
                    disabled={bulkStatusMutation.isPending}
                    data-testid="button-approve-all"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {`Approve (${bulkApproveIds.length})`}
                  </Button>
                )}
                {bulkRejectIds.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
                    onClick={() => bulkStatusMutation.mutate({ status: "rejected", postIds: bulkRejectIds })}
                    disabled={bulkStatusMutation.isPending}
                    data-testid="button-reject-all"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {`Reject (${bulkRejectIds.length})`}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                  onClick={() => bulkDeliveryModeMutation.mutate({ deliveryMode: null, postIds: bulkDeliveryScope })}
                  disabled={bulkDeliveryModeMutation.isPending || bulkDeliveryScope.length === 0}
                  title={bulkDeliveryScope.length === 0 ? "No posts match the current filters" : "Mark these posts for auto-delivery by Orbit at their scheduled time"}
                  data-testid="button-bulk-orbit"
                >
                  <Send className="w-3.5 h-3.5" />
                  {`Orbit (${bulkDeliveryScope.length})`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-muted-foreground border-muted-foreground/30 hover:bg-muted"
                  onClick={() => bulkDeliveryModeMutation.mutate({ deliveryMode: "csv", postIds: bulkDeliveryScope })}
                  disabled={bulkDeliveryModeMutation.isPending || bulkDeliveryScope.length === 0}
                  title={bulkDeliveryScope.length === 0 ? "No posts match the current filters" : "Reserve these posts for CSV export — Orbit will never auto-publish them"}
                  data-testid="button-bulk-csv"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  {`CSV only (${bulkDeliveryScope.length})`}
                </Button>
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
                  if (postAccountFilter !== "all" && p.socialAccountId !== postAccountFilter) return false;
                  if (!postPassesScopeFilters(p)) return false;
                  if (postFilter === "all") return p.status !== "deleted";
                  if (postFilter === "active") return p.status !== "deleted" && p.status !== "rejected" && p.status !== "archived";
                  if (postFilter === "missing_image") return p.status !== "deleted" && !p.overrideImageUrl && !p.overrideBrandAssetId;
                  return p.status === postFilter;
                }).map(post => {
                  const postImage = getPostImage(post);
                  // Inline editors live in the expanded body, so editing a
                  // collapsed card implicitly expands it.
                  const isExpanded = expandedPosts.has(post.id);
                  return (
                    <Card
                      key={post.id}
                      data-testid={`card-post-${post.id}`}
                      className={
                        (postSelectMode && postSelectedIds.has(post.id)) || focusedPostId === post.id
                          ? "ring-2 ring-primary transition-shadow"
                          : ""
                      }
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
                            {post.socialAccountId && (() => {
                              const acct = allSocialAccounts.find(a => a.id === post.socialAccountId);
                              return acct ? (
                                <Badge variant="secondary" className="gap-1 text-[10px]" data-testid={`badge-account-${post.id}`}>
                                  <AtSign className="w-2.5 h-2.5" />{acct.accountName}
                                </Badge>
                              ) : null;
                            })()}
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
                            {(() => {
                              const articleImg = getArticleLeadImage(post);
                              if (articleImg) {
                                return (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" disabled={rvGeneratingIds.has(post.id)} data-testid={`button-generate-graphic-${post.id}`}>
                                        {rvGeneratingIds.has(post.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => generateGraphic(post.id, articleImg)}>
                                        <ImageLucide className="w-3 h-3 mr-2" />Photo + overlay
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => generateGraphic(post.id)}>
                                        <Wand2 className="w-3 h-3 mr-2" />Chromatic graphic
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                );
                              }
                              return (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Generate branded graphic"
                                  disabled={rvGeneratingIds.has(post.id)}
                                  onClick={() => generateGraphic(post.id)}
                                  data-testid={`button-generate-graphic-${post.id}`}
                                >
                                  {rvGeneratingIds.has(post.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                </Button>
                              );
                            })()}
                            {!["approved", "exported", "scheduled_external", "published", "publish_failed", "rejected"].includes(post.status) && (
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
                              onClick={() => setSharedEditorPostId(post.id)}
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
                            {post.status === "approved" && post.deliveryMode === "csv" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-sky-600"
                                title="Confirm this post was accepted by your scheduling tool (SocialPilot etc.) and mark it as delivered"
                                onClick={() => markDeliveredMutation.mutate([post.id])}
                                disabled={markDeliveredMutation.isPending}
                                data-testid={`button-mark-delivered-${post.id}`}
                              >
                                <FileDown className="w-3.5 h-3.5" />Mark delivered
                              </Button>
                            )}
                            {(post.status === "approved" || post.status === "publish_failed") && !post.publishedAt && post.deliveryMode !== "csv" && (() => {
                              const acct = post.socialAccountId ? allSocialAccounts.find(a => a.id === post.socialAccountId) : null;
                              const connected = acct == null || acct.isConnected !== false;
                              const isRetry = post.status === "publish_failed" || !!post.publishError;
                              return (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`gap-1 ${isRetry ? "text-amber-600" : connected ? "text-blue-600" : "text-amber-600"}`}
                                  title={isRetry ? "Previous attempt failed — retry publishing now" : connected ? "Publish now via Orbit to the linked social account" : "Account not connected — tap to see details"}
                                  onClick={() => {
                                    if (!connected) {
                                      toast({ title: "Account not connected", description: "The linked social account has no active connection. Go to Social Accounts settings and reconnect it before publishing.", variant: "destructive" });
                                      return;
                                    }
                                    publishNowMutation.mutate(post.id);
                                  }}
                                  disabled={publishNowMutation.isPending}
                                  data-testid={`button-publish-now-${post.id}`}
                                >
                                  {publishNowMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isRetry ? <RefreshCw className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                  {isRetry ? "Retry publish" : "Publish now"}
                                </Button>
                              );
                            })()}
                            {!post.publishedAt && !["rejected", "exported", "scheduled_external"].includes(post.status) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-green-600"
                                title="This was already posted somewhere else — log it as posted so it's not pending"
                                onClick={() => markPostedMutation.mutate({ postId: post.id })}
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
                              <div className="shrink-0 relative">
                                <img
                                  src={postImage}
                                  alt=""
                                  loading="lazy"
                                  className={post.postFormat === "carousel" ? "h-10 w-16 rounded object-cover border border-border" : "w-14 h-14 rounded object-cover border border-border"}
                                  onError={e => (e.currentTarget.style.display = "none")}
                                />
                                {post.postFormat === "carousel" && (
                                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-medium rounded px-1 leading-4">
                                    {(post.carouselSlides as any[] | null)?.length ?? ""}
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm line-clamp-2">{post.editedContent ?? post.content}</p>
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                {post.postFormat === "carousel" && (
                                  <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-carousel-${post.id}`}>
                                    <LayoutGrid className="w-2.5 h-2.5" />Carousel
                                  </Badge>
                                )}
                                {post.socialAccountId && (() => {
                                  const acct = allSocialAccounts.find(a => a.id === post.socialAccountId);
                                  return acct ? (
                                    <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-compact-account-${post.id}`}>
                                      <AtSign className="w-2.5 h-2.5" />{acct.accountName}
                                    </Badge>
                                  ) : null;
                                })()}
                                {post.scheduledDate ? (
                                  <Badge variant="secondary" className="text-[10px] gap-1">
                                    <Calendar className="w-2.5 h-2.5" />{format(new Date(post.scheduledDate), "MMM d, h:mm a")}
                                  </Badge>
                                ) : post.status !== "exported" && post.status !== "scheduled_external" && post.status !== "published" && (
                                  <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
                                    <Calendar className="w-2.5 h-2.5" />No date
                                  </Badge>
                                )}
                                <PostStageBadge post={post} />
                                {(() => {
                                  const dm = post.deliveryMode;
                                  if (dm === "csv") return (
                                    <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground border-muted-foreground/30 shrink-0" data-testid={`badge-csv-only-${post.id}`}>
                                      <FileDown className="w-2.5 h-2.5" />CSV only
                                    </Badge>
                                  );
                                  if (post.status === "approved" && post.scheduledDate) {
                                    if (!post.socialAccountId) return (
                                      <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300 shrink-0" data-testid={`badge-no-account-${post.id}`}>
                                        <AlertCircle className="w-2.5 h-2.5" />No account
                                      </Badge>
                                    );
                                    const csa = campaign?.socialAccounts.find(c => c.socialAccountId === post.socialAccountId);
                                    if (post.campaignId && !csa?.autoPublish) return (
                                      <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300 shrink-0" data-testid={`badge-autopublish-off-${post.id}`}>
                                        <AlertCircle className="w-2.5 h-2.5" />Auto-publish off
                                      </Badge>
                                    );
                                    return (
                                      <Badge className="text-[10px] gap-1 bg-blue-600 text-white border-transparent shrink-0" data-testid={`badge-orbit-scheduled-${post.id}`}>
                                        <Send className="w-2.5 h-2.5" />Orbit scheduled
                                      </Badge>
                                    );
                                  }
                                  return null;
                                })()}
                                {post.sourceBriefId && (() => {
                                  const srcBrief = briefs.find(b => b.id === post.sourceBriefId);
                                  return srcBrief ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); navigateToBrief(post.sourceBriefId!); }}
                                      data-testid={`badge-source-brief-${post.id}`}
                                      className="inline-flex items-center gap-1 text-[10px] rounded-md border border-primary/30 bg-primary/5 text-primary px-1.5 py-0.5 hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
                                      title={`Go to source brief: ${srcBrief.title}`}
                                    >
                                      <Zap className="w-2.5 h-2.5" />
                                      {srcBrief.title.length > 30 ? srcBrief.title.slice(0, 30) + "…" : srcBrief.title}
                                    </button>
                                  ) : null;
                                })()}
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
                        {post.sourceBriefId && (() => {
                          const srcBrief = briefs.find(b => b.id === post.sourceBriefId);
                          return srcBrief ? (
                            <button
                              type="button"
                              onClick={() => navigateToBrief(post.sourceBriefId!)}
                              data-testid={`badge-source-brief-expanded-${post.id}`}
                              className="inline-flex items-center gap-1 text-[10px] rounded-md border border-primary/30 bg-primary/5 text-primary px-1.5 py-0.5 hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
                              title={`Go to source brief: ${srcBrief.title}`}
                            >
                              <Zap className="w-2.5 h-2.5" />
                              {srcBrief.title.length > 40 ? srcBrief.title.slice(0, 40) + "…" : srcBrief.title}
                            </button>
                          ) : null;
                        })()}
                        {post.scheduledDate ? (
                          <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-schedule-${post.id}`}>
                            <Calendar className="w-2.5 h-2.5" />{format(new Date(post.scheduledDate), "MMM d, yyyy h:mm a")}
                          </Badge>
                        ) : post.status !== "exported" && post.status !== "scheduled_external" && post.status !== "published" && (
                          <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300" data-testid={`badge-no-date-${post.id}`}>
                            <Calendar className="w-2.5 h-2.5" />No date — excluded from export
                          </Badge>
                        )}
                        <div className="flex items-center gap-1 rounded border overflow-hidden text-[10px] shrink-0" data-testid={`post-delivery-mode-${post.id}`} title="Choose how this post gets published">
                          <button
                            type="button"
                            className={`px-2 py-0.5 flex items-center gap-1 transition-colors ${post.deliveryMode !== "csv" ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
                            onClick={() => setDeliveryModeMutation.mutate({ postId: post.id, deliveryMode: null })}
                            title="Orbit will auto-publish at the scheduled time"
                            data-testid={`button-delivery-orbit-${post.id}`}
                          >
                            <Send className="w-2.5 h-2.5" /> Orbit
                          </button>
                          <button
                            type="button"
                            className={`px-2 py-0.5 flex items-center gap-1 border-l transition-colors ${post.deliveryMode === "csv" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                            onClick={() => setDeliveryModeMutation.mutate({ postId: post.id, deliveryMode: "csv" })}
                            title="Reserve for CSV export only — Orbit will never auto-publish this"
                            data-testid={`button-delivery-csv-${post.id}`}
                          >
                            <FileDown className="w-2.5 h-2.5" /> CSV only
                          </button>
                        </div>
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
                          }}
                          data-testid={`button-collapse-${post.id}`}
                        >
                          Collapse <ChevronDown className="w-3 h-3 ml-1 rotate-180" />
                        </Button>
                        </div>
                        {post.publishedAt && (
                          <div className="flex items-center gap-2 flex-wrap text-xs text-green-600" data-testid={`badge-published-${post.id}`}>
                            <span className="flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              Posted {format(new Date(post.publishedAt), "MMM d, h:mm a")}
                            </span>
                            {post.publishedUrl ? (
                              <a
                                href={post.publishedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-600/10 hover:bg-green-600/20 text-green-700 font-medium transition-colors"
                                data-testid={`link-published-${post.id}`}
                              >
                                <ExternalLink className="w-3 h-3" />
                                View on {post.platform === "linkedin" ? "LinkedIn" : post.platform === "twitter" ? "X" : post.platform}
                              </a>
                            ) : (
                              <span className="flex items-center gap-1 text-amber-600" title="The post was sent but the platform did not return a confirmation URL — check the platform directly to verify it appeared">
                                <AlertCircle className="w-3 h-3" />
                                No confirmation URL captured
                              </span>
                            )}
                          </div>
                        )}
                        {post.publishError && !post.publishedAt && post.postFormat === "carousel" ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-2.5" data-testid={`text-publish-error-${post.id}`}>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              Carousel auto-posting failed — post it manually
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                              LinkedIn carousel (PDF) posts require special API permissions that haven't been granted yet. Download the image below, post it directly on LinkedIn, then record the date here.
                            </p>
                            {post.publishError && (
                              <p className="text-[10px] text-red-500 font-mono break-all">{post.publishError}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 pt-0.5">
                              <label className="text-xs text-muted-foreground shrink-0">When did you post it?</label>
                              <input
                                type="datetime-local"
                                className="text-xs border border-input rounded px-2 py-1 bg-background"
                                value={manualPostedAtMap[post.id] ?? ""}
                                onChange={(e) => setManualPostedAtMap(prev => ({ ...prev, [post.id]: e.target.value }))}
                                data-testid={`input-manual-posted-at-${post.id}`}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 text-green-700 border-green-300 hover:bg-green-50 dark:hover:bg-green-950"
                                onClick={() => markPostedMutation.mutate({ postId: post.id, publishedAt: manualPostedAtMap[post.id] })}
                                disabled={markPostedMutation.isPending}
                                data-testid={`button-mark-posted-carousel-${post.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />Mark as posted
                              </Button>
                            </div>
                          </div>
                        ) : post.publishError && !post.publishedAt ? (
                          <div className="flex items-center gap-1 text-xs text-red-500" data-testid={`text-publish-error-${post.id}`}>
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            Publish failed: {post.publishError}
                          </div>
                        ) : null}
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
                        <p className="text-sm whitespace-pre-wrap">{post.editedContent ?? post.content}</p>
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
                          <div
                            className="flex items-center gap-1 flex-wrap cursor-pointer group"
                            onClick={() => setSharedEditorPostId(post.id)}
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
                              src={thumbnailUrl(asset.leadImageUrl, 160)}
                              srcSet={buildSrcSet(asset.leadImageUrl, [120, 160, 240])}
                              sizes="(max-width: 640px) 64px, 48px"
                              alt=""
                              className="w-10 h-10 rounded object-cover shrink-0"
                              loading="lazy"
                              onError={e => (e.currentTarget.style.display = "none")}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ca.overrideTitle ?? asset?.title ?? ca.assetId}</p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {asset?.isExternal && (
                                <Badge variant="outline" className="text-[10px] gap-1 border-blue-300 text-blue-600 dark:text-blue-400" data-testid={`badge-external-${ca.assetId}`}>
                                  <ExternalLink className="w-2.5 h-2.5" /> External
                                </Badge>
                              )}
                              {asset?.assetDate ? (
                                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                  <Calendar className="w-2.5 h-2.5" />{new Date(asset.assetDate).toLocaleDateString()}
                                </span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground/60">No date</span>
                              )}
                              {asset?.description && <span className="text-xs text-muted-foreground truncate">· {asset.description}</span>}
                            </div>
                          </div>
                          {asset?.assetType && (
                            <Badge variant="outline" className="shrink-0 text-xs">{asset.assetType}</Badge>
                          )}
                          {/* Inline date + source edit — writes to the shared asset. */}
                          {asset && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground" data-testid={`button-edit-asset-meta-${ca.assetId}`} title="Date & source">
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-64 space-y-3">
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground">Date</label>
                                  <input
                                    type="date"
                                    defaultValue={asset.assetDate ? asset.assetDate.slice(0, 10) : ""}
                                    onChange={(e) => updateAssetMetaMutation.mutate({ assetId: asset.id, assetDate: e.target.value || null })}
                                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                                    data-testid={`input-asset-date-${ca.assetId}`}
                                  />
                                  <p className="text-[11px] text-muted-foreground mt-1">When it went live / published.</p>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm">{asset.isExternal ? "External" : "Created in Orbit"}</span>
                                  <Switch
                                    checked={!!asset.isExternal}
                                    onCheckedChange={(v) => updateAssetMetaMutation.mutate({ assetId: asset.id, isExternal: v })}
                                    data-testid={`switch-asset-external-${ca.assetId}`}
                                  />
                                </div>
                              </PopoverContent>
                            </Popover>
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
                                <img src={thumbnailUrl(thumb, 160)} srcSet={buildSrcSet(thumb, [120, 160, 240])} sizes="48px" alt="" className="w-8 h-8 rounded object-cover shrink-0" loading="lazy" onError={e => (e.currentTarget.style.display = "none")} />
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
                            <img src={thumbnailUrl(asset.leadImageUrl, 160)} srcSet={buildSrcSet(asset.leadImageUrl, [120, 160, 240])} sizes="(max-width: 640px) 64px, 48px" alt="" className="w-8 h-8 rounded object-cover shrink-0" loading="lazy" onError={e => (e.currentTarget.style.display = "none")} />
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
                          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${rvGroupBy === g ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => setRvGroupBy(g)}
                          data-testid={`button-rv-group-${g}`}
                        >
                          {g === "channel" && <LayoutGrid className="w-3 h-3" />}
                          {g === "concept" && <Layers className="w-3 h-3" />}
                          {g === "date" && <CalendarDays className="w-3 h-3" />}
                          {g === "channel" ? "Channel" : g === "concept" ? "Theme" : "Date"}
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

                    {/* CSV export — same flow as Social Posts tab */}
                    {posts.filter(p => p.status === "approved").length > 0 && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <Select value={csvFormat} onValueChange={setCsvFormat}>
                          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-rv-csv-format">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="generic">Generic</SelectItem>
                            <SelectItem value="socialpilot">SocialPilot</SelectItem>
                            <SelectItem value="hootsuite">Hootsuite</SelectItem>
                            <SelectItem value="sproutsocial">Sprout Social</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleExportClick} disabled={exportCsvMutation.isPending} data-testid="button-rv-export-csv">
                          <Download className="w-3.5 h-3.5" />Export CSV
                        </Button>
                      </div>
                    )}

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
                      {rvSelectedIds.size > 0 && campaignArticleLeadImage && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          disabled={rvBulkTotal > 0}
                          onClick={() => applyArticleImageBatch(Array.from(rvSelectedIds), campaignArticleLeadImage, setRvBulkTotal, setRvBulkProgress)}
                          title="Composite text + logo onto the article hero photo for each selected post"
                          data-testid="button-rv-bulk-photo-overlay"
                        >
                          {rvBulkTotal > 0 ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" />{rvBulkProgress}/{rvBulkTotal}</>
                          ) : (
                            <><ImageLucide className="w-3.5 h-3.5" />Photo + overlay for selected</>
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
                          disabled={rvGeneratingIds.size > 0 || rvBulkApproving || rvBulkRejecting || rvBulkTotal > 0}
                          onClick={() => bulkGenerateGraphics(Array.from(rvSelectedIds))}
                          title="Composite a text + logo graphic onto each selected post. Posts that already have a background image use it; others get one generated from the post text."
                          data-testid="button-rv-bulk-generate-graphics"
                        >
                          {rvGeneratingIds.size > 0 || rvBulkTotal > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          Generate graphics{rvGeneratingIds.size > 0 ? ` (${rvGeneratingIds.size} left…)` : rvBulkTotal > 0 ? ` (${rvBulkProgress}/${rvBulkTotal})` : ""}
                        </Button>
                      )}
                      {rvSelectedIds.size > 0 && campaignArticleLeadImage && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          disabled={rvGeneratingIds.size > 0 || rvBulkApproving || rvBulkRejecting || rvBulkTotal > 0}
                          onClick={() => applyArticleImageBatch(Array.from(rvSelectedIds), campaignArticleLeadImage, setRvBulkTotal, setRvBulkProgress)}
                          title="Set each selected post's image to the article's featured image"
                          data-testid="button-rv-bulk-use-article-image"
                        >
                          {rvBulkTotal > 0 ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{rvBulkProgress}/{rvBulkTotal}</> : <><ImageLucide className="w-3.5 h-3.5" />Use article images</>}
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
                                        src={thumbnailUrl(img, 480)}
                                        srcSet={buildSrcSet(img, [320, 480, 640])}
                                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
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
                                      {post.socialAccountId && (() => {
                                        const acct = allSocialAccounts.find(a => a.id === post.socialAccountId);
                                        return acct ? (
                                          <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 max-w-[80px] truncate" data-testid={`rv-badge-account-${post.id}`} title={acct.accountName}>
                                            <AtSign className="w-2 h-2 shrink-0" /><span className="truncate">{acct.accountName}</span>
                                          </Badge>
                                        ) : null;
                                      })()}
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
                                          {(() => {
                                            const articleImg = getArticleLeadImage(post);
                                            if (articleImg) {
                                              return (
                                                <div className="flex-1" onClick={e => e.stopPropagation()}>
                                                  <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                      <Button size="sm" variant="outline" className="h-6 text-[10px] w-full gap-1 px-2" disabled={isGenerating} data-testid={`button-rv-generate-img-${post.id}`}>
                                                        <Wand2 className="w-3 h-3 shrink-0" />Generate
                                                      </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                      <DropdownMenuItem onSelect={() => generateGraphic(post.id, articleImg)}>
                                                        <ImageLucide className="w-3 h-3 mr-2" />Photo + overlay
                                                      </DropdownMenuItem>
                                                      <DropdownMenuSeparator />
                                                      <DropdownMenuItem onSelect={() => generateGraphic(post.id)}>
                                                        <Wand2 className="w-3 h-3 mr-2" />Chromatic graphic
                                                      </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                  </DropdownMenu>
                                                </div>
                                              );
                                            }
                                            return (
                                              <Button size="sm" variant="outline" className="h-6 text-[10px] flex-1 gap-1 px-2" disabled={isGenerating}
                                                onClick={e => { e.stopPropagation(); generateGraphic(post.id); }}
                                                data-testid={`button-rv-generate-img-${post.id}`}>
                                                <Wand2 className="w-3 h-3 shrink-0" />Generate
                                              </Button>
                                            );
                                          })()}
                                        </div>
                                        {!["approved", "exported", "scheduled_external", "published", "rejected"].includes(post.status) && (
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
                                        )}
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

      {/* Shared post editor — same component as calendar/queue/pipeline */}
      {sharedEditorPostId && (
        <SocialPostEditor
          postId={sharedEditorPostId}
          campaignName={campaign?.name}
          onClose={() => setSharedEditorPostId(null)}
        />
      )}

      {/* Image Override Picker Dialog — brand assets + content assets */}
      <Dialog open={!!imagePickerPostId} onOpenChange={v => { if (!v) { setImagePickerPostId(null); setPickerCategoryFilter("all"); setPickerContentCategoryFilter("all"); setPickerPage(0); setPickerTab("brand"); setPickerShowAll(false); setPickerUploadFile(null); setPickerUploadPreview(null); setPickerUploadAlt(""); setPickerUploadResult(null); setPickerUploadError(null); } }}>
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

            {/* Tab toggle: brand assets | content assets | upload */}
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
              <button
                className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l ${pickerTab === "upload" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                onClick={() => setPickerTab("upload")}
                data-testid="button-picker-tab-upload"
              >
                Upload
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

            {/* Upload tab */}
            {pickerTab === "upload" && (
              <div className="space-y-3">
                <input
                  ref={pickerFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="input-picker-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setPickerUploadFile(f);
                    setPickerUploadResult(null);
                    setPickerUploadError(null);
                    setPickerUploadAlt(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
                    const reader = new FileReader();
                    reader.onload = (ev) => setPickerUploadPreview(ev.target?.result as string ?? null);
                    reader.readAsDataURL(f);
                  }}
                />

                {!pickerUploadFile ? (
                  <button
                    type="button"
                    className="w-full border-2 border-dashed rounded-lg py-10 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                    onClick={() => pickerFileInputRef.current?.click()}
                    data-testid="button-picker-drop-zone"
                  >
                    <Upload className="h-8 w-8" />
                    <span className="text-sm font-medium">Click to choose an image</span>
                    <span className="text-xs">PNG, JPG, WebP — max 15 MB</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    {pickerUploadPreview && (
                      <div className="rounded-lg overflow-hidden border aspect-video bg-muted">
                        <img src={pickerUploadPreview} alt="Preview" className="w-full h-full object-contain" />
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Alt text</label>
                      <input
                        value={pickerUploadAlt}
                        onChange={(e) => setPickerUploadAlt(e.target.value)}
                        placeholder="Describe the image…"
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        data-testid="input-picker-alt"
                      />
                    </div>

                    {pickerUploadResult && (
                      <div className="flex items-start gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>Saved to Orbit media storage. Ready to use.</span>
                      </div>
                    )}
                    {pickerUploadError && (
                      <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{pickerUploadError}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setPickerUploadFile(null); setPickerUploadPreview(null); setPickerUploadResult(null); setPickerUploadError(null); if (pickerFileInputRef.current) pickerFileInputRef.current.value = ""; }}
                        data-testid="button-picker-upload-clear"
                      >
                        Change
                      </Button>
                      {!pickerUploadResult ? (
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={pickerIsUploading}
                          data-testid="button-picker-upload-submit"
                          onClick={async () => {
                            if (!pickerUploadFile) return;
                            setPickerIsUploading(true);
                            setPickerUploadError(null);
                            try {
                              const formData = new FormData();
                              formData.append("file", pickerUploadFile);
                              formData.append("altText", pickerUploadAlt);
                              const r = await fetch("/api/integrations/website/upload-media", {
                                method: "POST",
                                credentials: "include",
                                body: formData,
                              });
                              const data = await r.json();
                              if (!r.ok) throw new Error(data.error || "Upload failed");
                              setPickerUploadResult({ url: data.url, source: data.source });
                            } catch (e: unknown) {
                              setPickerUploadError(e instanceof Error ? e.message : "Upload failed");
                            } finally {
                              setPickerIsUploading(false);
                            }
                          }}
                        >
                          {pickerIsUploading ? "Uploading…" : "Upload"}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="flex-1"
                          data-testid="button-picker-upload-insert"
                          onClick={() => {
                            if (!imagePickerPostId || !pickerUploadResult) return;
                            const targets = rvSelectMode && rvSelectedIds.size > 0
                              ? Array.from(rvSelectedIds)
                              : postSelectMode && postSelectedIds.size > 0
                                ? Array.from(postSelectedIds)
                                : [imagePickerPostId];
                            targets.forEach(pid => updatePostMutation.mutate({
                              postId: pid,
                              overrideImageUrl: pickerUploadResult.url,
                              overrideBrandAssetId: null,
                            }));
                            setImagePickerPostId(null);
                          }}
                        >
                          Use this image
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

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
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="flex-1 min-w-0">
                <Label htmlFor="edit-brief-only-mode" className="font-medium cursor-pointer">Focus on campaign content only</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When on, posts draw only from this campaign's brief and attached content.
                  Market positioning, competitive intelligence, and news signals are excluded.
                </p>
              </div>
              <Switch
                id="edit-brief-only-mode"
                checked={editCampaignBriefOnly}
                onCheckedChange={setEditCampaignBriefOnly}
                data-testid="switch-edit-campaign-brief-only"
              />
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
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-thematic-url">Source Article URL</Label>
              <Input
                id="edit-campaign-thematic-url"
                type="url"
                value={editCampaignThematicUrl}
                onChange={e => setEditCampaignThematicUrl(e.target.value)}
                placeholder="https://www.synozur.com/post/..."
                data-testid="input-edit-campaign-thematic-url"
              />
              <p className="text-[11px] text-muted-foreground">The blog post or article this campaign is based on. Orbit will scrape it when generating content briefs so every brief reflects the article's specific findings.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-thematic-brief">Source Article Text (optional)</Label>
              <Textarea
                id="edit-campaign-thematic-brief"
                value={editCampaignThematicBrief}
                onChange={e => setEditCampaignThematicBrief(e.target.value)}
                rows={4}
                placeholder="Paste the article text here if the URL can't be scraped automatically."
                data-testid="input-edit-campaign-thematic-brief"
              />
              <p className="text-[11px] text-muted-foreground">Only needed if the URL is behind a paywall or login. Pasted text takes priority over the URL.</p>
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

      {/* Bulk assign social account to selected posts */}
      <Dialog open={bulkAssignAccountOpen} onOpenChange={(open) => { setBulkAssignAccountOpen(open); if (!open) setBulkAssignAccountId(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign social account</DialogTitle>
            <DialogDescription>
              Set the publishing account on {postSelectedIds.size} selected post{postSelectedIds.size !== 1 ? "s" : ""}. This will overwrite any existing account assignment.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <Select value={bulkAssignAccountId} onValueChange={setBulkAssignAccountId}>
              <SelectTrigger data-testid="select-bulk-assign-account">
                <SelectValue placeholder="Choose an account…" />
              </SelectTrigger>
              <SelectContent>
                {(campaign?.socialAccounts ?? []).map((csa) => {
                  const acct = allSocialAccounts.find(a => a.id === csa.socialAccountId);
                  if (!acct) return null;
                  return (
                    <SelectItem key={acct.id} value={acct.id}>
                      <span className="capitalize">{acct.platform}</span>{acct.accountName ? ` · ${acct.accountName}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAssignAccountOpen(false)}>Cancel</Button>
            <Button
              disabled={!bulkAssignAccountId || bulkAssignAccountMutation.isPending}
              onClick={() => bulkAssignAccountMutation.mutate({ socialAccountId: bulkAssignAccountId, postIds: Array.from(postSelectedIds) })}
              data-testid="button-confirm-bulk-assign-account"
            >
              {bulkAssignAccountMutation.isPending ? "Assigning…" : "Assign account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy brief to campaign */}
      <Dialog open={copyBriefOpen} onOpenChange={(open) => { setCopyBriefOpen(open); if (!open) { setCopyBriefId(null); setCopyTargetCampaignId(""); setCopyNewCampaignName(""); setCopyMode("existing"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copy brief to campaign</DialogTitle>
            <DialogDescription>Choose an existing campaign or create a new one. The brief will be added to its content plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button
                variant={copyMode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setCopyMode("existing")}
                className="flex-1"
              >
                Existing campaign
              </Button>
              <Button
                variant={copyMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setCopyMode("new")}
                className="flex-1"
              >
                New campaign
              </Button>
            </div>

            {copyMode === "existing" ? (
              <div className="space-y-1.5">
                <Label>Campaign</Label>
                <Select value={copyTargetCampaignId} onValueChange={setCopyTargetCampaignId}>
                  <SelectTrigger data-testid="select-copy-campaign">
                    <SelectValue placeholder="Select a campaign…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allCampaigns
                      .filter((c) => c.id !== id)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    {allCampaigns.filter((c) => c.id !== id).length === 0 && (
                      <SelectItem value="_none" disabled>No other campaigns</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Campaign name</Label>
                <Input
                  placeholder="e.g. Q3 Awareness Push"
                  value={copyNewCampaignName}
                  onChange={(e) => setCopyNewCampaignName(e.target.value)}
                  data-testid="input-new-campaign-name"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setCopyBriefOpen(false)}>Cancel</Button>
            <Button
              disabled={
                copyBriefMutation.isPending ||
                (copyMode === "existing" && !copyTargetCampaignId) ||
                (copyMode === "new" && !copyNewCampaignName.trim())
              }
              onClick={() => {
                if (!copyBriefId) return;
                copyBriefMutation.mutate(
                  copyMode === "existing"
                    ? { briefId: copyBriefId, campaignId: copyTargetCampaignId }
                    : { briefId: copyBriefId, newCampaignName: copyNewCampaignName },
                );
              }}
              data-testid="button-confirm-copy-brief"
            >
              {copyBriefMutation.isPending ? "Copying…" : "Copy brief"}
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
              Distribute active posts evenly across the campaign date range ({campaign?.startDate ? format(new Date(campaign.startDate), "MMM d") : "?"}{campaign?.endDate ? ` — ${format(new Date(campaign.endDate), "MMM d")}` : campaign?.numberOfDays ? ` — ${campaign.numberOfDays} days` : ""}).
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
            <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="checkbox-skip-scheduled">
              <Checkbox
                checked={scheduleSkipScheduled}
                onCheckedChange={(c) => setScheduleSkipScheduled(!!c)}
              />
              Skip posts that already have a date (recommended — protects other platforms)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="checkbox-archive-leftover">
              <Checkbox
                checked={scheduleArchiveLeftover}
                onCheckedChange={(c) => setScheduleArchiveLeftover(!!c)}
              />
              Archive any leftover posts that still have no date
            </label>
            <div className="text-sm text-muted-foreground" data-testid="text-schedule-preview">
              {(() => {
                const active = posts.filter(p =>
                  p.status !== "deleted" &&
                  p.status !== "rejected" &&
                  schedulePlatforms.includes(p.platform) &&
                  (!scheduleSkipScheduled || !p.scheduledDate)
                ).length;
                const interval = parseInt(daysBetweenPosts);
                const perDay = parseInt(postsPerDay);
                const previewDays = campaign?.numberOfDays ?? (campaign?.startDate && campaign?.endDate ? Math.max(1, Math.round((new Date(campaign.endDate).getTime() - new Date(campaign.startDate).getTime()) / 86400000) + 1) : null);
                if (!campaign?.startDate || !previewDays) {
                  return `${active} active post${active !== 1 ? "s" : ""} will be distributed across eligible days.`;
                }
                const campaignStart = new Date(campaign.startDate);
                const todayPreview = new Date();
                todayPreview.setHours(0, 0, 0, 0);
                const start = campaignStart < todayPreview ? todayPreview : campaignStart;
                const origEnd = addDays(new Date(campaign.startDate), previewDays - 1);
                const endDate = origEnd < todayPreview ? addDays(todayPreview, previewDays - 1) : origEnd;
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

      {/* LinkedIn Digest dialog */}
      <Dialog
        open={digestDialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDigestSourceContent(""); setDigestTitle(""); setDigestSocialAccountId("");
            setDigestScrapeUrl(""); setDigestScrapeFrom(""); setDigestScrapeTo("");
            setDigestScrapedPosts([]); setDigestScrapeError("");
          }
          setDigestDialogOpen(o);
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Newspaper className="w-4 h-4" /> LinkedIn Digest
            </DialogTitle>
            <DialogDescription>
              Pull in posts automatically, remove anything irrelevant, then add anything missing. Orbit generates a digest article, newsletter, and LinkedIn teaser — all linked to this campaign.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* ── Title ── */}
            <div className="space-y-1.5">
              <Label htmlFor="digest-title">Title <span className="text-muted-foreground font-normal text-xs">(optional — AI picks one if blank)</span></Label>
              <input
                id="digest-title"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={`LinkedIn Digest \u2014 ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`}
                value={digestTitle}
                onChange={(e) => setDigestTitle(e.target.value)}
              />
            </div>

            {/* ── Fetch from LinkedIn ── */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1 — Fetch posts from LinkedIn</p>
              <div className="space-y-2">
                <div className="flex h-9 w-full rounded-md border border-input bg-background text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring overflow-hidden">
                  <span className="flex items-center px-3 text-muted-foreground bg-muted/50 border-r border-input shrink-0 select-none text-xs">
                    linkedin.com/in/
                  </span>
                  <input
                    className="flex-1 bg-transparent px-3 py-1 focus:outline-none placeholder:text-muted-foreground"
                    placeholder="your-username"
                    value={digestScrapeUrl}
                    onChange={(e) => { setDigestScrapeUrl(e.target.value.replace(/.*linkedin\.com\/in\//i, "").replace(/\/$/, "")); setDigestScrapeError(""); }}
                  />
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="date"
                    className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={digestScrapeFrom}
                    onChange={(e) => setDigestScrapeFrom(e.target.value)}
                  />
                  <span className="text-muted-foreground text-xs shrink-0">to</span>
                  <input
                    type="date"
                    className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={digestScrapeTo}
                    onChange={(e) => setDigestScrapeTo(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={digestScrapeLoading || !digestScrapeUrl.trim() || !digestScrapeFrom || !digestScrapeTo}
                    onClick={async () => {
                      setDigestScrapeError("");
                      setDigestScrapeLoading(true);
                      try {
                        const r = await fetch("/api/linkedin-digest/preview", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ profileUrl: `https://www.linkedin.com/in/${digestScrapeUrl.trim()}`, startDate: digestScrapeFrom, endDate: digestScrapeTo }),
                        });
                        const data = await r.json();
                        if (!r.ok) throw new Error(data.error || "Failed to fetch posts");
                        const incoming: Array<{ id: string; text: string; postedAt: string; kept: boolean }> =
                          (data.posts ?? []).map((p: any, i: number) => ({ id: `scraped-${i}-${Date.now()}`, text: p.text, postedAt: p.postedAt ?? "", kept: true }));
                        setDigestScrapedPosts(incoming);
                        if (incoming.length === 0) setDigestScrapeError("No posts found in that date range.");
                      } catch (e: any) {
                        setDigestScrapeError(e.message);
                      } finally {
                        setDigestScrapeLoading(false);
                      }
                    }}
                  >
                    {digestScrapeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Fetch"}
                  </Button>
                </div>
                {digestScrapeError && <p className="text-xs text-destructive">{digestScrapeError}</p>}
              </div>

              {/* Fetched posts list */}
              {digestScrapedPosts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{digestScrapedPosts.filter((p) => p.kept).length} of {digestScrapedPosts.length} posts selected</p>
                    <div className="flex gap-2">
                      <button className="text-xs text-primary hover:underline" onClick={() => setDigestScrapedPosts((ps) => ps.map((p) => ({ ...p, kept: true })))}>Select all</button>
                      <button className="text-xs text-muted-foreground hover:underline" onClick={() => setDigestScrapedPosts((ps) => ps.map((p) => ({ ...p, kept: false })))}>Deselect all</button>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {digestScrapedPosts.map((post) => (
                      <div
                        key={post.id}
                        className={`flex gap-2 rounded-md border p-2 text-xs cursor-pointer transition-colors ${post.kept ? "bg-background border-border" : "bg-muted/20 border-dashed opacity-50"}`}
                        onClick={() => setDigestScrapedPosts((ps) => ps.map((p) => p.id === post.id ? { ...p, kept: !p.kept } : p))}
                      >
                        <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${post.kept ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                          {post.kept && <span className="text-[9px] text-primary-foreground font-bold leading-none">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          {post.postedAt && <p className="text-[10px] text-muted-foreground mb-0.5">{new Date(post.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
                          <p className="line-clamp-3 leading-relaxed">{post.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Add anything missing ── */}
            <div className="space-y-1.5">
              <Label htmlFor="digest-source">
                {digestScrapedPosts.length > 0
                  ? <span>Step 2 — Add anything missing <span className="text-muted-foreground font-normal text-xs">(optional)</span></span>
                  : <span>Source content <span className="text-destructive">*</span></span>}
              </Label>
              <Textarea
                id="digest-source"
                placeholder={digestScrapedPosts.length > 0
                  ? "Paste any extra articles, news snippets, or notes not captured above\u2026"
                  : "Paste your LinkedIn posts, industry articles, or notes here\u2026\n\nExample:\n\u2014 AI adoption in mid-market is accelerating\u2026\n\u2014 Three things I learned at the conference this week\u2026\n\u2014 Article: [paste headline + key points]"}
                value={digestSourceContent}
                onChange={(e) => setDigestSourceContent(e.target.value)}
                className="min-h-[120px] text-sm leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">The AI synthesizes this into a structured article, newsletter, and social post — no facts are invented.</p>
            </div>

            {/* ── LinkedIn account for teaser ── */}
            {allSocialAccounts.filter((a) => a.platform === "linkedin").length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="digest-account">LinkedIn account for teaser post <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <Select value={digestSocialAccountId || "__none__"} onValueChange={(v) => setDigestSocialAccountId(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="digest-account">
                    <SelectValue placeholder="Skip social post" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Skip social post</SelectItem>
                    {allSocialAccounts.filter((a) => a.platform === "linkedin").map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ── What gets created ── */}
            <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <p className="font-medium text-foreground">What gets created:</p>
              <p>• Digest article (LinkedIn Digest format)</p>
              <p>• Newsletter (email-ready version)</p>
              {digestSocialAccountId
                ? <p>• LinkedIn teaser post → {allSocialAccounts.find((a) => a.id === digestSocialAccountId)?.accountName}</p>
                : allSocialAccounts.filter((a) => a.platform === "linkedin").length > 0
                  ? <p className="text-muted-foreground/70">• LinkedIn teaser post (select an account above to enable)</p>
                  : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDigestDialogOpen(false)} disabled={generateDigestMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => generateDigestMutation.mutate()}
              disabled={
                generateDigestMutation.isPending ||
                (digestScrapedPosts.filter((p) => p.kept).length === 0 && !digestSourceContent.trim())
              }
            >
              {generateDigestMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Generate digest</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Blog Post dialog — idea input + AI title suggestion */}
      <Dialog open={newBlogDialogOpen} onOpenChange={(o) => { if (!o) { setBlogIdeaText(""); setSuggestedBlogTitle(""); } setNewBlogDialogOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Newspaper className="w-4 h-4" /> New Blog Post</DialogTitle>
            <DialogDescription>Describe your idea and let AI suggest a title, or type one directly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="blog-title">Blog post title</Label>
              <Input
                id="blog-title"
                placeholder="Enter the title"
                value={suggestedBlogTitle}
                onChange={(e) => setSuggestedBlogTitle(e.target.value)}
                autoFocus
                data-testid="input-blog-title"
              />
            </div>
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Or let AI suggest a title from your idea</p>
              <Textarea
                id="blog-idea"
                placeholder="e.g. how did SpaceX become an AI company — aren't they a rocket company?"
                className="resize-none min-h-[72px]"
                value={blogIdeaText}
                onChange={(e) => setBlogIdeaText(e.target.value)}
                data-testid="textarea-blog-idea"
              />
              <Button
                variant="outline"
                className="w-full gap-2"
                disabled={!blogIdeaText.trim() || suggestBlogTitleMutation.isPending}
                onClick={() => suggestBlogTitleMutation.mutate(blogIdeaText)}
                data-testid="button-suggest-blog-title"
              >
                {suggestBlogTitleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Suggest title with AI
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewBlogDialogOpen(false)} data-testid="button-cancel-new-blog">Cancel</Button>
            <Button
              variant="secondary"
              disabled={!suggestedBlogTitle.trim() || hubCreateBlogPostMutation.isPending}
              onClick={() => hubCreateBlogPostMutation.mutate({ title: suggestedBlogTitle, writeMyself: true })}
              data-testid="button-write-blog-myself"
            >
              {hubCreateBlogPostMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
              Write myself
            </Button>
            <Button
              disabled={!suggestedBlogTitle.trim() || hubCreateBlogPostMutation.isPending}
              onClick={() => hubCreateBlogPostMutation.mutate({ title: suggestedBlogTitle })}
              data-testid="button-create-blog-post"
            >
              {hubCreateBlogPostMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create brief
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generateDialogOpen} onOpenChange={(o) => { if (!o) { saveAccountIds(id, generateDialogAccountIds); setGenerateDialogOpen(false); setSelectedBrandImageIds([]); setBrandCategoryFilter("all"); setBrandPage(0); setThematicBrief(""); setThematicUrl(""); setBlogAssetId(null); setBlogSearch(""); setBlogImportUrl(""); setBlogImportStatus("idle"); setBlogImportError(""); setGenerateMode("asset"); setVariantsPerPlatform(null); setSelectedBriefId(null); setGenerateDialogAccountIds(null); setOnePostPerAsset(false); } else { setGenerateDialogOpen(true); } }}>
        <DialogContent className="max-w-lg flex flex-col max-h-[80vh]">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Generate Social Posts</DialogTitle>
            <DialogDescription>
              Choose how to source the content for your generated posts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">

            {/* Mode Toggle — first choice the user makes */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setGenerateMode("asset")}
                className={`flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${generateMode === "asset" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"}`}
                data-testid="button-mode-asset"
              >
                <span className="text-sm font-semibold">From Digital Assets</span>
                <span className="text-xs text-muted-foreground mt-0.5">Each pinned asset drives the post — posts are written about the asset itself</span>
              </button>
              <button
                onClick={() => setGenerateMode("thematic")}
                className={`flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${generateMode === "thematic" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"}`}
                data-testid="button-mode-thematic"
              >
                <span className="text-sm font-semibold">From Brief / Theme</span>
                <span className="text-xs text-muted-foreground mt-0.5">Posts come from your brief text — pinned links and images applied after</span>
              </button>
              <button
                onClick={() => setGenerateMode("blog")}
                className={`flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${generateMode === "blog" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"}`}
                data-testid="button-mode-blog"
              >
                <span className="text-sm font-semibold">Promote a Blog Post</span>
                <span className="text-xs text-muted-foreground mt-0.5">Paste a blog URL — AI reads it and generates 5 promotion-ready posts with visual variants</span>
              </button>
            </div>

            {/* Blog Post Promotion — asset picker + import from URL */}
            {generateMode === "blog" && (
              <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
                {/* URL import — primary action, shown first */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Paste the blog post URL</Label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={blogImportUrl}
                      onChange={e => { setBlogImportUrl(e.target.value); setBlogImportStatus("idle"); setBlogImportError(""); }}
                      placeholder="https://synozur.com/blog/your-post"
                      className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      data-testid="input-blog-import-url"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!blogImportUrl.trim() || blogImportStatus === "fetching"}
                      onClick={() => importBlogMutation.mutate(blogImportUrl.trim())}
                      data-testid="button-blog-import"
                    >
                      {blogImportStatus === "fetching" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch & Use"}
                    </Button>
                  </div>
                  {blogImportStatus === "error" && (
                    <p className="text-xs text-destructive">{blogImportError || "Could not fetch this URL."}</p>
                  )}
                  {blogImportStatus === "done" && (
                    <p className="text-xs text-green-600">Fetched and selected — ready to generate.</p>
                  )}
                </div>

                {/* Library picker — secondary, for posts already imported */}
                {(() => {
                  const blogAssets = allAssets.filter(a => a.url && (a as any).status !== "archived");
                  if (blogAssets.length === 0) return null;
                  return (
                    <div className="border-t pt-3 space-y-2">
                      <Label className="text-sm font-medium">Or pick from your library</Label>
                      <input
                        type="text"
                        value={blogSearch}
                        onChange={e => setBlogSearch(e.target.value)}
                        placeholder="Search saved posts…"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        data-testid="input-blog-search"
                      />
                      {(() => {
                        const q = blogSearch.trim().toLowerCase();
                        const filtered = q
                          ? blogAssets.filter(a => a.title.toLowerCase().includes(q) || (a.url || "").toLowerCase().includes(q))
                          : blogAssets;
                        if (filtered.length === 0) {
                          return <p className="text-xs text-muted-foreground py-2 text-center">No posts matching "{blogSearch}"</p>;
                        }
                        return (
                          <div className="max-h-[120px] overflow-y-auto border rounded-md bg-background divide-y">
                            {filtered.map(asset => (
                              <button
                                key={asset.id}
                                onClick={() => setBlogAssetId(blogAssetId === asset.id ? null : asset.id)}
                                className={`w-full flex flex-col items-start px-3 py-2 text-left transition-colors ${blogAssetId === asset.id ? "bg-primary/10" : "hover:bg-muted/50"}`}
                                data-testid={`button-blog-asset-${asset.id}`}
                              >
                                <span className={`text-sm font-medium line-clamp-1 ${blogAssetId === asset.id ? "text-primary" : ""}`}>{asset.title}</span>
                                <span className="text-xs text-muted-foreground truncate w-full">
                                  {(() => { try { return new URL(asset.url!).hostname; } catch { return asset.url; } })()}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {blogAssetId && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 border-t pt-2">
                    <Sparkles className="w-3 h-3 text-primary flex-shrink-0" />
                    AI reads the post and generates promotion-ready posts — one per angle (insight, question, story, tip, CTA, and more).
                  </p>
                )}
              </div>
            )}

            {/* One post per asset — asset mode only, only shown when assets exist */}
            {generateMode === "asset" && campaign && campaign.assets.length > 1 && (
              <label className="flex items-start gap-2 cursor-pointer text-sm rounded-lg border p-3 hover:bg-muted/30 transition-colors" data-testid="toggle-one-post-per-asset-label">
                <Checkbox
                  checked={onePostPerAsset}
                  onCheckedChange={(v) => setOnePostPerAsset(!!v)}
                  className="mt-0.5"
                  data-testid="checkbox-one-post-per-asset"
                />
                <div>
                  <span className="font-medium">One post per asset</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Guarantee that every pinned asset gets at least one post on each platform before generating extras. Ideal for product campaigns where each item needs its own promotion.
                    {onePostPerAsset && campaign.assets.length > 0 && (
                      <span className="block mt-1 text-primary">
                        Will generate at least {campaign.assets.length} variant{campaign.assets.length !== 1 ? "s" : ""} per channel — one for each of the {campaign.assets.length} pinned assets.
                      </span>
                    )}
                  </p>
                </div>
              </label>
            )}

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

            {/* Social Account Targeting */}
            {campaign && campaign.socialAccounts.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Target accounts</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">Posts will be generated for the selected accounts. Deselect any you want to skip.</p>
                <div className="flex flex-wrap gap-1.5">
                  {campaign.socialAccounts.map(csa => {
                    const account = allSocialAccounts.find(a => a.id === csa.socialAccountId);
                    if (!account) return null;
                    // null = all selected; explicit array = check membership
                    const selected = generateDialogAccountIds === null || generateDialogAccountIds.includes(account.id);
                    return (
                      <Badge
                        key={account.id}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer gap-1"
                        onClick={() => {
                          if (generateDialogAccountIds === null) {
                            // Currently "all" — deselecting one switches to all-except-this
                            setGenerateDialogAccountIds(
                              campaign.socialAccounts
                                .map(c => c.socialAccountId)
                                .filter(sid => sid !== account.id)
                            );
                          } else if (selected) {
                            setGenerateDialogAccountIds(prev => (prev as string[]).filter(x => x !== account.id));
                          } else {
                            setGenerateDialogAccountIds(prev => [...(prev as string[]), account.id]);
                          }
                        }}
                        data-testid={`badge-gen-account-${account.id}`}
                      >
                        {account.platform} — {account.accountName}
                      </Badge>
                    );
                  })}
                </div>
                {generateDialogAccountIds !== null && generateDialogAccountIds.length < campaign.socialAccounts.length && (
                  <button
                    className="text-xs text-primary mt-1.5 hover:underline"
                    onClick={() => setGenerateDialogAccountIds(null)}
                    data-testid="button-gen-select-all-accounts"
                  >
                    Select all accounts
                  </button>
                )}
                {generateDialogAccountIds !== null && generateDialogAccountIds.length === 0 && (
                  <p className="text-xs text-destructive mt-1">Select at least one account to generate posts.</p>
                )}
              </div>
            )}

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
                            <img src={thumbnailUrl(imgUrl, 320)} srcSet={buildSrcSet(imgUrl, [240, 320, 480])} sizes="(max-width: 640px) 50vw, 160px" alt={ba.name} className="w-full h-20 object-cover" loading="lazy" />
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
            <Button variant="outline" onClick={() => { saveAccountIds(id, generateDialogAccountIds); setGenerateDialogOpen(false); setSelectedBrandImageIds([]); setSelectedPersonaIds([]); setGenerateDialogAccountIds(null); setBrandCategoryFilter("all"); setBrandPage(0); setThematicBrief(""); setThematicUrl(""); setBlogAssetId(null); setBlogSearch(""); setBlogImportUrl(""); setBlogImportStatus("idle"); setBlogImportError(""); setGenerateMode("asset"); setWrapPostLinks(false); setVariantsPerPlatform(null); setSelectedBriefId(null); setOnePostPerAsset(false); }} data-testid="button-cancel-generate">Cancel</Button>
            <Button
              onClick={() => generatePostsMutation.mutate({
                brandImageIds: selectedBrandImageIds.length > 0 ? selectedBrandImageIds : undefined,
                personaIds: selectedPersonaIds.length > 0 ? selectedPersonaIds : undefined,
                thematicBrief: generateMode === "thematic" ? thematicBrief : undefined,
                thematicUrl: generateMode === "thematic" ? thematicUrl : undefined,
                blogAssetId: generateMode === "blog" ? (blogAssetId ?? undefined) : undefined,
                wrapLinks: wrapPostLinks,
                variantsPerPlatform: generateMode === "blog" ? 5 : variantsPerPlatform,
                sourceBriefId: selectedBriefId,
                accountIds: generateDialogAccountIds,
                onePostPerAsset: generateMode === "asset" ? onePostPerAsset : false,
              })}
              disabled={generatePostsMutation.isPending || isGenerating || (generateMode === "thematic" && !thematicBrief.trim()) || (generateMode === "blog" && !blogAssetId) || (generateDialogAccountIds !== null && generateDialogAccountIds.length === 0)}
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
                      <span>CSV-scheduled posts:</span>
                      <span className="font-medium">{exportPreview.totalPosts}</span>
                    </div>
                    {exportPreview.orbitCount > 0 && (
                      <div className="flex justify-between text-blue-600">
                        <span>Orbit-scheduled (excluded):</span>
                        <span className="font-medium">{exportPreview.orbitCount}</span>
                      </div>
                    )}
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
                {exportPreview && exportPreview.orbitCount > 0 && (
                  <div className="rounded-md border border-blue-200 p-3 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-900 text-sm">
                    <p className="font-medium text-blue-800 dark:text-blue-200 mb-0.5">Orbit posts excluded</p>
                    <p className="text-blue-700 dark:text-blue-300 text-xs">
                      {exportPreview.orbitCount} post{exportPreview.orbitCount !== 1 ? "s are" : " is"} marked for Orbit direct posting and will not appear in this CSV. To include them, change their delivery mode to "CSV only" using the Select button above.
                    </p>
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

      {/* Link existing published blog post dialog */}
      <Dialog open={linkPostOpen} onOpenChange={(o) => {
        if (!o) { setLinkPostUrl(""); setLinkPostTitle(""); setSynozurSearch(""); setSynozurSearchTerm(""); }
        setLinkPostOpen(o);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4" /> Link existing blog post</DialogTitle>
            <DialogDescription>Paste the published URL of a blog post to track it in this campaign.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="link-post-title">Post title <span className="text-destructive">*</span></Label>
              <Input
                id="link-post-title"
                placeholder="The title of the published post"
                value={linkPostTitle}
                onChange={(e) => setLinkPostTitle(e.target.value)}
                autoFocus
                data-testid="input-link-post-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-post-url">Published URL</Label>
              <Input
                id="link-post-url"
                placeholder="https://example.com/insights/my-post"
                value={linkPostUrl}
                onChange={(e) => setLinkPostUrl(e.target.value)}
                data-testid="input-link-post-url"
              />
            </div>
            {(websiteStatus as any)?.connected && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Or pick a post from Synozur</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Search Synozur posts…"
                    value={synozurSearch}
                    onChange={(e) => setSynozurSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") setSynozurSearchTerm(synozurSearch); }}
                    className="flex-1"
                    data-testid="input-synozur-search"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSynozurSearchTerm(synozurSearch)}
                    disabled={synozurPostsFetching}
                    data-testid="button-synozur-search"
                  >
                    {synozurPostsFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                  </Button>
                </div>
                {synozurPosts && synozurPosts.length > 0 && (
                  <div className="max-h-48 overflow-y-auto border rounded-md divide-y" data-testid="list-synozur-posts">
                    {synozurPosts.map((post) => (
                      <button
                        key={post.id}
                        className="w-full text-left px-3 py-2 hover:bg-accent transition-colors text-sm"
                        onClick={() => {
                          linkSynozurPostMutation.mutate(post);
                        }}
                        disabled={linkSynozurPostMutation.isPending}
                        data-testid={`button-synozur-post-${post.id}`}
                      >
                        <div className="font-medium line-clamp-1">{post.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {post.status}
                          {post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleDateString()}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {synozurPosts && synozurPosts.length === 0 && synozurSearchTerm && !synozurPostsFetching && (
                  <p className="text-xs text-muted-foreground">No posts found for "{synozurSearchTerm}".</p>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setLinkPostOpen(false)} data-testid="button-cancel-link-post">Cancel</Button>
            <Button
              disabled={!linkPostTitle.trim() || linkPostMutation.isPending}
              onClick={() => linkPostMutation.mutate()}
              data-testid="button-confirm-link-post"
            >
              {linkPostMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Link post
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hub tab dialogs */}
      {id && (
        <>
          <AttachDialog open={hubAttachOpen} onOpenChange={setHubAttachOpen} scope="campaign" id={id} onDone={refreshHub} />
          <CreateActionDialog open={hubCreateOpen} onOpenChange={setHubCreateOpen} scope="campaign" id={id} onDone={refreshHub} />
        </>
      )}

      {/* Link event picker dialog */}
      <Dialog open={linkEventOpen} onOpenChange={(o) => { setLinkEventOpen(o); if (!o) setLinkEventSearch(""); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-link-event">
          <DialogHeader>
            <DialogTitle>Link an event</DialogTitle>
            <DialogDescription>
              Associate an existing conference or event with this campaign. Only unlinked events are shown.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search events…"
              value={linkEventSearch}
              onChange={(e) => setLinkEventSearch(e.target.value)}
              data-testid="input-link-event-search"
            />
            <div className="max-h-72 overflow-y-auto border rounded-md divide-y" data-testid="list-link-event-options">
              {(() => {
                const linkedIds = new Set(linkedEvents.map((e) => e.id));
                const filtered = allConferences.filter((c) => {
                  if (linkedIds.has(c.id)) return false; // already linked to this campaign
                  if (c.campaignId && c.campaignId !== id) return false; // linked to another campaign
                  if (linkEventSearch.trim()) {
                    return c.name.toLowerCase().includes(linkEventSearch.toLowerCase());
                  }
                  return true;
                });
                if (filtered.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground px-3 py-4">
                      {linkEventSearch.trim() ? "No matching events found." : "No unlinked events available."}
                    </p>
                  );
                }
                return filtered.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors text-sm flex items-center justify-between gap-3"
                    onClick={() => linkEventMutation.mutate(c.id)}
                    disabled={linkEventMutation.isPending}
                    data-testid={`button-link-event-option-${c.id}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      {c.startDate && (
                        <div className="text-xs text-muted-foreground">{format(new Date(c.startDate), "MMM d, yyyy")}</div>
                      )}
                    </div>
                    {linkEventMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-muted-foreground" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ));
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkEventOpen(false)} data-testid="button-cancel-link-event">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink event confirmation dialog */}
      <AlertDialog open={!!unlinkEventConfirmId} onOpenChange={(o) => { if (!o) setUnlinkEventConfirmId(null); }}>
        <AlertDialogContent data-testid="dialog-unlink-event-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink event?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const ev = linkedEvents.find((e) => e.id === unlinkEventConfirmId);
                return ev
                  ? `"${ev.name}" will no longer be associated with this campaign. The event itself and its posts are not deleted.`
                  : "The event will no longer be associated with this campaign.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-unlink-event">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => unlinkEventConfirmId && unlinkEventMutation.mutate(unlinkEventConfirmId)}
              disabled={unlinkEventMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-unlink-event"
            >
              {unlinkEventMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
