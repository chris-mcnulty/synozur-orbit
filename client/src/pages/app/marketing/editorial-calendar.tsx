import { useState, useEffect } from "react";
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
  Mic,
  CheckCircle2,
} from "lucide-react";
import { FeatureGate } from "@/components/UpgradePrompt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { RepurposeDialog } from "@/components/marketing/RepurposeDialog";
import { isSocialBriefFormat } from "@shared/schema";

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
  solutionAreaId: string | null;
  draftTitle: string | null;
  draftCategoryId: string | null;
  pushedToPlanner?: boolean;
}

interface NamedRow {
  id: string;
  name: string;
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
  // Honor a ?calendar=<id> deep link (e.g. from a campaign's content plan).
  const initialCalendarId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("calendar")
      : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialCalendarId);
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
  const [generateOpen, setGenerateOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState(15);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);
  const [draftBriefTitle, setDraftBriefTitle] = useState<string | null>(null);
  const [openingDraftId, setOpeningDraftId] = useState<string | null>(null);
  const [draftImageUrl, setDraftImageUrl] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [rewriteInstr, setRewriteInstr] = useState("");
  const [repurpose, setRepurpose] = useState<RepurposeVariantResult[] | null>(null);
  const [repurposeTarget, setRepurposeTarget] = useState<{ id: string; title?: string } | null>(null);
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

  const { data: marketingPlans } = useQuery<MarketingPlan[]>({
    queryKey: ["/api/marketing-plans"],
    queryFn: async () => (await getJson("/api/marketing-plans")) ?? [],
    enabled: distOpen,
  });

  const { data: calendars, isLoading: calendarsLoading } = useQuery<EditorialCalendar[]>({
    queryKey: ["/api/editorial-calendars"],
    queryFn: async () => (await getJson("/api/editorial-calendars")) ?? [],
  });

  const activeId = selectedId ?? calendars?.[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<{
    calendar: EditorialCalendar;
    briefs: ContentBrief[];
  } | null>({
    queryKey: ["/api/editorial-calendars", activeId],
    queryFn: () => (activeId ? getJson(`/api/editorial-calendars/${activeId}`) : null),
    enabled: !!activeId,
  });

  const briefs = detail?.briefs ?? [];
  // When a campaign filter is active (deep link or toolbar pick), scope the
  // cards to that campaign so the page reads as a campaign-scoped review surface.
  const visibleBriefs = campaignFilter
    ? briefs.filter((b) => b.campaignId === campaignFilter)
    : briefs;

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
    // Active campaigns only, deduped by name — archived and duplicate-named
    // campaigns shouldn't clutter the assignment picker.
    queryKey: ["/api/campaigns", "active-picker"],
    queryFn: async () => {
      const rows: NamedRow[] = (await getJson("/api/campaigns?status=active")) ?? [];
      const seen = new Set<string>();
      return rows.filter((c) => {
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars"] });
      setSelectedId(data.calendar.id);
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      toast.success("Finalized — brief approved and its draft saved to the library.");
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-assets"] });
      if (failed > 0) {
        toast.warning(`Finalized ${total - failed} of ${total}; ${failed} could not be finalized.`);
      } else {
        toast.success(`Finalized ${total} piece${total === 1 ? "" : "s"}.`);
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
      setDraft(data.draft);
      setDraftAssetId(data.asset?.id ?? null);
      setDraftBriefTitle(briefs.find((b) => b.id === briefId)?.title ?? null);
      setDraftImageUrl(data.asset?.leadImageUrl ?? null);
      setDraftDirty(false);
      setRewriteInstr("");
      toast.success("Draft created and saved to the content library");
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
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
      toast.success("Draft saved to the content library");
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
        toast.success(`Created "${data.asset.title}" in the Content Library`);
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
      const res = await fetch(`/api/editorial-calendars/${activeId}/distribution-plan`, {
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
        const skippedNote = skipped > 0 ? ` (skipped ${skipped} already in Planner)` : "";
        if (created === 0 && skipped > 0) {
          toast.success(`All ${skipped} item${skipped === 1 ? "" : "s"} were already in "${data.plan?.name}" — nothing new to add.`);
        } else {
          toast.success(`Added ${created} task${created === 1 ? "" : "s"} to "${data.plan?.name}"${skippedNote} — open the Marketing Planner to review.`);
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
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
      toast.success("Brief deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  const deleteCalendar = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/editorial-calendars/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete calendar");
      return res.json();
    },
    onSuccess: () => {
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars"] });
      toast.success("Calendar deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
            <Button onClick={() => setGenerateOpen(true)} data-testid="button-generate-calendar">
              <Sparkles className="mr-2 h-4 w-4" />
              Generate calendar
            </Button>
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
                  Plan and write the content itself. Briefs become drafts saved to the Content Library; use
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

          {/* Calendar selector */}
          {calendarsLoading ? (
            <p className="text-sm text-muted-foreground">Loading calendars…</p>
          ) : calendars && calendars.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <Select value={activeId ?? undefined} onValueChange={setSelectedId}>
                <SelectTrigger className="w-[320px]" data-testid="select-calendar">
                  <SelectValue placeholder="Select a calendar" />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeId && distributionAllowed && briefs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSchedule(null);
                    setCommittedPlan(null);
                    setDistPlanId("");
                    setDistOpen(true);
                  }}
                  data-testid="button-suggest-schedule"
                >
                  <CalendarDays className="mr-1 h-4 w-4" />
                  Schedule briefs
                </Button>
              )}
              {activeId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={deleteCalendar.isPending}
                  onClick={() => {
                    if (confirm("Delete this calendar and all its briefs?")) deleteCalendar.mutate(activeId);
                  }}
                  data-testid="button-delete-calendar"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <CalendarDays className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">No calendars yet</p>
                  <p className="text-sm text-muted-foreground">
                    Generate your first demand-scored content calendar to get started.
                  </p>
                </div>
                <Button onClick={() => setGenerateOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate calendar
                </Button>
              </CardContent>
            </Card>
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
                      {(campaignOptions ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
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
                        Finalize all drafted ({finalizable.length})
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
          {detailLoading ? (
            <p className="text-sm text-muted-foreground">Loading briefs…</p>
          ) : visibleBriefs.length === 0 && campaignFilter ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <p className="text-sm font-medium">No briefs for this campaign in this calendar</p>
                <Button variant="outline" size="sm" onClick={() => setCampaignFilter(null)} data-testid="button-clear-campaign-filter">
                  Show all campaigns
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {visibleBriefs.map((b) => (
                <Card key={b.id} data-testid={`brief-${b.id}`} className={focusBriefId === b.id ? "ring-2 ring-primary ring-offset-2" : undefined}>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {/* Left meta block — fixed order so format / status / draft-state
                          line up the same way on every card and the list scans cleanly.
                          Title leads; the key state badges sit on one consistent row;
                          secondary details (keyword, hours) drop to their own muted line. */}
                      <div className="min-w-0 space-y-1.5">
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
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${b.contentAssetId ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
                            data-testid={`linked-draft-${b.id}`}
                          >
                            <Link2 className="h-3 w-3" />
                            {b.contentAssetId ? "Draft ready" : "No draft yet"}
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
                              Targets social. Drafting saves a document to the Content Library — use{" "}
                              <span className="font-medium">Repurpose</span> to turn it into a schedulable Social Post.
                            </span>
                          </p>
                        )}
                      </div>
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
                        {b.contentAssetId ? (
                          <>
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
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={draftBrief.isPending && draftBrief.variables === b.id}
                              onClick={() => {
                                if (confirm("Regenerate the draft? This replaces the current draft text in the content library.")) {
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
                          </>
                        ) : (
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
                        )}
                        {canFinalizeBrief(b) && (
                          <Button
                            size="sm"
                            disabled={finalizeBrief.isPending && finalizeBrief.variables === b.id}
                            onClick={() => finalizeBrief.mutate(b.id)}
                            data-testid={`finalize-${b.id}`}
                            title="Approve the brief and its draft in one step"
                          >
                            {finalizeBrief.isPending && finalizeBrief.variables === b.id ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                            )}
                            Finalize
                          </Button>
                        )}
                        {b.contentAssetId && repurposeAllowed && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRepurposeTarget({ id: b.contentAssetId!, title: b.title })}
                            data-testid={`repurpose-${b.id}`}
                          >
                            <Share2 className="mr-1 h-4 w-4" />
                            Repurpose
                          </Button>
                        )}
                        {b.contentAssetId && optimizeAllowed && (
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

                    {/* Assignment: campaign, theme, category. Campaign and theme
                        live on the brief; category lives on the generated draft
                        (content asset), so it's only enabled once drafted. */}
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
                      <Select
                        value={b.draftCategoryId ?? "__none__"}
                        disabled={!b.contentAssetId || assignCategory.isPending}
                        onValueChange={(v) =>
                          b.contentAssetId &&
                          assignCategory.mutate({ assetId: b.contentAssetId, categoryId: v === "__none__" ? null : v })
                        }
                      >
                        <SelectTrigger className="h-8 w-[180px]" data-testid={`assign-category-${b.id}`}>
                          <SelectValue placeholder={b.contentAssetId ? "Category" : "Category (draft first)"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No category</SelectItem>
                          {(categoryOptions ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
              <DialogTitle>Generate editorial calendar</DialogTitle>
              <DialogDescription>
                Briefs are grounded in your messaging framework, competitive gaps, personas, and tracked SEO keywords.
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
            }
          }}
        >
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit draft</DialogTitle>
              <DialogDescription>
                {draftBriefTitle ? (
                  <span className="inline-flex items-center gap-1" data-testid="text-draft-source-brief">
                    <Link2 className="h-3 w-3" />
                    From brief: <span className="font-medium">{draftBriefTitle}</span>
                  </span>
                ) : (
                  "This draft lives in your Content Library. Edit it here, or open the library for the full editor."
                )}
              </DialogDescription>
            </DialogHeader>
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
              {draft?.format === "blog_post" && (
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
                  data-testid="input-draft-body"
                />
              </div>
              {draft?.format === "blog_post" && (
                <div className="space-y-1">
                  <Label htmlFor="draft-tags" className="text-xs font-medium uppercase text-muted-foreground">
                    Tags <span className="normal-case font-normal">(comma-delimited)</span>
                  </Label>
                  <Input
                    id="draft-tags"
                    value={draft?.tags ?? ""}
                    placeholder="e.g. AI, private equity, value creation"
                    onChange={(e) => {
                      setDraft((d) => (d ? { ...d, tags: e.target.value } : d));
                      setDraftDirty(true);
                    }}
                    data-testid="input-draft-tags"
                  />
                </div>
              )}
            </div>
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
                    This draft lives in the Content Library as a document. To turn it into a schedulable, publishable
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
                    setRepurposeTarget(target);
                  }}
                  data-testid="button-draft-repurpose"
                >
                  <Share2 className="mr-1 h-4 w-4" />
                  Repurpose
                </Button>
              </div>
            )}
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
            {draftAssetId && (
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
              <Button
                variant="outline"
                onClick={() => navigate(`/app/marketing/content-library?asset=${draftAssetId}`)}
                disabled={!draftAssetId}
                data-testid="button-open-library"
              >
                <Library className="mr-2 h-4 w-4" />
                Open in Content Library
              </Button>
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

        {/* Multi-format repurposer */}
        <RepurposeDialog
          assetId={repurposeTarget?.id ?? null}
          assetTitle={repurposeTarget?.title}
          open={!!repurposeTarget}
          onOpenChange={(o) => !o && setRepurposeTarget(null)}
          onOpenLibraryAsset={(id) => navigate(`/app/marketing/content-library?asset=${id}`)}
          onViewPosts={() => navigate("/app/marketing/calendar")}
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
                One branded image per slide for "{carouselSlides?.title}". Saved with the new asset in the Content Library.
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
                  <Label>Push to Planner</Label>
                  <p className="text-xs text-muted-foreground">
                    Adds these as tasks in your <strong>Marketing Planner</strong>. Those tasks then sync to{" "}
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
                        {committedPlan.skipped ? ` Skipped ${committedPlan.skipped} already in Planner.` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("/app/marketing-planner")}
                        data-testid="button-open-planner"
                      >
                        <CalendarClock className="mr-1 h-4 w-4" />
                        Open Marketing Planner
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
