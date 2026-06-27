import { useState, useEffect, useRef, useCallback } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarDays,
  ClipboardList,
  Loader2,
  Sparkles,
  PenLine,
  Trash2,
  Copy,
  AlertTriangle,
  Share2,
  Search,
  CalendarClock,
  Library,
  Save,
  FileDown,
  Download,
  Image as ImageIcon,
  RefreshCw,
  X,
  FileText,
  Link2,
  Globe,
  Mic,
  CheckCircle2,
  Lightbulb,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { FeatureGate } from "@/components/UpgradePrompt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { RepurposeDialog } from "@/components/marketing/RepurposeDialog";
import { WebsitePublishDialog } from "@/components/marketing/WebsitePublishDialog";
import { isSocialBriefFormat } from "@shared/schema";

/** Convert Word/browser HTML to Markdown so paste preserves links and headings. */
function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "ul") {
      return Array.from(el.children).filter(c => c.tagName.toLowerCase() === "li")
        .map(li => `- ${walk(li).trim()}`).join("\n") + "\n\n";
    }
    if (tag === "ol") {
      return Array.from(el.children).filter(c => c.tagName.toLowerCase() === "li")
        .map((li, i) => `${i + 1}. ${walk(li).trim()}`).join("\n") + "\n\n";
    }
    const inner = Array.from(el.childNodes).map(walk).join("");
    switch (tag) {
      case "h1": return `# ${inner.trim()}\n\n`;
      case "h2": return `## ${inner.trim()}\n\n`;
      case "h3": return `### ${inner.trim()}\n\n`;
      case "h4": case "h5": case "h6": return `**${inner.trim()}**\n\n`;
      case "p": return `${inner.trim()}\n\n`;
      case "br": return "\n";
      case "strong": case "b": return `**${inner}**`;
      case "em": case "i": return `*${inner}*`;
      case "a": { const href = el.getAttribute("href") ?? ""; return href ? `[${inner}](${href})` : inner; }
      case "code": return `\`${inner}\``;
      case "pre": return `\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
      case "blockquote": return `> ${inner.trim()}\n\n`;
      case "hr": return `---\n\n`;
      default: return inner;
    }
  }
  return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}

interface ContentBrief {
  id: string;
  calendarId: string;
  title: string;
  format: string;
  targetKeyword: string | null;
  demandSignal: string | null;
  funnelStage: string;
  differentiationAngle: string | null;
  targetReader: string | null;
  cta: string | null;
  channels: string[] | null;
  estimatedHours: number | null;
  status: string;
  contentAssetId: string | null;
  campaignId: string | null;
  campaignStatus: string | null;
  solutionAreaId: string | null;
  draftTitle: string | null;
  draftCategoryId: string | null;
  pushedToPlanner?: boolean;
}

interface NamedRow {
  id: string;
  name: string;
  status?: string;
}

interface EditorialCalendar {
  id: string;
  name: string;
  focus: string | null;
  status: string;
  createdAt: string;
}

interface DraftResult {
  title: string | null;
  subtitle: string | null;
  overview: string | null;
  body: string;
  meta: string | null;
  tags: string | null;
  format: string;
}

interface RepurposeVariantResult {
  id: string;
  platform: string;
  content: string;
  hashtags: string[];
  imagePrompt?: string | null;
  overrideImageUrl?: string | null;
}

interface CarouselSlideImage {
  index: number;
  headline: string;
  fileUrl: string;
}

interface MarketingPlan {
  id: string;
  name: string;
  fiscalYear?: string;
}

interface ScheduleRow {
  briefId: string;
  title: string;
  format: string;
  channel: string;
  scheduledAt: string;
  timeframe: string;
}

interface OptimizationResult {
  seoTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  targetKeyword: string | null;
  keywords: string[] | null;
  answerBlocks: { question: string; answer: string }[] | null;
  faq: { question: string; answer: string }[] | null;
  internalLinks: { anchorText: string; targetTitle: string; reason: string }[] | null;
  contentGaps: string[] | null;
}

const FORMAT_LABELS: Record<string, string> = {
  blog_post: "Blog",
  landing_page: "Landing page",
  linkedin_post: "LinkedIn",
  x_post: "X / Twitter",
  newsletter: "Newsletter",
  video_script: "Video script",
  case_study: "Case study",
  whitepaper: "Whitepaper",
  ebook: "Ebook",
  podcast_outline: "Podcast outline",
  webinar: "Webinar",
  press_release: "Press release",
  linkedin_digest: "LinkedIn Digest",
  other: "Other",
};

// Brief formats a user can pick from per brief. Mirrors CONTENT_BRIEF_FORMATS.
const BRIEF_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "blog_post", label: "Blog" },
  { value: "landing_page", label: "Landing page" },
  { value: "linkedin_post", label: "LinkedIn" },
  { value: "x_post", label: "X / Twitter" },
  { value: "newsletter", label: "Newsletter" },
  { value: "video_script", label: "Video script" },
  { value: "case_study", label: "Case study" },
  { value: "whitepaper", label: "Whitepaper" },
  { value: "ebook", label: "Ebook" },
  { value: "podcast_outline", label: "Podcast outline" },
  { value: "webinar", label: "Webinar" },
  { value: "press_release", label: "Press release" },
  { value: "linkedin_digest", label: "LinkedIn Digest" },
  { value: "other", label: "Other" },
];

const FUNNEL_LABELS: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
};

const FUNNEL_BADGE: Record<string, string> = {
  awareness: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  consideration: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  decision: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};

// Ordered content lifecycle: suggested → … → posted. "removed" sits outside
// the flow (a brief that was dropped). Labels are user-friendly; values match
// the persisted brief.status.
const LIFECYCLE: { value: string; label: string }[] = [
  { value: "suggested", label: "Suggested" },
  { value: "accepted", label: "Accepted" },
  { value: "in_progress", label: "In progress" },
  { value: "drafted", label: "Drafted" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Posted" },
];
const STATUS_OPTIONS = [...LIFECYCLE.map((s) => s.value), "removed"];
const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(LIFECYCLE.map((s) => [s.value, s.label])),
  removed: "Removed",
};
const STATUS_BADGE: Record<string, string> = {
  suggested: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  accepted: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  in_progress: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  drafted: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  approved: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  scheduled: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  removed: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
};

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

// A brief can be finalized once it has a drafted asset and hasn't already moved
// past approval. Shared by the per-card Finalize button and the campaign-scoped
// "Finalize all drafted" bulk action so the two stay exactly in sync.
function canFinalizeBrief(b: { contentAssetId?: string | null; status: string }): boolean {
  return !!b.contentAssetId && !["approved", "scheduled", "published", "removed"].includes(b.status);
}

export default function EditorialCalendarPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  // Honor a ?brief=<id> deep link (e.g. "Open editor" from the Master Calendar):
  // once the brief's card renders, scroll to it and briefly highlight it.
  const [focusBriefId, setFocusBriefId] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("brief")
      : null,
  );
  // Honor a ?campaignId=<id> deep link (e.g. from the campaign interview /
  // marketing calendar) — scope the visible briefs to that campaign. Also drives
  // the campaign review surface (counts + bulk finalize). null = all campaigns.
  const [campaignFilter, setCampaignFilter] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("campaignId")
      : null,
  );
  const [formatFilter, setFormatFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Copy-to-campaign dialog state
  const [copyBriefId, setCopyBriefId] = useState<string | null>(null);
  const [copyTargetCampaignId, setCopyTargetCampaignId] = useState<string>("");
  const [copyNewCampaignName, setCopyNewCampaignName] = useState<string>("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState(15);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);
  const [draftBriefTitle, setDraftBriefTitle] = useState<string | null>(null);
  const [openingDraftId, setOpeningDraftId] = useState<string | null>(null);
  const [draftImageUrl, setDraftImageUrl] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftAssetDescription, setDraftAssetDescription] = useState<string | null>(null);
  const [draftAssetWebsiteSlug, setDraftAssetWebsiteSlug] = useState<string | null>(null);
  const [draftAssetWebsiteStatus, setDraftAssetWebsiteStatus] = useState<string | null>(null);
  const [draftAssetWebsiteScheduledFor, setDraftAssetWebsiteScheduledFor] = useState<string | null>(null);
  const [websitePublishOpen, setWebsitePublishOpen] = useState(false);
  // Blog-post structured metadata panel state (auto-saved on change)
  const [blogSeoTitle, setBlogSeoTitle] = useState<string>("");
  const [blogMetaDescription, setBlogMetaDescription] = useState<string>("");
  const [blogSeoSlug, setBlogSeoSlug] = useState<string>("");
  const [blogExcerpt, setBlogExcerpt] = useState<string>("");
  const [blogHeroUrl, setBlogHeroUrl] = useState<string>("");
  const [blogAuthorId, setBlogAuthorId] = useState<string>("");
  const [blogCategoryIds, setBlogCategoryIds] = useState<Set<string>>(new Set());
  const [blogTagIds, setBlogTagIds] = useState<Set<string>>(new Set());
  const [aiRefOpen, setAiRefOpen] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [rewriteInstr, setRewriteInstr] = useState("");
  const [repurpose, setRepurpose] = useState<RepurposeVariantResult[] | null>(null);
  const [repurposeTarget, setRepurposeTarget] = useState<{ id: string; title?: string; calendarId?: string } | null>(null);
  // Per-brief "Do you have a guest in mind?" override for podcast outlines.
  const [podcastGuest, setPodcastGuest] = useState<Record<string, string>>({});
  const [carouselSlides, setCarouselSlides] = useState<{ assetId: string; title: string; slides: CarouselSlideImage[] } | null>(null);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  // "Schedule dates" dialog — spreads briefs across a date range, sets scheduledAt on each brief.
  const [distOpen, setDistOpen] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const in30Iso = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [distStart, setDistStart] = useState(todayIso);
  const [distEnd, setDistEnd] = useState(in30Iso);
  const [distSkipWeekends, setDistSkipWeekends] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleRow[] | null>(null);
  // Plan selection + commit result for the "Push to Planner" step inside the schedule dialog.
  const [distPlanId, setDistPlanId] = useState<string>("");
  const [committedPlan, setCommittedPlan] = useState<{ name: string; tasks: number; skipped?: number } | null>(null);

  const { data: tenant } = useQuery<{ features?: Record<string, boolean> } | null>({
    queryKey: ["/api/tenant/info"],
    queryFn: () => getJson("/api/tenant/info"),
  });
  const allowed = tenant?.features?.editorialCalendar !== false;
  const repurposeAllowed = tenant?.features?.contentRepurposing !== false;
  const optimizeAllowed = tenant?.features?.seoAeoOptimizer !== false;
  const distributionAllowed = tenant?.features?.distributionPlanner !== false;

  const isBlogDraftOpen = !!draft && draft.format === "blog_post";

  const { data: websiteStatus } = useQuery<{ connected: boolean; defaultAuthorId?: string | null }>({
    queryKey: ["/api/integrations/website/status"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/status", { credentials: "include" });
      return r.ok ? r.json() : { connected: false };
    },
    enabled: isBlogDraftOpen,
  });
  const websiteConnected = !!websiteStatus?.connected;

  const { data: websiteAuthors = [] } = useQuery<{ id: string; displayName: string }[]>({
    queryKey: ["/api/integrations/website/authors"],
    queryFn: async () => (await fetch("/api/integrations/website/authors", { credentials: "include" })).json(),
    enabled: isBlogDraftOpen && websiteConnected,
  });
  const { data: websiteCategories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/integrations/website/categories"],
    queryFn: async () => (await fetch("/api/integrations/website/categories", { credentials: "include" })).json(),
    enabled: isBlogDraftOpen && websiteConnected,
  });
  const { data: websiteTags = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/integrations/website/tags"],
    queryFn: async () => (await fetch("/api/integrations/website/tags", { credentials: "include" })).json(),
    enabled: isBlogDraftOpen && websiteConnected,
  });

  // Debounced PATCH for the blog-post metadata panel fields. Fires 300ms after
  // the last change. Does not require the user to click Save.
  // useRef keeps the timer stable across re-renders so clearTimeout actually
  // cancels the previous call (a plain object is recreated each render).
  const blogMetaPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchBlogMeta = useCallback((assetId: string, updates: Record<string, unknown>) => {
    if (blogMetaPatchTimer.current) clearTimeout(blogMetaPatchTimer.current);
    blogMetaPatchTimer.current = setTimeout(() => {
      fetch(`/api/content-assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      }).catch(() => {});
    }, 300);
  }, []);

  const { data: marketingPlans } = useQuery<MarketingPlan[]>({
    queryKey: ["/api/marketing-plans"],
    queryFn: async () => (await getJson("/api/marketing-plans")) ?? [],
    enabled: distOpen,
  });

  const { data: allBriefs, isLoading: briefsLoading } = useQuery<ContentBrief[]>({
    queryKey: ["/api/content-briefs"],
    queryFn: async () => (await getJson("/api/content-briefs")) ?? [],
    enabled: allowed,
  });

  const briefs = allBriefs ?? [];
  // Statuses / campaign statuses considered "closed" — hidden unless showAll=true.
  const CLOSED_CAMPAIGN_STATUSES = ["completed", "archived", "deleted"];
  const activeOnly = (b: ContentBrief) =>
    b.status !== "removed" && !CLOSED_CAMPAIGN_STATUSES.includes(b.campaignStatus ?? "");
  // Apply default hide-closed filter, then campaign + format filters.
  const visibleBriefs = briefs.filter((b) => {
    if (!showAll && !activeOnly(b)) return false;
    if (campaignFilter && b.campaignId !== campaignFilter) return false;
    if (formatFilter && b.format !== formatFilter) return false;
    return true;
  });
  const hiddenCount = briefs.filter((b) => !activeOnly(b)).length;

  // Once the deep-linked brief's card is in the DOM, scroll to it and —
  // if the brief already has a drafted asset — open the editor automatically
  // so the user lands directly in the content instead of a highlighted card.
  // Clear the highlight after a moment so it's a one-time cue.
  useEffect(() => {
    if (!focusBriefId) return;
    const brief = briefs.find((b) => b.id === focusBriefId);
    if (!brief) return;
    const el = document.querySelector(`[data-testid="brief-${focusBriefId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Auto-open the draft so "Open editor" from the Master Calendar lands
      // the user directly in the editor rather than a bare highlighted card.
      if (brief.contentAssetId) void openDraft(brief);
      const t = setTimeout(() => setFocusBriefId(null), 2500);
      return () => clearTimeout(t);
    }
  // openDraft is excluded from deps intentionally — it only calls stable
  // setState setters and an imported getJson, so no stale-closure risk.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBriefId, briefs]);

  // Assignment options — campaigns, themes (solution areas), and categories.
  // These are gated behind their own features; when unavailable the lists are
  // simply empty and the selects show nothing to pick.
  const { data: campaignOptions } = useQuery<NamedRow[]>({
    // All non-deleted campaigns — used for filter dropdown and assign picker.
    // Includes draft, active, completed, archived so users can find any brief.
    queryKey: ["/api/campaigns", "all-picker"],
    queryFn: async () => {
      const all: NamedRow[] = (await getJson("/api/campaigns")) ?? [];
      // Exclude deleted; dedupe by name
      const seen = new Set<string>();
      return all
        .filter((c) => c.status !== "deleted")
        .filter((c) => {
          const key = (c.name ?? "").trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    },
    enabled: allowed,
  });
  const { data: themeOptions } = useQuery<NamedRow[]>({
    queryKey: ["/api/solution-areas"],
    queryFn: async () => (await getJson("/api/solution-areas")) ?? [],
    enabled: allowed,
  });
  const { data: categoryOptions } = useQuery<NamedRow[]>({
    queryKey: ["/api/content-categories"],
    queryFn: async () => (await getJson("/api/content-categories")) ?? [],
    enabled: allowed,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/editorial-calendars/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ focus: focus.trim() || undefined, count }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to generate calendar");
      return res.json();
    },
    onSuccess: (data: { calendar: EditorialCalendar; warnings?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      setGenerateOpen(false);
      setFocus("");
      toast.success(`Generated "${data.calendar.name}"`);
      (data.warnings ?? []).forEach((w) => toast.warning(w));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateBrief = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ContentBrief> }) => {
      const res = await fetch(`/api/content-briefs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update brief");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // One-click Finalize: approves the brief and its linked draft together, so
  // there's no separate "approve the brief" then "approve the draft" step.
  const finalizeBrief = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/content-briefs/${id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to finalize");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast.success("Draft approved — brief and content are now active.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Campaign-scoped bulk finalize — runs the same one-click Finalize across
  // every drafted brief in the active campaign.
  const finalizeAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/content-briefs/${id}/finalize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
          }).then(async (res) => {
            if (!res.ok) throw new Error((await res.json()).error || "Failed to finalize");
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      if (failed > 0) {
        toast.warning(`Approved ${total - failed} of ${total}; ${failed} could not be approved.`);
      } else {
        toast.success(`Approved ${total} piece${total === 1 ? "" : "s"}.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const draftBrief = useMutation({
    mutationFn: async (id: string) => {
      const guest = podcastGuest[id]?.trim();
      const res = await fetch(`/api/content-briefs/${id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(guest ? { guest } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to draft content");
      return res.json();
    },
    onSuccess: (data: { draft: DraftResult; asset?: { id: string; leadImageUrl?: string | null } }, briefId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      setDraft(data.draft);
      setDraftAssetId(data.asset?.id ?? null);
      setDraftBriefTitle(briefs.find((b) => b.id === briefId)?.title ?? null);
      setDraftImageUrl(data.asset?.leadImageUrl ?? null);
      if (data.draft.format === "blog_post") {
        setBlogSeoTitle("");
        setBlogMetaDescription("");
        setBlogSeoSlug("");
        setBlogExcerpt("");
        setBlogHeroUrl(data.asset?.leadImageUrl ?? "");
        setBlogAuthorId("");
        setBlogCategoryIds(new Set());
        setBlogTagIds(new Set());
        setAiRefOpen(false);
      }
      setDraftDirty(false);
      setRewriteInstr("");
      toast.success("Draft created — click to review and approve");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Re-open an already-generated draft in the editor without re-generating it.
  const openDraft = async (b: ContentBrief) => {
    if (!b.contentAssetId) return;
    setOpeningDraftId(b.id);
    try {
      const asset = await getJson(`/api/content-assets/${b.contentAssetId}`);
      if (!asset) {
        toast.error("Couldn't open the draft — it may have been deleted.");
        return;
      }
      setDraft({
        title: asset.title ?? null,
        subtitle: asset.subtitle ?? null,
        overview: asset.overview ?? null,
        body: asset.content ?? "",
        meta: asset.description ?? null,
        tags: asset.postTags ?? null,
        format: b.format,
      });
      setDraftAssetId(asset.id);
      setDraftBriefTitle(b.title);
      setDraftImageUrl(asset.leadImageUrl ?? null);
      setDraftAssetDescription(asset.description ?? null);
      setDraftAssetWebsiteSlug(asset.websitePostSlug ?? null);
      setDraftAssetWebsiteStatus(asset.websitePostStatus ?? null);
      setDraftAssetWebsiteScheduledFor(asset.websiteScheduledFor ?? null);
      // Blog-post metadata panel
      if (b.format === "blog_post") {
        setBlogSeoTitle(asset.seoTitle ?? "");
        setBlogMetaDescription(asset.metaDescription ?? "");
        setBlogSeoSlug(asset.seoSlug ?? "");
        setBlogExcerpt(asset.websiteExcerpt ?? "");
        setBlogHeroUrl(asset.leadImageUrl ?? "");
        setBlogAuthorId(asset.websiteAuthorId ?? "");
        setBlogCategoryIds(new Set(asset.websiteCategoryIds ?? []));
        setBlogTagIds(new Set(asset.websiteTagIds ?? []));
        setAiRefOpen(false);
      }
      setDraftDirty(false);
      setRewriteInstr("");
    } catch {
      toast.error("Couldn't open the draft.");
    } finally {
      setOpeningDraftId(null);
    }
  };

  // Assign the draft's library category. Category lives on the content asset,
  // so this is only available once a brief has been drafted.
  const assignCategory = useMutation({
    mutationFn: async ({ assetId, categoryId }: { assetId: string; categoryId: string | null }) => {
      const res = await fetch(`/api/content-assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ categoryId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to set category");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rewriteDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content-assets/${draftAssetId}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instructions: rewriteInstr }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to rewrite");
      return res.json();
    },
    onSuccess: (data: { body: string }) => {
      setDraft((d) => (d ? { ...d, body: data.body } : d));
      setRewriteInstr("");
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      toast.success("Draft rewritten");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!draftAssetId || !draft) throw new Error("No draft to save");
      const res = await fetch(`/api/content-assets/${draftAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: draft.title, content: draft.body, subtitle: draft.subtitle, overview: draft.overview, postTags: draft.tags }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save draft");
      return res.json();
    },
    onSuccess: () => {
      setDraftDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast.success("Draft saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateImage = useMutation({
    mutationFn: async () => {
      if (!draftAssetId) throw new Error("No draft to add an image to");
      const res = await fetch(`/api/content-assets/${draftAssetId}/generate-branded-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ headline: draft?.title || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to generate image");
      return res.json();
    },
    onSuccess: (row: { leadImageUrl: string | null }) => {
      setDraftImageUrl(row.leadImageUrl ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast.success("Branded image generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeImage = useMutation({
    mutationFn: async () => {
      if (!draftAssetId) throw new Error("No draft selected");
      const res = await fetch(`/api/content-assets/${draftAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ leadImageUrl: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to remove image");
      return res.json();
    },
    onSuccess: () => {
      setDraftImageUrl(null);
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast.success("Branded image removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadImage = async () => {
    if (!draftImageUrl) return;
    try {
      const res = await fetch(draftImageUrl);
      const blob = await res.blob();
      const ext = draftImageUrl.split(".").pop()?.split("?")[0] || "png";
      const safe = (draft?.title || "image").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "image";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${safe}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Could not download the image.");
    }
  };

  const downloadDocx = async () => {
    if (!draftAssetId) return;
    if (draftDirty) {
      toast.error("Save your changes first, then download.");
      return;
    }
    setDownloadingDocx(true);
    try {
      const res = await fetch(`/api/content-assets/${draftAssetId}/download/docx`, {
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "Failed to download Word document";
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (draft?.title || "Content_Draft").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Content_Draft";
      a.download = `${safe}_${new Date().toISOString().split("T")[0]}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Downloaded branded Word document");
    } catch (e: any) {
      toast.error(e?.message || "Failed to download Word document");
    } finally {
      setDownloadingDocx(false);
    }
  };

  const repurposeAsset = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(`/api/content-assets/${assetId}/repurpose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to repurpose");
      return res.json();
    },
    onSuccess: (data: { posts: RepurposeVariantResult[]; count: number; imagesGenerated?: number }) => {
      setRepurpose(data.posts);
      const imgNote = data.imagesGenerated ? ` with ${data.imagesGenerated} matched graphic${data.imagesGenerated === 1 ? "" : "s"}` : "";
      toast.success(`Created ${data.count} social drafts${imgNote} in the posts pipeline`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repurposeLongForm = useMutation({
    mutationFn: async ({ assetId, format }: { assetId: string; format: string }) => {
      const res = await fetch(`/api/content-assets/${assetId}/repurpose-longform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ format }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to repurpose");
      return res.json();
    },
    onSuccess: (data: { asset: { id: string; title: string }; slideImages?: CarouselSlideImage[] }) => {
      if (data.slideImages?.length) {
        setCarouselSlides({ assetId: data.asset.id, title: data.asset.title, slides: data.slideImages });
        toast.success(`Created "${data.asset.title}" with ${data.slideImages.length} branded slides`);
      } else {
        toast.success(`Draft created: "${data.asset.title}"${data.brief ? " — added to Content Briefs" : ""}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Regenerate the branded graphic for one repurposed social variant, optionally
  // with an edited headline. Updates that variant's image in place on success.
  const regenVariantImage = async (
    postId: string,
    idx: number,
    headline: string,
  ) => {
    const res = await fetch(`/api/generated-posts/${postId}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(headline ? { headline } : {}),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to regenerate graphic");
    const data: { imageUrl: string } = await res.json();
    setRepurpose((prev) =>
      prev ? prev.map((v, i) => (i === idx ? { ...v, overrideImageUrl: data.imageUrl } : v)) : prev,
    );
    toast.success("Graphic regenerated");
  };

  // Regenerate one carousel slide image, optionally with an edited
  // headline/subtitle. Updates the slide in place on success.
  const regenCarouselSlide = async (
    assetId: string,
    index: number,
    headline: string,
    subtitle: string,
  ) => {
    const res = await fetch(`/api/content-assets/${assetId}/regenerate-carousel-slide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        index,
        headline: headline || undefined,
        subtitle: subtitle || undefined,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to regenerate slide");
    const data: { index: number; headline: string; fileUrl: string } = await res.json();
    setCarouselSlides((prev) =>
      prev
        ? {
            ...prev,
            slides: prev.slides.map((s) =>
              s.index === index ? { ...s, fileUrl: data.fileUrl, headline: data.headline } : s,
            ),
          }
        : prev,
    );
    toast.success(`Slide ${index} regenerated`);
  };

  const LONGFORM_FORMATS: { value: string; label: string }[] = [
    { value: "blog_post", label: "Blog post" },
    { value: "newsletter", label: "Email newsletter" },
    { value: "video_script", label: "Video script" },
    { value: "video_shot_list", label: "Video shot list" },
    { value: "podcast_outline", label: "Podcast outline" },
    { value: "whitepaper", label: "Whitepaper" },
    { value: "carousel", label: "Social carousel" },
  ];

  const optimizeAsset = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(`/api/content/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contentAssetId: assetId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to optimize");
      return res.json();
    },
    onSuccess: (data: { optimization: OptimizationResult }) => {
      setOptimization(data.optimization);
      toast.success("SEO/AEO analysis ready");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const planDistribution = useMutation({
    mutationFn: async (planId?: string) => {
      const res = await fetch(`/api/editorial-calendars/none/distribution-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          periodStart: distStart,
          periodEnd: distEnd,
          skipWeekends: distSkipWeekends,
          planId: planId || undefined,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to plan distribution");
      return res.json();
    },
    onSuccess: (data: { schedule: ScheduleRow[]; committed: boolean; tasksCreated?: number; tasksSkipped?: number; plan?: { name: string } }) => {
      setSchedule(data.schedule);
      if (data.committed) {
        const created = data.tasksCreated ?? 0;
        const skipped = data.tasksSkipped ?? 0;
        setCommittedPlan({ name: data.plan?.name ?? "marketing plan", tasks: created, skipped });
        const skippedNote = skipped > 0 ? ` (skipped ${skipped} already in the project)` : "";
        if (created === 0 && skipped > 0) {
          toast.success(`All ${skipped} item${skipped === 1 ? "" : "s"} were already in "${data.plan?.name}" — nothing new to add.`);
        } else {
          toast.success(`Added ${created} task${created === 1 ? "" : "s"} to "${data.plan?.name}"${skippedNote} — open Marketing Projects to review.`);
        }
      } else {
        setCommittedPlan(null);
        toast.success(`Built a suggested schedule for ${data.schedule.length} item${data.schedule.length === 1 ? "" : "s"}.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBrief = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/content-briefs/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete brief");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      toast.success("Brief deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyBrief = useMutation({
    mutationFn: async ({ id, campaignId, newCampaignName }: { id: string; campaignId?: string; newCampaignName?: string }) => {
      const res = await fetch(`/api/content-briefs/${id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(campaignId ? { campaignId } : { newCampaignName }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to copy brief");
      return res.json() as Promise<{ campaignId: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${data.campaignId}/content-plan`] });
      setCopyBriefId(null);
      setCopyTargetCampaignId("");
      setCopyNewCampaignName("");
      toast.success("Brief copied to campaign");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // LinkedIn Digest dialog state — also opened via ?openDigest=1 deep link
  // (e.g. from the campaign Content Plan tab where the full editorial calendar is not in nav).
  const [digestOpen, setDigestOpen] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("openDigest") === "1"
      : false,
  );
  // Step 1 inputs
  const [digestProfileUrl, setDigestProfileUrl] = useState("");
  const [digestStartDate, setDigestStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [digestEndDate, setDigestEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Step 2 preview result
  const [digestPreview, setDigestPreview] = useState<{ postCount: number; posts: { text: string; postedAt: string }[] } | null>(null);
  const [digestFetching, setDigestFetching] = useState(false);
  const [digestCreating, setDigestCreating] = useState(false);
  // Set when the official LinkedIn API is active but no account is connected
  const [digestNoAccount, setDigestNoAccount] = useState(false);

  const [downloadingDraftId, setDownloadingDraftId] = useState<string | null>(null);
  const downloadDraftDocx = async (brief: ContentBrief) => {
    if (!brief.contentAssetId) return;
    setDownloadingDraftId(brief.id);
    try {
      const res = await fetch(`/api/content-assets/${brief.contentAssetId}/download/docx`, {
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "Failed to download draft Word document";
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = brief.title.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Content_Draft";
      a.download = `${safe}_Draft_${new Date().toISOString().split("T")[0]}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Downloaded draft Word document");
    } catch (e: any) {
      toast.error(e?.message || "Failed to download draft Word document");
    } finally {
      setDownloadingDraftId(null);
    }
  };

  const [downloadingBriefId, setDownloadingBriefId] = useState<string | null>(null);
  const downloadBriefDocx = async (brief: ContentBrief) => {
    setDownloadingBriefId(brief.id);
    try {
      const res = await fetch(`/api/content-briefs/${brief.id}/download/docx`, {
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "Failed to download Word document";
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = brief.title.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Content_Brief";
      a.download = `${safe}_${new Date().toISOString().split("T")[0]}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Downloaded branded Word document");
    } catch (e: any) {
      toast.error(e?.message || "Failed to download Word document");
    } finally {
      setDownloadingBriefId(null);
    }
  };


  // Funnel breakdown computed from the current briefs.
  const funnelCounts = visibleBriefs.reduce<Record<string, number>>((acc, b) => {
    acc[b.funnelStage] = (acc[b.funnelStage] ?? 0) + 1;
    return acc;
  }, {});
  const pct = (n: number) => (visibleBriefs.length ? Math.round((n / visibleBriefs.length) * 100) : 0);
  // Per-piece review tally for the scoped view: how many are drafted / approved.
  const reviewCounts = visibleBriefs.reduce(
    (acc, b) => {
      if (["approved", "scheduled", "published"].includes(b.status)) acc.approved += 1;
      else if (b.contentAssetId) acc.drafted += 1;
      else acc.notDrafted += 1;
      return acc;
    },
    { notDrafted: 0, drafted: 0, approved: 0 },
  );

  return (
    <AppLayout>
      <FeatureGate
        feature="Content Briefs"
        requiredPlan="Enterprise"
        isAllowed={allowed}
        description="Generate demand-scored content briefs grounded in your messaging framework, competitive gaps, personas, and SEO demand. Upgrade to unlock Content Briefs."
      >
        <div className="space-y-6 p-1">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <ClipboardList className="h-6 w-6 text-primary" />
                Content Briefs
              </h1>
              <p className="text-sm text-muted-foreground">
                Demand-scored content briefs grounded in your messaging framework, gaps, personas, and SEO demand.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDigestPreview(null);
                  setDigestOpen(true);
                }}
                data-testid="button-new-linkedin-digest"
              >
                <Library className="mr-2 h-4 w-4" />
                New LinkedIn Digest
              </Button>
              <Button onClick={() => setGenerateOpen(true)} data-testid="button-generate-calendar">
                <Sparkles className="mr-2 h-4 w-4" />
                Generate new briefs
              </Button>
            </div>
          </div>

          {/* How the planning surfaces fit together */}
          <Card className="border-dashed bg-muted/30">
            <CardContent className="grid gap-3 py-4 text-sm sm:grid-cols-3">
              <div>
                <p className="font-medium">🎯 Campaigns</p>
                <p className="text-muted-foreground">
                  Start here for a coordinated push. Use AI ideation to scan news and intelligence for ideas, then
                  generate briefs, emails, and social posts all under one campaign.
                </p>
              </div>
              <div>
                <p className="font-medium">📋 Content Briefs (here)</p>
                <p className="text-muted-foreground">
                  Plan and write the content itself. Drafts stay here in Content Briefs for review and approval — use
                  "Repurpose" to spin a draft into social posts, carousels, and more.
                </p>
              </div>
              <div>
                <p className="font-medium">🗓️ Content Calendar</p>
                <p className="text-muted-foreground">
                  The central day-by-day view for all scheduled content — social posts, emails, and content briefs
                  across every campaign.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Filters row: format picker + show-all toggle */}
          {briefs.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Select value={formatFilter ?? "__all__"} onValueChange={(v) => setFormatFilter(v === "__all__" ? null : v)}>
                <SelectTrigger className="w-[220px]" data-testid="select-format-filter">
                  <SelectValue placeholder="All formats" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All formats</SelectItem>
                  {Array.from(new Set(briefs.map((b) => b.format))).sort().map((fmt) => (
                    <SelectItem key={fmt} value={fmt}>
                      {FORMAT_LABELS[fmt] ?? fmt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={showAll ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setShowAll((v) => !v)}
                data-testid="button-show-all"
              >
                {showAll ? "Active only" : `Show all${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}`}
              </Button>
              {(campaignFilter || formatFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setCampaignFilter(null); setFormatFilter(null); }}
                  data-testid="button-clear-filters"
                >
                  <X className="mr-1 h-3 w-3" />
                  Clear filters
                </Button>
              )}
            </div>
          )}

          {/* Campaign filter + campaign-scoped review surface */}
          {briefs.length > 0 && (campaignOptions?.length ?? 0) > 0 && (
            <Card>
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">Campaign</span>
                  <Select
                    value={campaignFilter ?? "__all__"}
                    onValueChange={(v) => setCampaignFilter(v === "__all__" ? null : v)}
                  >
                    <SelectTrigger className="w-[260px]" data-testid="select-campaign-filter">
                      <SelectValue placeholder="All campaigns" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All campaigns</SelectItem>
                      {(() => {
                        const active = (campaignOptions ?? []).filter((c) => c.status === "active" || c.status === "draft");
                        const closed = (campaignOptions ?? []).filter((c) => c.status !== "active" && c.status !== "draft");
                        return (
                          <>
                            {active.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                            {active.length > 0 && closed.length > 0 && (
                              <SelectSeparator />
                            )}
                            {closed.map((c) => (
                              <SelectItem key={c.id} value={c.id} className="text-muted-foreground">
                                {c.name} ({c.status})
                              </SelectItem>
                            ))}
                          </>
                        );
                      })()}
                    </SelectContent>
                  </Select>
                  {campaignFilter && (
                    <span className="text-sm text-muted-foreground" data-testid="text-campaign-scope-count">
                      {visibleBriefs.length} piece{visibleBriefs.length === 1 ? "" : "s"} in this campaign
                    </span>
                  )}
                </div>

                {campaignFilter && (() => {
                  const counts: Record<string, number> = {};
                  for (const b of visibleBriefs) counts[b.status] = (counts[b.status] ?? 0) + 1;
                  const finalizable = visibleBriefs.filter(canFinalizeBrief);
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {Object.entries(counts).map(([status, n]) => (
                          <span
                            key={status}
                            className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? STATUS_BADGE.suggested}`}
                            data-testid={`review-count-${status}`}
                          >
                            {STATUS_LABELS[status] ?? status}: {n}
                          </span>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        disabled={finalizable.length === 0 || finalizeAll.isPending}
                        onClick={() => finalizeAll.mutate(finalizable.map((b) => b.id))}
                        data-testid="button-finalize-all"
                        title="Approve every drafted brief in this campaign and its draft in one step"
                      >
                        {finalizeAll.isPending ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1 h-4 w-4" />
                        )}
                        Approve all drafted ({finalizable.length})
                      </Button>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Funnel summary */}
          {visibleBriefs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {visibleBriefs.length} brief{visibleBriefs.length === 1 ? "" : "s"}
                  {campaignFilter && (
                    <span className="text-muted-foreground">
                      {" "}· {(campaignOptions ?? []).find((c) => c.id === campaignFilter)?.name ?? "campaign"}
                    </span>
                  )}{" "}
                  · funnel mix
                </CardTitle>
                <CardDescription>
                  Review status: {reviewCounts.notDrafted} not drafted · {reviewCounts.drafted} drafted · {reviewCounts.approved} approved
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4">
                {(["awareness", "consideration", "decision"] as const).map((stage) => (
                  <div key={stage} className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${FUNNEL_BADGE[stage]}`}>
                      {FUNNEL_LABELS[stage]}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {funnelCounts[stage] ?? 0} ({pct(funnelCounts[stage] ?? 0)}%)
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Briefs */}
          {briefsLoading ? (
            <p className="text-sm text-muted-foreground">Loading briefs…</p>
          ) : briefs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <ClipboardList className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">No briefs yet</p>
                  <p className="text-sm text-muted-foreground">
                    Generate demand-scored briefs or create a LinkedIn Digest to get started.
                  </p>
                </div>
                <Button onClick={() => setGenerateOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate new briefs
                </Button>
              </CardContent>
            </Card>
          ) : visibleBriefs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <p className="text-sm font-medium">No briefs match the current filters</p>
                <Button variant="outline" size="sm" onClick={() => { setCampaignFilter(null); setFormatFilter(null); }} data-testid="button-clear-filters-empty">
                  Clear filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {visibleBriefs.map((b) => (
                <Card key={b.id} data-testid={`brief-${b.id}`} className={focusBriefId === b.id ? "ring-2 ring-primary ring-offset-2" : undefined}>
                  <CardContent className="space-y-4 pt-5">
                    {/* ── PLAN ── The idea/spec: what to make and why, plus
                        plan-level controls. Kept distinct from the produced
                        draft (the Draft panel below) so it reads as "the plan,"
                        never as the artifact. */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        {/* Left meta block — fixed order so format / status line up
                            the same way on every card and the list scans cleanly.
                            Title leads; the key state badges sit on one consistent
                            row; secondary details (keyword, hours) drop to their
                            own muted line. Draft state lives in the Draft panel. */}
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <Lightbulb className="h-3.5 w-3.5" />
                            Plan
                          </div>
                          <p className="font-medium">{b.title}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${FUNNEL_BADGE[b.funnelStage] ?? ""}`}>
                              {FUNNEL_LABELS[b.funnelStage] ?? b.funnelStage}
                            </span>
                            <Badge variant="secondary">{FORMAT_LABELS[b.format] ?? b.format}</Badge>
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[b.status] ?? STATUS_BADGE.suggested}`}
                              data-testid={`status-badge-${b.id}`}
                            >
                              {STATUS_LABELS[b.status] ?? b.status}
                            </span>
                            {b.pushedToPlanner && (
                              <span
                                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20"
                                data-testid={`in-planner-${b.id}`}
                              >
                                <CalendarClock className="h-3 w-3" />
                                In Planner
                              </span>
                            )}
                          </div>
                          {(b.targetKeyword || b.estimatedHours != null) && (
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid={`brief-meta-${b.id}`}>
                              {b.targetKeyword && <span>🔑 {b.targetKeyword}</span>}
                              {b.estimatedHours != null && <span>~{b.estimatedHours}h</span>}
                            </div>
                          )}
                          {isSocialBriefFormat(b.format) && (
                            <p
                              className="flex items-start gap-1.5 text-xs text-muted-foreground"
                              data-testid={`social-signpost-${b.id}`}
                            >
                              <Share2 className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>
                                Targets social. The draft is produced in the Draft panel below — use{" "}
                                <span className="font-medium">Repurpose</span> there to turn it into a schedulable Social Post.
                              </span>
                            </p>
                          )}
                        </div>
                        {/* Plan-level controls only: format/status of the idea, the
                            brief export, copy, and delete. Draft actions live in the
                            Draft panel so the two decisions never sit on one row. */}
                        <div className="flex items-center gap-2">
                          <Select
                            value={b.format}
                            onValueChange={(v) => updateBrief.mutate({ id: b.id, updates: { format: v } })}
                          >
                            <SelectTrigger className="h-8 w-[150px]" data-testid={`format-${b.id}`}>
                              <SelectValue placeholder="Format" />
                            </SelectTrigger>
                            <SelectContent>
                              {BRIEF_FORMAT_OPTIONS.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={STATUS_OPTIONS.includes(b.status) ? b.status : undefined}
                            onValueChange={(v) => updateBrief.mutate({ id: b.id, updates: { status: v } })}
                          >
                            <SelectTrigger className="h-8 w-[130px]" data-testid={`status-${b.id}`}>
                              <SelectValue placeholder={b.status} />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {STATUS_LABELS[s] ?? s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={downloadingBriefId === b.id}
                            onClick={() => downloadBriefDocx(b)}
                            data-testid={`download-brief-${b.id}`}
                          >
                            {downloadingBriefId === b.id ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <FileDown className="mr-1 h-4 w-4" />
                            )}
                            Word
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCopyBriefId(b.id);
                              setCopyTargetCampaignId(b.campaignId ?? "");
                              setCopyNewCampaignName("");
                            }}
                            data-testid={`copy-brief-${b.id}`}
                          >
                            <Copy className="mr-1 h-4 w-4" />
                            Copy to…
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={deleteBrief.isPending && deleteBrief.variables === b.id}
                            onClick={() => {
                              if (confirm(`Permanently delete the brief "${b.title}"? This cannot be undone.`)) {
                                deleteBrief.mutate(b.id);
                              }
                            }}
                            data-testid={`delete-brief-${b.id}`}
                          >
                            {deleteBrief.isPending && deleteBrief.variables === b.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Polaris podcast outline: optional guest override. Blank =
                          the AI suggests a guest; a value overrides it throughout. */}
                      {b.format === "podcast_outline" && (
                        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
                          <Mic className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs font-medium text-muted-foreground">Do you have a guest in mind?</span>
                          <Input
                            value={podcastGuest[b.id] ?? ""}
                            onChange={(e) => setPodcastGuest((p) => ({ ...p, [b.id]: e.target.value }))}
                            placeholder="Name, title, company (leave blank to let AI suggest)"
                            className="h-8 flex-1 min-w-[220px]"
                            data-testid={`input-podcast-guest-${b.id}`}
                          />
                        </div>
                      )}

                      {/* Plan assignment: campaign + theme live on the brief (the
                          idea). Category lives on the produced draft, so it moved
                          into the Draft panel below. */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium uppercase text-muted-foreground">Assign</span>
                        <Select
                          value={b.campaignId ?? "__none__"}
                          onValueChange={(v) =>
                            updateBrief.mutate({ id: b.id, updates: { campaignId: v === "__none__" ? null : v } })
                          }
                        >
                          <SelectTrigger className="h-8 w-[180px]" data-testid={`assign-campaign-${b.id}`}>
                            <SelectValue placeholder="Campaign" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No campaign</SelectItem>
                            {(campaignOptions ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={b.solutionAreaId ?? "__none__"}
                          onValueChange={(v) =>
                            updateBrief.mutate({ id: b.id, updates: { solutionAreaId: v === "__none__" ? null : v } })
                          }
                        >
                          <SelectTrigger className="h-8 w-[180px]" data-testid={`assign-theme-${b.id}`}>
                            <SelectValue placeholder="Theme" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No theme</SelectItem>
                            {(themeOptions ?? []).map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <dl className="grid gap-2 text-sm sm:grid-cols-2">
                        {b.demandSignal && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">Demand signal</dt>
                            <dd>{b.demandSignal}</dd>
                          </div>
                        )}
                        {b.differentiationAngle && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">Differentiation</dt>
                            <dd>{b.differentiationAngle}</dd>
                          </div>
                        )}
                        {b.targetReader && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">Target reader</dt>
                            <dd>{b.targetReader}</dd>
                          </div>
                        )}
                        {b.cta && (
                          <div>
                            <dt className="text-xs font-medium uppercase text-muted-foreground">CTA</dt>
                            <dd>{b.cta}</dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    {/* ── DRAFT ── The produced output and the actions that operate
                        on the artifact (review, approve, repurpose, optimize). When
                        nothing has been produced yet, it's an explicit empty state
                        with a single "Generate draft" CTA — so "approve the idea"
                        and "approve the draft" are visibly different decisions. */}
                    <div className="rounded-md border bg-muted/30 p-3 space-y-3" data-testid={`draft-panel-${b.id}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <FileText className="h-3.5 w-3.5" />
                          Draft
                          {b.contentAssetId ? (
                            <span
                              className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium normal-case text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20"
                              data-testid={`linked-draft-${b.id}`}
                            >
                              <Link2 className="h-3 w-3" />
                              Ready
                            </span>
                          ) : (
                            <span
                              className="ml-1 inline-flex items-center gap-1 text-[10px] font-normal normal-case text-muted-foreground"
                              data-testid={`linked-draft-${b.id}`}
                            >
                              Not started
                            </span>
                          )}
                        </div>
                      </div>

                      {b.contentAssetId ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              disabled={openingDraftId === b.id}
                              onClick={() => openDraft(b)}
                              data-testid={`open-draft-${b.id}`}
                            >
                              {openingDraftId === b.id ? (
                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                              ) : (
                                <FileText className="mr-1 h-4 w-4" />
                              )}
                              Open draft
                            </Button>
                            {canFinalizeBrief(b) && (
                              <Button
                                size="sm"
                                disabled={finalizeBrief.isPending && finalizeBrief.variables === b.id}
                                onClick={() => finalizeBrief.mutate(b.id)}
                                data-testid={`finalize-${b.id}`}
                                title="Approve this draft as publish-ready and make it live in the library"
                              >
                                {finalizeBrief.isPending && finalizeBrief.variables === b.id ? (
                                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1 h-4 w-4" />
                                )}
                                Approve draft
                              </Button>
                            )}
                            {!isSocialBriefFormat(b.format) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={downloadingDraftId === b.id}
                                onClick={() => downloadDraftDocx(b)}
                                data-testid={`download-draft-${b.id}`}
                              >
                                {downloadingDraftId === b.id ? (
                                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                ) : (
                                  <FileDown className="mr-1 h-4 w-4" />
                                )}
                                Download draft
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={draftBrief.isPending && draftBrief.variables === b.id}
                              onClick={() => {
                                if (confirm("Regenerate the draft? This replaces the current draft text.")) {
                                  draftBrief.mutate(b.id);
                                }
                              }}
                              data-testid={`draft-${b.id}`}
                            >
                              {draftBrief.isPending && draftBrief.variables === b.id ? (
                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-1 h-4 w-4" />
                              )}
                              Re-draft
                            </Button>
                            {repurposeAllowed && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRepurposeTarget({ id: b.contentAssetId!, title: b.title, calendarId: b.calendarId })}
                                data-testid={`repurpose-${b.id}`}
                              >
                                <Share2 className="mr-1 h-4 w-4" />
                                Repurpose
                              </Button>
                            )}
                            {optimizeAllowed && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={optimizeAsset.isPending}
                                onClick={() => optimizeAsset.mutate(b.contentAssetId!)}
                                data-testid={`optimize-${b.id}`}
                              >
                                {optimizeAsset.isPending && optimizeAsset.variables === b.contentAssetId ? (
                                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                ) : (
                                  <Search className="mr-1 h-4 w-4" />
                                )}
                                SEO/AEO
                              </Button>
                            )}
                          </div>
                          {/* Category belongs to the produced draft, so it lives here. */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium uppercase text-muted-foreground">Category</span>
                            <Select
                              value={b.draftCategoryId ?? "__none__"}
                              disabled={assignCategory.isPending}
                              onValueChange={(v) =>
                                b.contentAssetId &&
                                assignCategory.mutate({ assetId: b.contentAssetId, categoryId: v === "__none__" ? null : v })
                              }
                            >
                              <SelectTrigger className="h-8 w-[180px]" data-testid={`assign-category-${b.id}`}>
                                <SelectValue placeholder="Category" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">No category</SelectItem>
                                {(categoryOptions ?? []).map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm text-muted-foreground">
                            No draft yet. Generate one from this plan when the idea is ready.
                          </p>
                          <Button
                            size="sm"
                            disabled={draftBrief.isPending && draftBrief.variables === b.id}
                            onClick={() => draftBrief.mutate(b.id)}
                            data-testid={`draft-${b.id}`}
                          >
                            {draftBrief.isPending && draftBrief.variables === b.id ? (
                              <>
                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                Drafting…
                              </>
                            ) : (
                              <>
                                <Sparkles className="mr-1 h-4 w-4" />
                                Generate draft
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Generate dialog */}
        <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate new briefs</DialogTitle>
              <DialogDescription>
                Creates a fresh batch of AI-generated briefs — these are added alongside any you already have. Briefs are planning documents, not calendar items. To get content onto the calendar, draft or repurpose a brief into an actual output (social post, email, etc.) — those outputs are what appear in the Content Calendar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="count">Number of briefs</Label>
                <Input
                  id="count"
                  type="number"
                  min={5}
                  max={30}
                  value={count}
                  onChange={(e) => setCount(Math.min(30, Math.max(5, Number(e.target.value) || 15)))}
                  data-testid="input-count"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="focus">Focus / guidance (optional)</Label>
                <Textarea
                  id="focus"
                  placeholder="e.g. Emphasize the new analytics module and target RevOps leaders"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  data-testid="input-focus"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setGenerateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-confirm-generate">
                {generate.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* LinkedIn Digest dialog */}
        <Dialog
          open={digestOpen}
          onOpenChange={(o) => {
            if (!o) {
              setDigestOpen(false);
              setDigestPreview(null);
              setDigestNoAccount(false);
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New LinkedIn Digest</DialogTitle>
              <DialogDescription>
                Pulls your public LinkedIn posts over a date range and synthesizes them into a structured digest draft, ready to export as a Word document or repurpose as a newsletter or article.
              </DialogDescription>
            </DialogHeader>

            {!digestPreview ? (
              /* Step 1 — URL + date range */
              <div className="space-y-4">
                {digestNoAccount && (
                  <div
                    className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-800 p-3 text-sm text-blue-800 dark:text-blue-200 flex items-start gap-2"
                    data-testid="banner-digest-no-account"
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                    <span>
                      Connect your LinkedIn account in{" "}
                      <strong>Settings → Social Accounts</strong> to use the official API.
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="digest-profile-url">Your LinkedIn profile URL</Label>
                  <Input
                    id="digest-profile-url"
                    placeholder="https://www.linkedin.com/in/yourname/"
                    value={digestProfileUrl}
                    onChange={(e) => setDigestProfileUrl(e.target.value)}
                    data-testid="input-digest-profile-url"
                  />
                  <p className="text-xs text-muted-foreground flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                    Your LinkedIn profile must be set to public for the post fetch to work.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="digest-start">Start date</Label>
                    <Input
                      id="digest-start"
                      type="date"
                      value={digestStartDate}
                      onChange={(e) => setDigestStartDate(e.target.value)}
                      data-testid="input-digest-start"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="digest-end">End date</Label>
                    <Input
                      id="digest-end"
                      type="date"
                      value={digestEndDate}
                      onChange={(e) => setDigestEndDate(e.target.value)}
                      data-testid="input-digest-end"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDigestOpen(false)}>Cancel</Button>
                  <Button
                    disabled={digestFetching || !digestProfileUrl.trim()}
                    onClick={async () => {
                      if (!digestProfileUrl.includes("linkedin.com/in/")) {
                        toast.error("Please enter a LinkedIn personal profile URL (linkedin.com/in/…).");
                        return;
                      }
                      setDigestFetching(true);
                      setDigestNoAccount(false);
                      try {
                        const res = await fetch("/api/linkedin-digest/preview", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({
                            profileUrl: digestProfileUrl.trim(),
                            startDate: digestStartDate,
                            endDate: digestEndDate,
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          if (data.errorCode === "NO_LINKEDIN_ACCOUNT") {
                            setDigestNoAccount(true);
                            return;
                          }
                          throw new Error(data.error || "Failed to fetch posts");
                        }
                        setDigestPreview(data);
                      } catch (e: any) {
                        toast.error(e.message || "Failed to fetch LinkedIn posts");
                      } finally {
                        setDigestFetching(false);
                      }
                    }}
                    data-testid="button-digest-fetch"
                  >
                    {digestFetching ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Fetching…</>
                    ) : (
                      <>Fetch posts</>
                    )}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              /* Step 2 — confirm post count and generate */
              <div className="space-y-4">
                {digestPreview.postCount === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                    No original posts found in that date range. Make sure the profile is public and the dates are correct, then try again.
                  </div>
                ) : (
                  <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                    <p className="text-sm font-medium" data-testid="text-digest-post-count">
                      {digestPreview.postCount} original post{digestPreview.postCount === 1 ? "" : "s"} found
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {digestStartDate} to {digestEndDate} · shares and reposts excluded
                    </p>
                    {digestPreview.posts[0] && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 italic">
                        "{digestPreview.posts[0].text.slice(0, 120)}{digestPreview.posts[0].text.length > 120 ? "…" : ""}"
                      </p>
                    )}
                  </div>
                )}
                <DialogFooter className="flex items-center justify-between gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDigestPreview(null)}>
                    ← Back
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { setDigestOpen(false); setDigestPreview(null); }}>
                      Cancel
                    </Button>
                    <Button
                      disabled={digestCreating || digestPreview.postCount === 0}
                      onClick={async () => {
                        setDigestCreating(true);
                        try {
                          const res = await fetch("/api/linkedin-digest/create", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({
                              profileUrl: digestProfileUrl.trim(),
                              startDate: digestStartDate,
                              endDate: digestEndDate,
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Failed to create digest");
                          queryClient.invalidateQueries({ queryKey: ["/api/content-briefs"] });
                          setDigestOpen(false);
                          setDigestPreview(null);
                          toast.success(`LinkedIn Digest created — "${data.draft?.title || "Digest"}" is ready to review in Content Briefs.`);
                          // Open the draft immediately if we have it.
                          if (data.brief?.contentAssetId) {
                            try {
                              const assetRes = await fetch(`/api/content-assets/${data.brief.contentAssetId}`, { credentials: "include" });
                              if (assetRes.ok) {
                                const asset = await assetRes.json();
                                setDraft({
                                  title: asset.title ?? data.draft?.title ?? null,
                                  subtitle: asset.subtitle ?? null,
                                  overview: asset.overview ?? null,
                                  body: asset.content ?? data.draft?.body ?? "",
                                  meta: asset.description ?? data.draft?.meta ?? null,
                                  tags: asset.postTags ?? null,
                                  format: "linkedin_digest",
                                });
                                setDraftAssetId(data.brief.contentAssetId);
                                setDraftBriefTitle(data.brief.title ?? null);
                                setDraftImageUrl(null);
                                setDraftDirty(false);
                              }
                            } catch (_) { /* non-critical, user can open from the list */ }
                          }
                        } catch (e: any) {
                          toast.error(e.message || "Failed to create LinkedIn Digest");
                        } finally {
                          setDigestCreating(false);
                        }
                      }}
                      data-testid="button-digest-generate"
                    >
                      {digestCreating ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating digest…</>
                      ) : (
                        <><Sparkles className="mr-2 h-4 w-4" />Generate digest</>
                      )}
                    </Button>
                  </div>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Draft viewer */}
        <Dialog
          open={!!draft}
          onOpenChange={(o) => {
            if (!o) {
              setDraft(null);
              setDraftAssetId(null);
              setDraftImageUrl(null);
              setDraftDirty(false);
              setRewriteInstr("");
              setDraftBriefTitle(null);
              setDraftAssetDescription(null);
              setDraftAssetWebsiteSlug(null);
              setDraftAssetWebsiteStatus(null);
              setDraftAssetWebsiteScheduledFor(null);
              setWebsitePublishOpen(false);
              setBlogSeoTitle("");
              setBlogMetaDescription("");
              setBlogSeoSlug("");
              setBlogExcerpt("");
              setBlogHeroUrl("");
              setBlogAuthorId("");
              setBlogCategoryIds(new Set());
              setBlogTagIds(new Set());
              setAiRefOpen(false);
            }
          }}
        >
          <DialogContent className={`max-h-[90vh] overflow-y-auto ${draft?.format === "blog_post" ? "max-w-5xl" : "max-w-2xl"}`}>
            <DialogHeader>
              <DialogTitle>Edit draft</DialogTitle>
              <DialogDescription>
                {draftBriefTitle ? (
                  <span className="inline-flex items-center gap-1" data-testid="text-draft-source-brief">
                    <Link2 className="h-3 w-3" />
                    From brief: <span className="font-medium">{draftBriefTitle}</span>
                  </span>
                ) : (
                  "This draft is linked to a Content Brief. Edit it here, then approve it from the brief card."
                )}
              </DialogDescription>
            </DialogHeader>
            {/* Two-column layout for blog posts; single column for everything else */}
            {draft?.format === "blog_post" ? (
              <div className="flex gap-5 min-h-0">
                {/* LEFT: title + body + AI reference block */}
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="draft-title" className="text-xs font-medium uppercase text-muted-foreground">
                      Title
                    </Label>
                    <Input
                      id="draft-title"
                      value={draft?.title ?? ""}
                      onChange={(e) => {
                        setDraft((d) => (d ? { ...d, title: e.target.value } : d));
                        setDraftDirty(true);
                      }}
                      data-testid="input-draft-title"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="draft-body" className="text-xs font-medium uppercase text-muted-foreground">
                      Body <span className="normal-case font-normal text-muted-foreground">(Markdown)</span>
                    </Label>
                    <Textarea
                      id="draft-body"
                      className="min-h-[380px] font-sans text-sm leading-relaxed"
                      value={draft?.body ?? ""}
                      onChange={(e) => {
                        setDraft((d) => (d ? { ...d, body: e.target.value } : d));
                        setDraftDirty(true);
                      }}
                      onPaste={(e) => {
                        const html = e.clipboardData.getData("text/html");
                        if (!html) return;
                        e.preventDefault();
                        const md = htmlToMarkdown(html);
                        const ta = e.currentTarget;
                        const start = ta.selectionStart ?? 0;
                        const end = ta.selectionEnd ?? 0;
                        const current = draft?.body ?? "";
                        const next = current.slice(0, start) + md + current.slice(end);
                        setDraft((d) => (d ? { ...d, body: next } : d));
                        setDraftDirty(true);
                        requestAnimationFrame(() => {
                          ta.selectionStart = ta.selectionEnd = start + md.length;
                        });
                      }}
                      data-testid="input-draft-body"
                    />
                  </div>
                  {/* Collapsible AI reference block for subtitle + overview */}
                  {(draft?.subtitle || draft?.overview) && (
                    <div className="rounded-md border border-dashed">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setAiRefOpen((o) => !o)}
                        data-testid="button-ai-ref-toggle"
                      >
                        {aiRefOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        AI draft reference — subtitle &amp; overview
                      </button>
                      {aiRefOpen && (
                        <div className="border-t px-3 py-2 space-y-2">
                          {draft?.subtitle && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Subtitle</p>
                              <p className="text-sm text-foreground">{draft.subtitle}</p>
                            </div>
                          )}
                          {draft?.overview && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Overview</p>
                              <p className="text-sm text-foreground whitespace-pre-wrap">{draft.overview}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* AI rewrite */}
                  {draftAssetId && (
                    <div className="space-y-2 rounded-md border p-3">
                      <Label htmlFor="rewrite-instr" className="text-sm font-medium">
                        AI rewrite
                      </Label>
                      <Textarea
                        id="rewrite-instr"
                        placeholder="e.g. Make it punchier, add a stat-led intro, cut to ~600 words"
                        value={rewriteInstr}
                        onChange={(e) => setRewriteInstr(e.target.value)}
                        data-testid="input-rewrite"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={rewriteDraft.isPending || !rewriteInstr.trim()}
                        onClick={() => rewriteDraft.mutate()}
                        data-testid="button-rewrite"
                      >
                        {rewriteDraft.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PenLine className="mr-2 h-4 w-4" />
                        )}
                        Rewrite draft
                      </Button>
                    </div>
                  )}
                </div>

                {/* RIGHT: metadata panel ~280px */}
                <div className="w-72 shrink-0 space-y-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metadata</p>

                  <div className="space-y-1">
                    <Label htmlFor="blog-excerpt" className="text-xs text-muted-foreground">Excerpt</Label>
                    <Textarea
                      id="blog-excerpt"
                      rows={3}
                      className="text-sm"
                      placeholder="Short summary for listing cards…"
                      value={blogExcerpt}
                      onChange={(e) => {
                        setBlogExcerpt(e.target.value);
                        if (draftAssetId) patchBlogMeta(draftAssetId, { websiteExcerpt: e.target.value });
                      }}
                      data-testid="input-blog-excerpt"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="blog-hero-url" className="text-xs text-muted-foreground">Hero image URL</Label>
                    <Input
                      id="blog-hero-url"
                      type="url"
                      placeholder="https://…"
                      value={blogHeroUrl}
                      onChange={(e) => {
                        setBlogHeroUrl(e.target.value);
                        const url = e.target.value.trim() || null;
                        if (draftAssetId) patchBlogMeta(draftAssetId, { leadImageUrl: url });
                        setDraftImageUrl(url);
                      }}
                      data-testid="input-blog-hero-url"
                    />
                    {draftImageUrl && (
                      <img src={draftImageUrl} alt="Hero preview" className="mt-1 w-full rounded border object-cover aspect-video" />
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="blog-seo-title" className="text-xs text-muted-foreground">SEO title</Label>
                    <Input
                      id="blog-seo-title"
                      placeholder="≤60 characters"
                      maxLength={60}
                      value={blogSeoTitle}
                      onChange={(e) => {
                        setBlogSeoTitle(e.target.value);
                        if (draftAssetId) patchBlogMeta(draftAssetId, { seoTitle: e.target.value });
                      }}
                      data-testid="input-blog-seo-title"
                    />
                    <p className="text-right text-[11px] text-muted-foreground">{blogSeoTitle.length}/60</p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="blog-seo-desc" className="text-xs text-muted-foreground">SEO description</Label>
                    <Textarea
                      id="blog-seo-desc"
                      rows={2}
                      placeholder="≤155 characters"
                      maxLength={155}
                      className="text-sm"
                      value={blogMetaDescription}
                      onChange={(e) => {
                        setBlogMetaDescription(e.target.value);
                        if (draftAssetId) patchBlogMeta(draftAssetId, { metaDescription: e.target.value });
                      }}
                      data-testid="input-blog-seo-desc"
                    />
                    <p className="text-right text-[11px] text-muted-foreground">{blogMetaDescription.length}/155</p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="blog-seo-slug" className="text-xs text-muted-foreground">SEO slug</Label>
                    <Input
                      id="blog-seo-slug"
                      placeholder="my-post-url-slug"
                      value={blogSeoSlug}
                      onChange={(e) => {
                        setBlogSeoSlug(e.target.value);
                        if (draftAssetId) patchBlogMeta(draftAssetId, { seoSlug: e.target.value });
                      }}
                      data-testid="input-blog-seo-slug"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="blog-tags" className="text-xs text-muted-foreground">Post tags <span className="font-normal">(comma-separated)</span></Label>
                    <Input
                      id="blog-tags"
                      placeholder="AI, SaaS, growth"
                      value={draft?.tags ?? ""}
                      onChange={(e) => {
                        setDraft((d) => (d ? { ...d, tags: e.target.value } : d));
                        setDraftDirty(true);
                        if (draftAssetId) patchBlogMeta(draftAssetId, { postTags: e.target.value || null });
                      }}
                      data-testid="input-draft-tags"
                    />
                  </div>

                  {/* Website-connected fields */}
                  {websiteConnected ? (
                    <>
                      {websiteAuthors.length > 0 && (
                        <div className="space-y-1">
                          <Label htmlFor="blog-author" className="text-xs text-muted-foreground">Author</Label>
                          <Select
                            value={blogAuthorId || "none"}
                            onValueChange={(v) => {
                              const val = v === "none" ? "" : v;
                              setBlogAuthorId(val);
                              if (draftAssetId) patchBlogMeta(draftAssetId, { websiteAuthorId: val || null });
                            }}
                          >
                            <SelectTrigger id="blog-author" data-testid="select-blog-author">
                              <SelectValue placeholder="Choose author…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {websiteAuthors.map((a) => (
                                <SelectItem key={a.id} value={a.id}>{a.displayName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {websiteCategories.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Categories</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {websiteCategories.map((c) => {
                              const sel = blogCategoryIds.has(c.id);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  aria-pressed={sel}
                                  onClick={() => {
                                    const next = new Set(blogCategoryIds);
                                    sel ? next.delete(c.id) : next.add(c.id);
                                    setBlogCategoryIds(next);
                                    if (draftAssetId) patchBlogMeta(draftAssetId, { websiteCategoryIds: Array.from(next) });
                                  }}
                                  className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  data-testid={`blog-category-${c.id}`}
                                >
                                  <Badge variant={sel ? "default" : "outline"} className="cursor-pointer text-xs">{c.name}</Badge>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {websiteTags.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Tags (website)</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {websiteTags.map((t) => {
                              const sel = blogTagIds.has(t.id);
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  aria-pressed={sel}
                                  onClick={() => {
                                    const next = new Set(blogTagIds);
                                    sel ? next.delete(t.id) : next.add(t.id);
                                    setBlogTagIds(next);
                                    if (draftAssetId) patchBlogMeta(draftAssetId, { websiteTagIds: Array.from(next) });
                                  }}
                                  className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  data-testid={`blog-tag-${t.id}`}
                                >
                                  <Badge variant={sel ? "default" : "outline"} className="cursor-pointer text-xs">{t.name}</Badge>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground rounded-md border border-dashed p-2">
                      Connect the Synozur website in Settings → Integrations to pick an author and sync categories and tags.
                    </p>
                  )}

                  {/* Branded image section */}
                  {draftAssetId && (
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Branded image</Label>
                        <span className="text-[11px] text-muted-foreground">Optional</span>
                      </div>
                      {draftImageUrl ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="secondary" disabled={generateImage.isPending} onClick={() => generateImage.mutate()} data-testid="button-regenerate-image">
                              {generateImage.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={removeImage.isPending} onClick={() => removeImage.mutate()} data-testid="button-remove-image">
                              {removeImage.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </Button>
                            <Button size="sm" variant="outline" onClick={downloadImage} data-testid="button-download-image">
                              <Download className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="secondary" className="w-full" disabled={generateImage.isPending} onClick={() => generateImage.mutate()} data-testid="button-generate-image">
                          {generateImage.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <ImageIcon className="mr-2 h-3 w-3" />}
                          Generate
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Original single-column layout for non-blog-post formats */
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="draft-title" className="text-xs font-medium uppercase text-muted-foreground">
                    Title
                  </Label>
                  <Input
                    id="draft-title"
                    value={draft?.title ?? ""}
                    onChange={(e) => {
                      setDraft((d) => (d ? { ...d, title: e.target.value } : d));
                      setDraftDirty(true);
                    }}
                    data-testid="input-draft-title"
                  />
                </div>
                {draft?.format === "linkedin_digest" && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="draft-subtitle" className="text-xs font-medium uppercase text-muted-foreground">
                        Subtitle
                      </Label>
                      <Input
                        id="draft-subtitle"
                        value={draft?.subtitle ?? ""}
                        placeholder="A single-sentence subtitle…"
                        onChange={(e) => {
                          setDraft((d) => (d ? { ...d, subtitle: e.target.value } : d));
                          setDraftDirty(true);
                        }}
                        data-testid="input-draft-subtitle"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="draft-overview" className="text-xs font-medium uppercase text-muted-foreground">
                        Overview <span className="normal-case font-normal">(preview blurb, max 480 chars)</span>
                      </Label>
                      <Textarea
                        id="draft-overview"
                        className="min-h-[80px] font-sans text-sm leading-relaxed"
                        maxLength={480}
                        value={draft?.overview ?? ""}
                        placeholder="A compelling summary shown as a post preview…"
                        onChange={(e) => {
                          setDraft((d) => (d ? { ...d, overview: e.target.value } : d));
                          setDraftDirty(true);
                        }}
                        data-testid="input-draft-overview"
                      />
                      <p className="text-right text-xs text-muted-foreground">{(draft?.overview ?? "").length}/480</p>
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <Label htmlFor="draft-body" className="text-xs font-medium uppercase text-muted-foreground">
                    Body
                  </Label>
                  <Textarea
                    id="draft-body"
                    className="min-h-[320px] font-sans text-sm leading-relaxed"
                    value={draft?.body ?? ""}
                    onChange={(e) => {
                      setDraft((d) => (d ? { ...d, body: e.target.value } : d));
                      setDraftDirty(true);
                    }}
                    onPaste={(e) => {
                      const html = e.clipboardData.getData("text/html");
                      if (!html) return;
                      e.preventDefault();
                      const md = htmlToMarkdown(html);
                      const ta = e.currentTarget;
                      const start = ta.selectionStart ?? 0;
                      const end = ta.selectionEnd ?? 0;
                      const current = draft?.body ?? "";
                      const next = current.slice(0, start) + md + current.slice(end);
                      setDraft((d) => (d ? { ...d, body: next } : d));
                      setDraftDirty(true);
                      requestAnimationFrame(() => {
                        ta.selectionStart = ta.selectionEnd = start + md.length;
                      });
                    }}
                    data-testid="input-draft-body"
                  />
                </div>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>AI-generated draft. Review and edit before publishing. Click Save to keep your changes.</span>
            </div>
            {isSocialBriefFormat(draft?.format) && draftAssetId && repurposeAllowed && (
              <div
                className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground sm:flex-row sm:items-center sm:justify-between"
                data-testid="draft-social-repurpose-prompt"
              >
                <div className="flex items-start gap-2">
                  <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    This draft is linked to its Content Brief. To turn it into a schedulable, publishable
                    Social Post, use <span className="font-medium">Repurpose</span>.
                  </span>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    const target = { id: draftAssetId, title: draft?.title ?? draftBriefTitle ?? undefined };
                    setDraft(null);
                    setDraftAssetId(null);
                    setDraftBriefTitle(null);
                    setDraftImageUrl(null);
                    setDraftDirty(false);
                    setRewriteInstr("");
                    setDraftAssetDescription(null);
                    setDraftAssetWebsiteSlug(null);
                    setDraftAssetWebsiteStatus(null);
                    setDraftAssetWebsiteScheduledFor(null);
                    setWebsitePublishOpen(false);
                    setRepurposeTarget(target);
                  }}
                  data-testid="button-draft-repurpose"
                >
                  <Share2 className="mr-1 h-4 w-4" />
                  Repurpose
                </Button>
              </div>
            )}
            {draft?.format !== "blog_post" && draftAssetId && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="rewrite-instr" className="text-sm font-medium">
                  AI rewrite
                </Label>
                <Textarea
                  id="rewrite-instr"
                  placeholder="e.g. Make it punchier, add a stat-led intro, cut to ~600 words"
                  value={rewriteInstr}
                  onChange={(e) => setRewriteInstr(e.target.value)}
                  data-testid="input-rewrite"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={rewriteDraft.isPending || !rewriteInstr.trim()}
                  onClick={() => rewriteDraft.mutate()}
                  data-testid="button-rewrite"
                >
                  {rewriteDraft.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PenLine className="mr-2 h-4 w-4" />
                  )}
                  Rewrite draft
                </Button>
              </div>
            )}
            {draft?.format !== "blog_post" && draftAssetId && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Branded image</Label>
                  <span className="text-xs text-muted-foreground">Optional</span>
                </div>
                {draftImageUrl ? (
                  <div className="space-y-2">
                    <img
                      src={draftImageUrl}
                      alt="Branded graphic for this draft"
                      className="w-full rounded-md border"
                      data-testid="img-draft-branded"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={generateImage.isPending}
                        onClick={() => generateImage.mutate()}
                        data-testid="button-regenerate-image"
                      >
                        {generateImage.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Regenerate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={removeImage.isPending}
                        onClick={() => removeImage.mutate()}
                        data-testid="button-remove-image"
                      >
                        {removeImage.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <X className="mr-2 h-4 w-4" />
                        )}
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={downloadImage}
                        data-testid="button-download-image"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Generate a branded graphic (brand colors, logo, and a headline from this draft) to go with the post.
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={generateImage.isPending}
                      onClick={() => generateImage.mutate()}
                      data-testid="button-generate-image"
                    >
                      {generateImage.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ImageIcon className="mr-2 h-4 w-4" />
                      )}
                      Generate branded image
                    </Button>
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/app/marketing/content-library?asset=${draftAssetId}`)}
                  disabled={!draftAssetId}
                  data-testid="button-open-library"
                >
                  <Library className="mr-2 h-4 w-4" />
                  Open in Library
                </Button>
                {draft?.format === "blog_post" && draftAssetId && (
                  <Button
                    variant="outline"
                    onClick={() => setWebsitePublishOpen(true)}
                    data-testid="button-push-to-website"
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    {draftAssetWebsiteSlug ? "Update on website" : "Push to website"}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (draft) {
                      navigator.clipboard.writeText(draft.body);
                      toast.success("Copied to clipboard");
                    }
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  onClick={downloadDocx}
                  disabled={downloadingDocx || !draftAssetId}
                  data-testid="button-download-docx"
                >
                  {downloadingDocx ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="mr-2 h-4 w-4" />
                  )}
                  Download Word
                </Button>
                <Button
                  onClick={() => saveDraft.mutate()}
                  disabled={saveDraft.isPending || !draftDirty || !draftAssetId}
                  data-testid="button-save-draft"
                >
                  {saveDraft.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {draftDirty ? "Save" : "Saved"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Website publish dialog for blog_post drafts */}
        {draftAssetId && draft?.format === "blog_post" && (
          <WebsitePublishDialog
            asset={{
              id: draftAssetId,
              title: draft?.title ?? "",
              description: draftAssetDescription ?? undefined,
              leadImageUrl: blogHeroUrl || draftImageUrl || undefined,
              websitePostSlug: draftAssetWebsiteSlug,
              websitePostStatus: draftAssetWebsiteStatus,
              websiteScheduledFor: draftAssetWebsiteScheduledFor,
              websiteExcerpt: blogExcerpt || undefined,
              websiteAuthorId: blogAuthorId || undefined,
              websiteCategoryIds: blogCategoryIds.size ? Array.from(blogCategoryIds) : undefined,
              websiteTagIds: blogTagIds.size ? Array.from(blogTagIds) : undefined,
            }}
            open={websitePublishOpen}
            onOpenChange={(o) => {
              setWebsitePublishOpen(o);
              if (!o && draftAssetId) {
                fetch(`/api/content-assets/${draftAssetId}`, { credentials: "include" })
                  .then((r) => r.json())
                  .then((a) => {
                    setDraftAssetWebsiteSlug(a.websitePostSlug ?? null);
                    setDraftAssetWebsiteStatus(a.websitePostStatus ?? null);
                    setDraftAssetWebsiteScheduledFor(a.websiteScheduledFor ?? null);
                  })
                  .catch(() => {});
              }
            }}
          />
        )}

        {/* Multi-format repurposer */}
        <RepurposeDialog
          assetId={repurposeTarget?.id ?? null}
          assetTitle={repurposeTarget?.title}
          calendarId={repurposeTarget?.calendarId}
          open={!!repurposeTarget}
          onOpenChange={(o) => !o && setRepurposeTarget(null)}
          onOpenLibraryAsset={(id) => navigate(`/app/marketing/content-library?asset=${id}`)}
          onViewPosts={() => navigate("/app/marketing/calendar")}
          onOpenContentBriefs={() => navigate(`/app/marketing/editorial-calendar?calendarId=${repurposeTarget?.calendarId ?? ""}`)}
        />

        {/* Repurpose results (social-only legacy path) */}
        <Dialog open={!!repurpose} onOpenChange={(o) => !o && setRepurpose(null)}>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Social variants</DialogTitle>
              <DialogDescription>
                Saved as drafts in the posts pipeline — review and schedule them from the composer/campaigns.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {(repurpose ?? []).map((v, i) => (
                <div key={v.id ?? i} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <Badge variant="secondary">{v.platform}</Badge>
                    <div className="flex items-center gap-1">
                      {v.id && (
                        <RegenerateGraphicButton
                          defaultHeadline={(v.imagePrompt || v.content || "").trim().slice(0, 200)}
                          onRegenerate={({ headline }) => regenVariantImage(v.id, i, headline)}
                          testId={`regenerate-variant-${i}`}
                        />
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            v.content + (v.hashtags?.length ? "\n\n" + v.hashtags.map((h) => `#${h}`).join(" ") : ""),
                          );
                          toast.success("Copied");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {v.overrideImageUrl && (
                    <img
                      src={v.overrideImageUrl}
                      alt={`Branded graphic for ${v.platform} post`}
                      className="mb-2 w-full rounded-md border"
                      data-testid={`img-variant-${i}`}
                    />
                  )}
                  <p className="whitespace-pre-wrap text-sm">{v.content}</p>
                  {v.hashtags?.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">{v.hashtags.map((h) => `#${h}`).join(" ")}</p>
                  )}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => setRepurpose(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Carousel slide images */}
        <Dialog open={!!carouselSlides} onOpenChange={(o) => !o && setCarouselSlides(null)}>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Branded carousel slides</DialogTitle>
              <DialogDescription>
                One branded image per slide for "{carouselSlides?.title}". Saved with the new asset draft.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(carouselSlides?.slides ?? []).map((s) => (
                <div key={s.index} className="rounded-md border p-2" data-testid={`card-slide-${s.index}`}>
                  <img
                    src={s.fileUrl}
                    alt={`Slide ${s.index}: ${s.headline}`}
                    className="w-full rounded"
                    data-testid={`img-slide-${s.index}`}
                  />
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <p className="text-xs font-medium">
                      Slide {s.index}: {s.headline}
                    </p>
                    {carouselSlides?.assetId && (
                      <RegenerateGraphicButton
                        defaultHeadline={s.headline}
                        withSubtitle
                        onRegenerate={({ headline, subtitle }) =>
                          regenCarouselSlide(carouselSlides.assetId, s.index, headline, subtitle)
                        }
                        testId={`regenerate-slide-${s.index}`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => setCarouselSlides(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SEO/AEO results */}
        <Dialog open={!!optimization} onOpenChange={(o) => !o && setOptimization(null)}>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>SEO / AEO optimization</DialogTitle>
            </DialogHeader>
            {optimization && (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">SEO title</p>
                  <p>{optimization.seoTitle ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Meta description</p>
                  <p>{optimization.metaDescription ?? "—"}</p>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {optimization.slug && (
                    <span>
                      <span className="text-muted-foreground">Slug:</span> /{optimization.slug}
                    </span>
                  )}
                  {optimization.targetKeyword && (
                    <span>
                      <span className="text-muted-foreground">Keyword:</span> {optimization.targetKeyword}
                    </span>
                  )}
                </div>
                {optimization.keywords && optimization.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {optimization.keywords.map((k, i) => (
                      <Badge key={i} variant="secondary">
                        {k}
                      </Badge>
                    ))}
                  </div>
                )}
                {optimization.answerBlocks && optimization.answerBlocks.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Answer blocks (AEO)</p>
                    <div className="space-y-2">
                      {optimization.answerBlocks.map((qa, i) => (
                        <div key={i}>
                          <p className="font-medium">{qa.question}</p>
                          <p className="text-muted-foreground">{qa.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {optimization.faq && optimization.faq.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">FAQ</p>
                    <div className="space-y-2">
                      {optimization.faq.map((qa, i) => (
                        <div key={i}>
                          <p className="font-medium">{qa.question}</p>
                          <p className="text-muted-foreground">{qa.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {optimization.internalLinks && optimization.internalLinks.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Internal links</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {optimization.internalLinks.map((l, i) => (
                        <li key={i}>
                          <span className="font-medium">{l.anchorText}</span> → {l.targetTitle}
                          {l.reason && <span className="text-muted-foreground"> ({l.reason})</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {optimization.contentGaps && optimization.contentGaps.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Content gaps</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {optimization.contentGaps.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setOptimization(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Schedule briefs — one flow: suggest publish dates (preview), then push to the Marketing
            Planner (whose tasks sync to Microsoft Planner). No plan = preview; with plan = commit. */}
        <Dialog open={distOpen} onOpenChange={setDistOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Schedule briefs</DialogTitle>
              <DialogDescription>
                Spreads this calendar's briefs across posting windows and recommends a publish date for each. Building a
                suggestion is just a preview — nothing is saved until you pick a plan and push it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dist-start">Start</Label>
                  <Input id="dist-start" type="date" value={distStart} onChange={(e) => setDistStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dist-end">End</Label>
                  <Input id="dist-end" type="date" value={distEnd} onChange={(e) => setDistEnd(e.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={distSkipWeekends}
                  onChange={(e) => setDistSkipWeekends(e.target.checked)}
                  className="h-4 w-4"
                />
                Skip weekends
              </label>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setCommittedPlan(null);
                  planDistribution.mutate(undefined);
                }}
                disabled={planDistribution.isPending}
                data-testid="button-run-distribution"
              >
                {planDistribution.isPending && !planDistribution.variables ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Building…
                  </>
                ) : (
                  <>
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {schedule ? "Rebuild suggestion" : "Build suggestion"}
                  </>
                )}
              </Button>

              {schedule && schedule.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Suggested schedule ({schedule.length})
                  </p>
                  <div className="divide-y rounded-md border">
                    {schedule.map((s) => (
                      <div key={s.briefId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary">{s.channel}</Badge>
                          {new Date(s.scheduledAt).toLocaleDateString()} · {s.timeframe}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {schedule && schedule.length > 0 && (
                <div className="space-y-2 rounded-md border border-dashed p-3">
                  <Label>Push to a marketing project</Label>
                  <p className="text-xs text-muted-foreground">
                    Adds these as tasks in your <strong>Marketing Projects</strong> plan. Those tasks then sync to{" "}
                    <strong>Microsoft Planner</strong> automatically. This creates real tasks — it's not a preview.
                  </p>
                  <Select value={distPlanId || "__none__"} onValueChange={(v) => setDistPlanId(v === "__none__" ? "" : v)}>
                    <SelectTrigger data-testid="select-dist-plan">
                      <SelectValue placeholder="Choose a plan to add tasks to" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Choose a plan…</SelectItem>
                      {(marketingPlans ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.fiscalYear ? ` (FY${p.fiscalYear})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {committedPlan && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200">
                      <span>
                        Added {committedPlan.tasks} task{committedPlan.tasks === 1 ? "" : "s"} to "{committedPlan.name}".
                        {committedPlan.skipped ? ` Skipped ${committedPlan.skipped} already in the project.` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("/app/marketing/projects")}
                        data-testid="button-open-planner"
                      >
                        <CalendarClock className="mr-1 h-4 w-4" />
                        Open Marketing Projects
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDistOpen(false)}>
                Close
              </Button>
              <Button
                onClick={() => planDistribution.mutate(distPlanId)}
                disabled={planDistribution.isPending || !distPlanId || !schedule?.length}
                data-testid="button-push-distribution"
              >
                {planDistribution.isPending && planDistribution.variables ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Pushing…
                  </>
                ) : (
                  <>
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Push to Planner
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Copy brief to campaign dialog */}
        <Dialog
          open={!!copyBriefId}
          onOpenChange={(o) => {
            if (!o) { setCopyBriefId(null); setCopyTargetCampaignId(""); setCopyNewCampaignName(""); }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Copy brief to campaign</DialogTitle>
              <DialogDescription>
                Choose an existing campaign to copy this brief into, or create a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Existing campaign</Label>
                <Select
                  value={copyTargetCampaignId || "__none__"}
                  onValueChange={(v) => { setCopyTargetCampaignId(v === "__none__" ? "" : v); setCopyNewCampaignName(""); }}
                >
                  <SelectTrigger data-testid="select-copy-campaign">
                    <SelectValue placeholder="Pick a campaign…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (new campaign below)</SelectItem>
                    {(() => {
                      const active = (campaignOptions ?? []).filter((c) => c.status === "active" || c.status === "draft");
                      const closed = (campaignOptions ?? []).filter((c) => c.status !== "active" && c.status !== "draft");
                      return (
                        <>
                          {active.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                          {active.length > 0 && closed.length > 0 && <SelectSeparator />}
                          {closed.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-muted-foreground">
                              {c.name} ({c.status})
                            </SelectItem>
                          ))}
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>
              {!copyTargetCampaignId && (
                <div className="space-y-2">
                  <Label htmlFor="copy-new-campaign-name">Or create a new campaign named…</Label>
                  <Input
                    id="copy-new-campaign-name"
                    placeholder="Campaign name"
                    value={copyNewCampaignName}
                    onChange={(e) => setCopyNewCampaignName(e.target.value)}
                    data-testid="input-copy-new-campaign"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCopyBriefId(null); setCopyTargetCampaignId(""); setCopyNewCampaignName(""); }}>
                Cancel
              </Button>
              <Button
                disabled={(!copyTargetCampaignId && !copyNewCampaignName.trim()) || copyBrief.isPending}
                onClick={() => {
                  if (!copyBriefId) return;
                  copyBrief.mutate({
                    id: copyBriefId,
                    ...(copyTargetCampaignId ? { campaignId: copyTargetCampaignId } : { newCampaignName: copyNewCampaignName.trim() }),
                  });
                }}
                data-testid="button-copy-brief-confirm"
              >
                {copyBrief.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                Copy brief
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </FeatureGate>
    </AppLayout>
  );
}

// Inline "Regenerate" control for a single branded graphic. Opens a small editor
// to tweak the headline (and an optional subtitle) that drives the image, then
// calls the parent's regenerate handler. Errors surface as a toast and keep the
// editor open so the user can adjust and retry.
function RegenerateGraphicButton({
  defaultHeadline,
  defaultSubtitle,
  withSubtitle,
  onRegenerate,
  testId,
}: {
  defaultHeadline?: string;
  defaultSubtitle?: string;
  withSubtitle?: boolean;
  onRegenerate: (vals: { headline: string; subtitle: string }) => Promise<void>;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState(defaultHeadline ?? "");
  const [subtitle, setSubtitle] = useState(defaultSubtitle ?? "");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onRegenerate({ headline: headline.trim(), subtitle: subtitle.trim() });
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to regenerate graphic");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setHeadline(defaultHeadline ?? "");
          setSubtitle(defaultSubtitle ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" data-testid={testId}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Regenerate
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div className="space-y-1.5">
          <Label className="text-xs">Headline</Label>
          <Textarea
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            rows={2}
            placeholder="Headline for the graphic"
            data-testid={testId ? `${testId}-headline` : undefined}
          />
        </div>
        {withSubtitle && (
          <div className="space-y-1.5">
            <Label className="text-xs">Subtitle (optional)</Label>
            <Input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Supporting line"
              data-testid={testId ? `${testId}-subtitle` : undefined}
            />
          </div>
        )}
        <Button
          size="sm"
          className="w-full"
          onClick={run}
          disabled={busy}
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Regenerate graphic
        </Button>
      </PopoverContent>
    </Popover>
  );
}
