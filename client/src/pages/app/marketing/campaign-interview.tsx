import { useEffect, useMemo, useRef, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Link, useSearch } from "wouter";
import { format as formatDate } from "date-fns";
import {
  Sparkles,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Package,
  ThumbsDown,
  Loader2,
  CircleCheck,
  CircleAlert,
  Newspaper,
  User,
} from "lucide-react";
import {
  CONTENT_FORM_CATEGORIES,
  FORM_CATEGORY_FORMATS,
  type ContentFormCategory,
} from "@shared/schema";

// ── Types mirrored from the API ────────────────────────────────────────────

interface ProductFeature {
  name: string;
  description?: string | null;
  status?: string | null;
}
interface ProductMatch {
  id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  features: ProductFeature[];
}
interface FitAssessment {
  voiceFit: "strong" | "moderate" | "weak";
  topicFit: "strong" | "moderate" | "weak";
  recommendation: "keep" | "reject";
  rationale: string;
}
interface Brief {
  id: string;
  title: string;
  summary?: string | null;
  format: string;
  formCategories?: string[] | null;
  channels?: string[] | null;
  fitAssessment?: FitAssessment | null;
  targetKeyword?: string | null;
  demandSignal?: string | null;
  funnelStage: string;
  differentiationAngle?: string | null;
  targetReader?: string | null;
  cta?: string | null;
  status: string;
  scheduledAt?: string | null;
  derivedFromBriefId?: string | null;
}
interface GenerateResponse {
  campaign: { id: string; name: string };
  calendar: { id: string };
  briefs: Brief[];
  windows?: { rampUpStart?: string; releaseDate?: string; amplificationEnd?: string } | null;
}
interface TempoPhase {
  phase: string;
  label: string;
  cadence: string;
}
interface ReleaseWindowsResponse {
  rampUpStart: string;
  releaseDate: string;
  amplificationEnd: string;
  minAmplificationEnd: string;
  tempo: TempoPhase[];
  tempoText: string;
}

// ── Display constants ──────────────────────────────────────────────────────

const CAMPAIGN_TYPE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "theme", label: "Theme", hint: "Ongoing awareness push around a point of view" },
  { value: "event", label: "Event", hint: "Promote a webinar, conference, or dated event" },
  { value: "offering", label: "Offering", hint: "Launch or spotlight a product / service" },
  { value: "product_release", label: "Product release", hint: "Ramp up to a release date, then amplify for 30+ days" },
];

const FORMAT_LABELS: Record<string, string> = {
  blog_post: "Blog post",
  linkedin_post: "LinkedIn post",
  x_post: "X post",
  newsletter: "Email",
  landing_page: "Landing page",
  video_script: "Video",
  case_study: "Case study",
  whitepaper: "Whitepaper",
  ebook: "Ebook",
  podcast_outline: "Podcast",
  webinar: "Webinar",
  press_release: "Press release",
  other: "Other",
};

// Real social channels the interview can spread a concept across. Unlike the
// document formats, these produce schedulable generatedPosts (one per channel
// per date), not Word-doc drafts. LinkedIn is pre-selected.
const SOCIAL_CHANNELS: { value: string; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
];
const SOCIAL_CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  SOCIAL_CHANNELS.map((c) => [c.value, c.label]),
);
const SUPPORTED_CHANNEL_VALUES = SOCIAL_CHANNELS.map((c) => c.value);
// Document formats that are really social — handled by the channel picker, so
// they're hidden from the document checkboxes during planning.
const SOCIAL_DOC_FORMATS = ["linkedin_post", "x_post"];

/** Normalise a concept's suggested channels onto the supported set (x → twitter). */
function normalizeChannels(raw?: string[] | null): string[] {
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((c) => String(c).trim().toLowerCase())
    .map((c) => (c === "x" ? "twitter" : c))
    .filter((c) => SUPPORTED_CHANNEL_VALUES.includes(c));
  return Array.from(new Set(mapped));
}

const CATEGORY_LABELS: Record<ContentFormCategory, string> = {
  short_form: "Short form — social & email",
  mid_form: "Mid form — press & blog",
  long_form: "Long form — whitepapers & ebooks",
  digital_interactive: "Digital interactive — webinar, video, podcast",
};

const CATEGORY_SHORT_LABELS: Record<ContentFormCategory, string> = {
  short_form: "Short",
  mid_form: "Mid",
  long_form: "Long",
  digital_interactive: "Interactive",
};

const FIT_BADGE: Record<string, "default" | "secondary" | "destructive"> = {
  strong: "default",
  moderate: "secondary",
  weak: "destructive",
};

const STEPS = ["Interview", "Curate briefs", "Plan outputs", "Assets", "Generate"];

// ── Plan windows ───────────────────────────────────────────────────────────

interface PlanWindow {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

interface PlanSelection {
  format: string;
  count: number;
  windowKey: string;
}

interface SocialSelection {
  channels: string[];
  count: number;
  windowKey: string;
}

interface GeneratedSocialPost {
  id: string;
  platform: string;
  content: string;
  scheduledDate?: string | null;
}

interface InterviewContentAsset {
  id: string;
  title: string;
  assetType?: string;
  url?: string;
  fileUrl?: string;
  leadImageUrl?: string;
}

/** Default window per category: tease early, announce mid, deepen late. */
const DEFAULT_WINDOW_BY_CATEGORY: Record<ContentFormCategory, number> = {
  short_form: 0,
  mid_form: 1,
  long_form: 2,
  digital_interactive: 2,
};

const DEFAULT_COUNT: Record<string, number> = { linkedin_post: 3, x_post: 3 };

// Window math runs on UTC calendar days (date inputs parse to UTC midnight);
// plain ms arithmetic keeps it DST-proof, and the server re-anchors each piece
// to a local posting hour via tzOffsetMinutes.
const addDaysUtc = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const toDateKey = (d: Date) => d.toISOString().slice(0, 10);
const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

async function apiJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
}

interface InterviewPersona {
  id: string;
  name: string;
  role?: string | null;
  isIcp?: boolean;
}

interface NewsScanHeadline {
  title: string;
  source: string;
  url: string;
  snippet: string;
}

interface NewsScanResult {
  subject: string;
  headlines: NewsScanHeadline[];
}

export default function CampaignInterviewPage() {
  const { toast } = useToast();
  const searchStr = useSearch();
  const [step, setStep] = useState(0);

  // ── Step 0: interview state ──────────────────────────────────────────────
  const [campaignType, setCampaignType] = useState("theme");
  const [name, setName] = useState("");
  const [themesText, setThemesText] = useState("");
  const [timeframeStart, setTimeframeStart] = useState("");
  const [timeframeEnd, setTimeframeEnd] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [rampUpStart, setRampUpStart] = useState("");
  const [amplificationEnd, setAmplificationEnd] = useState("");
  const [tempoText, setTempoText] = useState("");
  const [newsItems, setNewsItems] = useState<string[]>(["", "", ""]);
  const [productQuery, setProductQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductMatch | null>(null);
  const [productNotInOrbit, setProductNotInOrbit] = useState(false);
  const [notes, setNotes] = useState("");
  const [briefCount, setBriefCount] = useState(8);

  // ── Persona picker ────────────────────────────────────────────────────────
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const { data: interviewPersonas = [] } = useQuery<InterviewPersona[]>({
    queryKey: ["/api/personas"],
    queryFn: () =>
      apiJson("/api/personas").then((d) => (Array.isArray(d) ? d : d?.items ?? [])),
  });
  const sortedPersonas = useMemo(
    () => [...interviewPersonas].sort((a, b) => Number(b.isIcp ?? false) - Number(a.isIcp ?? false)),
    [interviewPersonas],
  );

  // ── News-hook scanner ─────────────────────────────────────────────────────
  const [newsScanResults, setNewsScanResults] = useState<NewsScanResult[]>([]);
  const [newsScanLoading, setNewsScanLoading] = useState(false);
  const [acceptedNewsUrls, setAcceptedNewsUrls] = useState<Set<string>>(new Set());

  // ── Pre-populate from URL params (ideation signals / name) ────────────────
  const signalsInitialized = useRef(false);
  useEffect(() => {
    if (signalsInitialized.current) return;
    const params = new URLSearchParams(searchStr);
    const rawSignals = params.get("signals");
    const rawName = params.get("name");
    if (rawSignals || rawName) {
      signalsInitialized.current = true;
      if (rawName) setName(decodeURIComponent(rawName));
      if (rawSignals) {
        try {
          const parsed: string[] = JSON.parse(decodeURIComponent(rawSignals));
          if (Array.isArray(parsed) && parsed.length > 0) {
            const items = parsed.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
            if (items.length > 0) {
              setNewsItems((prev) => {
                const base = prev.filter((n) => n.trim());
                const merged = [...base, ...items].slice(0, 6);
                return merged.length < 3 ? [...merged, ...Array(3 - merged.length).fill("")] : merged;
              });
            }
          }
        } catch {
          /* ignore malformed param */
        }
      }
    }
  }, [searchStr]);

  const isRelease = campaignType === "product_release";
  const themes = useMemo(
    () => themesText.split("\n").map((t) => t.trim()).filter(Boolean),
    [themesText],
  );

  const debouncedProductQuery = useDebouncedValue(productQuery, 350);
  const { data: productMatches } = useQuery<{ matches: ProductMatch[] }>({
    queryKey: ["/api/campaign-interview/product-match", debouncedProductQuery],
    queryFn: () =>
      apiJson(`/api/campaign-interview/product-match?q=${encodeURIComponent(debouncedProductQuery)}`),
    enabled: isRelease && debouncedProductQuery.trim().length >= 2 && !selectedProduct,
  });

  // When a release date is set, pull the suggested ramp-up/amplification
  // windows and tempo from the server (which owns the ≥30-day rule).
  useEffect(() => {
    if (!isRelease || !releaseDate) return;
    let cancelled = false;
    apiJson(`/api/campaign-interview/release-windows?releaseDate=${encodeURIComponent(releaseDate)}`)
      .then((w: ReleaseWindowsResponse) => {
        if (cancelled) return;
        setRampUpStart(w.rampUpStart.slice(0, 10));
        setAmplificationEnd(w.amplificationEnd.slice(0, 10));
        setTempoText((prev) => prev || w.tempoText);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isRelease, releaseDate]);

  // ── Step 1+: generated campaign + briefs ─────────────────────────────────
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "keep" | "reject">>({});

  const generateBriefs = useMutation({
    mutationFn: async () =>
      apiJson("/api/campaign-interview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignType,
          name: name.trim() || undefined,
          themes,
          timeframeStart: timeframeStart || undefined,
          timeframeEnd: timeframeEnd || undefined,
          eventDate: eventDate || undefined,
          releaseDate: releaseDate || undefined,
          rampUpStart: rampUpStart || undefined,
          amplificationEnd: amplificationEnd || undefined,
          tempo: tempoText.trim() || undefined,
          newsItems: newsItems.map((n) => n.trim()).filter(Boolean),
          product: isRelease
            ? selectedProduct
              ? { productId: selectedProduct.id, productName: selectedProduct.name }
              : productQuery.trim()
                ? { productName: productQuery.trim() }
                : undefined
            : undefined,
          notes: notes.trim() || undefined,
          briefCount,
          personaIds: selectedPersonaIds.length ? selectedPersonaIds : undefined,
        }),
      }) as Promise<GenerateResponse>,
    onSuccess: (data) => {
      setResult(data);
      // Default the curation decisions from the AI's own fit verdicts so the
      // user starts from an honest baseline and only has to confirm.
      const initial: Record<string, "keep" | "reject"> = {};
      for (const b of data.briefs) {
        initial[b.id] = b.fitAssessment?.recommendation === "reject" ? "reject" : "keep";
      }
      setDecisions(initial);
      setStep(1);
    },
    onError: (err: Error) => toast({ title: "Brief generation failed", description: err.message, variant: "destructive" }),
  });

  const keptBriefs = useMemo(
    () => (result?.briefs ?? []).filter((b) => decisions[b.id] !== "reject"),
    [result, decisions],
  );

  const confirmCuration = useMutation({
    mutationFn: async () => {
      const outcomes = await Promise.allSettled(
        (result?.briefs ?? []).map((b) =>
          apiJson(`/api/content-briefs/${b.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: decisions[b.id] === "reject" ? "removed" : "accepted" }),
          }),
        ),
      );
      const failed = outcomes.filter((o) => o.status === "rejected").length;
      if (failed > 0) {
        throw new Error(`${failed} of ${outcomes.length} briefs could not be updated. Please try again.`);
      }
    },
    onSuccess: () => {
      // Seed the output plan with each kept brief's suggested form categories.
      // Social formats (LinkedIn/X posts) are handled by the channel picker, so
      // they're skipped here and seeded into socialPlan instead.
      const initialPlan: Record<string, PlanSelection[]> = {};
      const initialSocial: Record<string, SocialSelection> = {};
      for (const b of keptBriefs) {
        const cats = (b.formCategories ?? []).filter((c): c is ContentFormCategory =>
          (CONTENT_FORM_CATEGORIES as readonly string[]).includes(c),
        );
        initialPlan[b.id] = cats
          .map((cat) => {
            const fmt =
              cat === "mid_form" && b.format === "press_release"
                ? "press_release"
                : FORM_CATEGORY_FORMATS[cat].includes(b.format as any)
                  ? b.format
                  : FORM_CATEGORY_FORMATS[cat][0];
            return {
              format: fmt,
              count: DEFAULT_COUNT[fmt] ?? 1,
              windowKey: String(DEFAULT_WINDOW_BY_CATEGORY[cat]),
            };
          })
          .filter((sel) => !SOCIAL_DOC_FORMATS.includes(sel.format));

        // Pre-select channels for concepts that suit short-form social. Use the
        // AI's suggested channel mix, falling back to LinkedIn.
        const suitsSocial = cats.includes("short_form");
        const suggested = normalizeChannels(b.channels);
        initialSocial[b.id] = {
          channels: suitsSocial ? (suggested.length ? suggested : ["linkedin"]) : [],
          count: 3,
          windowKey: String(DEFAULT_WINDOW_BY_CATEGORY.short_form),
        };
      }
      setPlan(initialPlan);
      setSocialPlan(initialSocial);
      resetExpandProgress();
      setStep(2);
    },
    onError: (err: Error) => toast({ title: "Could not save selections", description: err.message, variant: "destructive" }),
  });

  // ── Step 2: output plan ──────────────────────────────────────────────────
  const [plan, setPlan] = useState<Record<string, PlanSelection[]>>({});
  const [socialPlan, setSocialPlan] = useState<Record<string, SocialSelection>>({});

  const windows: PlanWindow[] = useMemo(() => {
    if (isRelease && result?.windows?.releaseDate) {
      const release = new Date(result.windows.releaseDate);
      const ramp = result.windows.rampUpStart ? new Date(result.windows.rampUpStart) : addDaysUtc(release, -42);
      const ampEnd = result.windows.amplificationEnd ? new Date(result.windows.amplificationEnd) : addDaysUtc(release, 45);
      return [
        { key: "0", label: "Ramp-up (before release)", start: ramp, end: addDaysUtc(release, -1) },
        { key: "1", label: "Launch week", start: release, end: addDaysUtc(release, 6) },
        { key: "2", label: "Amplification (30+ days after)", start: addDaysUtc(release, 7), end: ampEnd },
      ];
    }
    const start = timeframeStart ? new Date(timeframeStart) : todayUtc();
    const endCandidate = eventDate || timeframeEnd;
    const end = endCandidate ? new Date(endCandidate) : addDaysUtc(start, 30);
    const span = Math.max(end.getTime() - start.getTime(), 0);
    const third = span / 3;
    const at = (ms: number) => new Date(start.getTime() + ms);
    return [
      { key: "0", label: "Early", start, end: at(third) },
      { key: "1", label: "Middle", start: at(third), end: at(third * 2) },
      { key: "2", label: "Late", start: at(third * 2), end },
    ];
  }, [isRelease, result, timeframeStart, timeframeEnd, eventDate]);

  const togglePlanFormat = (briefId: string, category: ContentFormCategory, fmt: string) => {
    setPlan((prev) => {
      const items = prev[briefId] ?? [];
      const existing = items.find((i) => i.format === fmt);
      const next = existing
        ? items.filter((i) => i.format !== fmt)
        : [
            ...items,
            {
              format: fmt,
              count: DEFAULT_COUNT[fmt] ?? 1,
              windowKey: String(DEFAULT_WINDOW_BY_CATEGORY[category]),
            },
          ];
      return { ...prev, [briefId]: next };
    });
  };

  const updatePlanItem = (briefId: string, fmt: string, patch: Partial<PlanSelection>) => {
    setPlan((prev) => ({
      ...prev,
      [briefId]: (prev[briefId] ?? []).map((i) => (i.format === fmt ? { ...i, ...patch } : i)),
    }));
  };

  const ensureSocial = (s?: SocialSelection): SocialSelection =>
    s ?? { channels: [], count: 3, windowKey: String(DEFAULT_WINDOW_BY_CATEGORY.short_form) };

  const toggleSocialChannel = (briefId: string, channel: string) => {
    setSocialPlan((prev) => {
      const cur = ensureSocial(prev[briefId]);
      const channels = cur.channels.includes(channel)
        ? cur.channels.filter((c) => c !== channel)
        : [...cur.channels, channel];
      return { ...prev, [briefId]: { ...cur, channels } };
    });
  };

  const updateSocialItem = (briefId: string, patch: Partial<SocialSelection>) => {
    setSocialPlan((prev) => ({ ...prev, [briefId]: { ...ensureSocial(prev[briefId]), ...patch } }));
  };

  const totalDocsPlanned = useMemo(
    () => Object.values(plan).flat().reduce((sum, i) => sum + i.count, 0),
    [plan],
  );
  const totalSocialPlanned = useMemo(
    () =>
      Object.values(socialPlan).reduce((sum, s) => sum + s.channels.length * s.count, 0),
    [socialPlan],
  );
  const totalPlanned = totalDocsPlanned + totalSocialPlanned;

  // ── Step 3: asset selection ───────────────────────────────────────────────
  const [selectedInterviewAssets, setSelectedInterviewAssets] = useState<string[]>([]);
  const [savingInterviewAssets, setSavingInterviewAssets] = useState(false);
  const assetSelectionInitialized = useRef(false);

  const { data: interviewContentAssets = [] } = useQuery<InterviewContentAsset[]>({
    queryKey: ["/api/content-assets"],
    queryFn: () => apiJson("/api/content-assets"),
    enabled: step >= 3,
  });

  // Fetch campaign detail to pre-populate existing asset selections when revisiting step 3.
  const { data: campaignDetail } = useQuery<{ assets: Array<{ assetId: string }> }>({
    queryKey: [`/api/campaigns/${result?.campaign.id}`],
    queryFn: () => apiJson(`/api/campaigns/${result!.campaign.id}`),
    enabled: step >= 3 && !!result?.campaign.id,
  });

  // Pre-check any already-saved campaign assets — runs once after the campaign detail loads.
  useEffect(() => {
    if (!campaignDetail || assetSelectionInitialized.current) return;
    assetSelectionInitialized.current = true;
    const existingIds = (campaignDetail.assets ?? []).map((a) => a.assetId);
    if (existingIds.length > 0) {
      setSelectedInterviewAssets(existingIds);
    }
  }, [campaignDetail]);

  const visualAssets = useMemo(
    () => interviewContentAssets.filter((a) => !!a.fileUrl),
    [interviewContentAssets],
  );
  const digitalAssets = useMemo(
    () => interviewContentAssets.filter((a) => !!a.url && !a.fileUrl),
    [interviewContentAssets],
  );

  const saveInterviewAssets = async () => {
    if (!result?.campaign.id) {
      setStep(4);
      return;
    }
    setSavingInterviewAssets(true);
    try {
      const existingIds = new Set((campaignDetail?.assets ?? []).map((a) => a.assetId));
      const toAdd = selectedInterviewAssets.filter((id) => !existingIds.has(id));
      const toRemove = Array.from(existingIds).filter((id) => !selectedInterviewAssets.includes(id));

      // Add new asset links
      if (toAdd.length > 0) {
        await apiJson(`/api/campaigns/${result.campaign.id}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetIds: toAdd }),
        });
      }
      // Remove deselected asset links
      await Promise.all(
        toRemove.map((assetId) =>
          apiJson(`/api/campaigns/${result!.campaign.id}/assets/${assetId}`, {
            method: "DELETE",
          }).catch(() => {/* non-fatal */}),
        ),
      );
    } catch {
      // Non-blocking — assets can be adjusted later from the campaign page.
    }
    setSavingInterviewAssets(false);
    setStep(4);
  };

  const [deliverables, setDeliverables] = useState<Brief[]>([]);
  const [socialPosts, setSocialPosts] = useState<GeneratedSocialPost[]>([]);
  // Neither expand endpoint is idempotent, so remember each leg's result once it
  // succeeds. If one leg fails the user retries from Step 2 — we skip any leg
  // that already landed to avoid duplicating briefs/posts. Reset when the user
  // goes Back to re-edit the plan or re-enters Step 2.
  const docsResultRef = useRef<Brief[] | null>(null);
  const socialResultRef = useRef<GeneratedSocialPost[] | null>(null);
  const resetExpandProgress = () => {
    docsResultRef.current = null;
    socialResultRef.current = null;
  };

  const expandPlan = useMutation({
    mutationFn: async () => {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const items = Object.entries(plan).flatMap(([briefId, selections]) =>
        selections.map((s) => {
          const w = windows.find((x) => x.key === s.windowKey) ?? windows[0];
          return {
            briefId,
            format: s.format,
            count: s.count,
            windowStart: toDateKey(w.start),
            windowEnd: toDateKey(w.end),
          };
        }),
      );
      const socialItems = Object.entries(socialPlan)
        .filter(([, s]) => s.channels.length > 0)
        .map(([briefId, s]) => {
          const w = windows.find((x) => x.key === s.windowKey) ?? windows[0];
          return {
            briefId,
            channels: s.channels,
            count: s.count,
            windowStart: toDateKey(w.start),
            windowEnd: toDateKey(w.end),
          };
        });

      // Skip any leg that already succeeded on a prior attempt so a retry after
      // a partial failure doesn't create duplicate briefs/posts.
      let briefs: Brief[] = docsResultRef.current ?? [];
      let posts: GeneratedSocialPost[] = socialResultRef.current ?? [];
      let failedConceptIds: string[] = [];
      if (items.length > 0 && docsResultRef.current === null) {
        const r = (await apiJson(`/api/campaign-interview/${result!.campaign.id}/expand-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, tzOffsetMinutes }),
        })) as { briefs: Brief[] };
        briefs = r.briefs ?? [];
        docsResultRef.current = briefs;
      }
      if (socialItems.length > 0 && socialResultRef.current === null) {
        const r = (await apiJson(`/api/campaign-interview/${result!.campaign.id}/expand-social`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: socialItems, tzOffsetMinutes }),
        })) as { posts: GeneratedSocialPost[]; failedConceptIds?: string[] };
        posts = r.posts ?? [];
        failedConceptIds = r.failedConceptIds ?? [];
        socialResultRef.current = posts;
      }
      return { briefs, posts, failedConceptIds };
    },
    onSuccess: (data) => {
      setDeliverables(
        [...data.briefs].sort(
          (a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime(),
        ),
      );
      setSocialPosts(
        [...data.posts].sort(
          (a, b) => new Date(a.scheduledDate ?? 0).getTime() - new Date(b.scheduledDate ?? 0).getTime(),
        ),
      );
      if (data.failedConceptIds.length > 0) {
        toast({
          title: "Some social posts couldn't be generated",
          description: `${data.failedConceptIds.length} concept${data.failedConceptIds.length === 1 ? "" : "s"} were skipped for social. You can re-run social planning for them later.`,
          variant: "destructive",
        });
      }
      setStep(3);
    },
    onError: (err: Error) => toast({ title: "Could not build the plan", description: err.message, variant: "destructive" }),
  });

  // ── Step 3: drafting ─────────────────────────────────────────────────────
  const [draftStatus, setDraftStatus] = useState<Record<string, "pending" | "ok" | "error">>({});
  const [drafting, setDrafting] = useState(false);

  const draftAll = async () => {
    if (!result) return;
    setDrafting(true);
    const ids = deliverables.map((d) => d.id);
    setDraftStatus(Object.fromEntries(ids.map((id) => [id, "pending" as const])));
    try {
      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const { results } = await apiJson(`/api/campaign-interview/${result.campaign.id}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefIds: batch }),
        });
        setDraftStatus((prev) => {
          const next = { ...prev };
          for (const r of results as Array<{ briefId: string; ok: boolean }>) {
            next[r.briefId] = r.ok ? "ok" : "error";
          }
          return next;
        });
      }
      toast({ title: "Drafting complete", description: "Drafts are linked to each calendar item and live in the Content Library." });
    } catch (err: any) {
      toast({ title: "Drafting stopped", description: err.message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const draftedCount = Object.values(draftStatus).filter((s) => s === "ok").length;

  // ── Validation ───────────────────────────────────────────────────────────
  const interviewValid =
    themes.length > 0 &&
    (!isRelease || !!releaseDate) &&
    (campaignType !== "event" || !!eventDate) &&
    (!isRelease || newsItems.filter((n) => n.trim()).length >= 1);

  const setNewsItem = (i: number, value: string) =>
    setNewsItems((prev) => prev.map((n, idx) => (idx === i ? value : n)));

  const runNewsScan = async () => {
    if (themes.length === 0) return;
    setNewsScanLoading(true);
    try {
      const subjects = [
        ...themes.slice(0, 4),
        ...(isRelease && (selectedProduct?.name || productQuery.trim())
          ? [selectedProduct?.name || productQuery.trim()]
          : []),
      ].filter(Boolean);
      const params = new URLSearchParams({
        subjects: subjects.join(","),
        topic: themes.join(" "),
      });
      const data = await apiJson(`/api/campaign-interview/news-scan?${params.toString()}`);
      const freshResults: NewsScanResult[] = data.results ?? [];
      setNewsScanResults((prev) => {
        const existingUrls = new Set(prev.flatMap((r) => r.headlines.map((h) => h.url)));
        const mergedResults = [...prev];
        for (const result of freshResults) {
          const newHeadlines = result.headlines.filter((h) => !existingUrls.has(h.url));
          if (newHeadlines.length > 0) {
            mergedResults.push({ subject: result.subject, headlines: newHeadlines });
          }
        }
        return mergedResults;
      });
      const hasAny = freshResults.some((r) => r.headlines.length > 0);
      if (!hasAny) {
        toast({ title: "No recent news found", description: "Try adjusting your themes or add news items manually." });
      }
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setNewsScanLoading(false);
    }
  };

  const clearNewsScan = () => {
    setNewsScanResults([]);
    setAcceptedNewsUrls(new Set());
  };

  const toggleNewsHeadline = (headline: NewsScanHeadline) => {
    const url = headline.url;
    if (acceptedNewsUrls.has(url)) {
      setAcceptedNewsUrls((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
      setNewsItems((prev) => {
        const text = headline.title;
        const removed = prev.filter((n) => n.trim() !== text);
        return removed.length < 3 ? [...removed, ...Array(3 - removed.length).fill("")] : removed;
      });
    } else {
      setAcceptedNewsUrls((prev) => new Set(prev).add(url));
      setNewsItems((prev) => {
        const filtered = prev.filter((n) => n.trim());
        const merged = [...filtered, headline.title].slice(0, 6);
        return merged.length < 3 ? [...merged, ...Array(3 - merged.length).fill("")] : merged;
      });
    }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-interview-title">
            <Sparkles className="h-6 w-6" /> Content interview
          </h1>
          <p className="text-muted-foreground mt-1">
            Answer a few questions, curate 5–10 content briefs, choose forms and timing, and land everything on the calendar.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                  i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : <span className="font-medium">{i + 1}</span>}
                {label}
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* ── Step 0: Interview ── */}
        {step === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Tell us about this campaign</CardTitle>
              <CardDescription>What kind of push is this, what are the themes, and when does it run?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {CAMPAIGN_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCampaignType(opt.value)}
                    data-testid={`button-type-${opt.value}`}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      campaignType === opt.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="font-medium text-sm">{opt.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{opt.hint}</div>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="interview-name">Campaign name (optional)</Label>
                <Input id="interview-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="We'll name it from your answers if you skip this" data-testid="input-name" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="interview-themes">General themes — one per line</Label>
                <Textarea
                  id="interview-themes"
                  value={themesText}
                  onChange={(e) => setThemesText(e.target.value)}
                  rows={3}
                  placeholder={"e.g. AI governance is an operating discipline, not a policy doc\nWhy mid-market firms outpace enterprises on adoption"}
                  data-testid="input-themes"
                />
              </div>

              {sortedPersonas.length > 0 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> Who is this campaign for? (optional)</Label>
                  <div className="flex flex-wrap gap-2" data-testid="persona-picker">
                    {sortedPersonas.map((p) => {
                      const selected = selectedPersonaIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setSelectedPersonaIds((prev) =>
                              selected ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                            )
                          }
                          data-testid={`button-persona-${p.id}`}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-muted-foreground/40"
                          }`}
                        >
                          {p.isIcp && <Badge variant="secondary" className="text-[9px] px-1 py-0 leading-tight">ICP</Badge>}
                          <span>{p.name}</span>
                          {p.role && <span className="text-muted-foreground text-xs">— {p.role}</span>}
                          {selected && <Check className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>
                  {selectedPersonaIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedPersonaIds.length} persona{selectedPersonaIds.length === 1 ? "" : "s"} selected — the AI will tailor concepts and targetReader to these audiences.
                    </p>
                  )}
                </div>
              )}

              {isRelease ? (
                <div className="space-y-4 border rounded-lg p-4">
                  <div className="font-medium flex items-center gap-2"><Package className="h-4 w-4" /> Product release details</div>

                  <div className="space-y-2">
                    <Label htmlFor="interview-product">What product is this?</Label>
                    {selectedProduct ? (
                      <div className="flex items-start justify-between gap-3 p-3 rounded-md border bg-muted/40">
                        <div>
                          <div className="text-sm font-medium flex items-center gap-2">
                            {selectedProduct.name}
                            <Badge variant="secondary">Matched in Orbit</Badge>
                          </div>
                          {selectedProduct.features.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {selectedProduct.features.length} known feature{selectedProduct.features.length === 1 ? "" : "s"}:{" "}
                              {selectedProduct.features.slice(0, 5).map((f) => f.name).join(", ")}
                              {selectedProduct.features.length > 5 ? "…" : ""}
                            </div>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedProduct(null); setProductQuery(""); }} data-testid="button-clear-product">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Input
                          id="interview-product"
                          value={productQuery}
                          onChange={(e) => { setProductQuery(e.target.value); setProductNotInOrbit(false); }}
                          placeholder="Start typing to check against Orbit's product list"
                          data-testid="input-product"
                        />
                        {(productMatches?.matches?.length ?? 0) > 0 && (
                          <div className="border rounded-md divide-y">
                            {productMatches!.matches.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className="w-full text-left p-2 hover:bg-muted/60 text-sm"
                                onClick={() => setSelectedProduct(m)}
                                data-testid={`button-product-${m.id}`}
                              >
                                <span className="font-medium">{m.name}</span>
                                <span className="text-xs text-muted-foreground ml-2">
                                  {m.features.length} feature{m.features.length === 1 ? "" : "s"} tracked
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {debouncedProductQuery.trim().length >= 2 && (productMatches?.matches?.length ?? 0) === 0 && !productNotInOrbit && (
                          <p className="text-xs text-muted-foreground">
                            No match in Orbit — we'll plan around "{productQuery.trim()}" as a new product.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="interview-release-date">Release date</Label>
                      <Input id="interview-release-date" type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} data-testid="input-release-date" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="interview-rampup">Ramp-up starts</Label>
                      <Input id="interview-rampup" type="date" value={rampUpStart} onChange={(e) => setRampUpStart(e.target.value)} data-testid="input-rampup" />
                      <p className="text-xs text-muted-foreground">Suggested: 6 weeks before release</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="interview-amp">Amplification ends</Label>
                      <Input id="interview-amp" type="date" value={amplificationEnd} onChange={(e) => setAmplificationEnd(e.target.value)} data-testid="input-amplification" />
                      <p className="text-xs text-muted-foreground">Runs at least 30 days after release</p>
                    </div>
                  </div>

                  {tempoText && (
                    <div className="space-y-2">
                      <Label htmlFor="interview-tempo">Suggested tempo of material (edit to taste)</Label>
                      <Textarea id="interview-tempo" value={tempoText} onChange={(e) => setTempoText(e.target.value)} rows={4} data-testid="input-tempo" />
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Top news items for this release (3–6)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={runNewsScan}
                        disabled={newsScanLoading || themes.length === 0}
                        data-testid="button-scan-news"
                      >
                        {newsScanLoading ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Scanning…</>
                        ) : (
                          <><Newspaper className="h-3.5 w-3.5 mr-1" /> Scan for news hooks</>
                        )}
                      </Button>
                    </div>
                    {newsItems.map((item, i) => (
                      <Input
                        key={i}
                        value={item}
                        onChange={(e) => setNewsItem(i, e.target.value)}
                        placeholder={`News item ${i + 1} — e.g. "New analytics dashboard ships GA"`}
                        data-testid={`input-news-${i}`}
                      />
                    ))}
                    <div className="flex gap-2">
                      {newsItems.length < 6 && (
                        <Button variant="outline" size="sm" onClick={() => setNewsItems((p) => [...p, ""])} data-testid="button-add-news">
                          Add news item
                        </Button>
                      )}
                      {newsItems.length > 3 && (
                        <Button variant="ghost" size="sm" onClick={() => setNewsItems((p) => p.slice(0, -1))}>
                          Remove last
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {campaignType === "event" && (
                      <div className="space-y-2">
                        <Label htmlFor="interview-event-date">Event date</Label>
                        <Input id="interview-event-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} data-testid="input-event-date" />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="interview-start">Timeframe start</Label>
                      <Input id="interview-start" type="date" value={timeframeStart} onChange={(e) => setTimeframeStart(e.target.value)} data-testid="input-timeframe-start" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="interview-end">Timeframe end</Label>
                      <Input id="interview-end" type="date" value={timeframeEnd} onChange={(e) => setTimeframeEnd(e.target.value)} data-testid="input-timeframe-end" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>News hooks (optional — up to 6)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={runNewsScan}
                        disabled={newsScanLoading || themes.length === 0}
                        data-testid="button-scan-news"
                      >
                        {newsScanLoading ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Scanning…</>
                        ) : (
                          <><Newspaper className="h-3.5 w-3.5 mr-1" /> Scan for news hooks</>
                        )}
                      </Button>
                    </div>
                    {newsItems.filter((n) => n.trim()).length === 0 && newsScanResults.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Add timely news items to anchor briefs to real moments, or scan for headlines based on your themes.
                      </p>
                    )}
                    {newsItems.map((item, i) => (
                      <Input
                        key={i}
                        value={item}
                        onChange={(e) => setNewsItem(i, e.target.value)}
                        placeholder={`News hook ${i + 1}`}
                        data-testid={`input-news-${i}`}
                      />
                    ))}
                    <div className="flex gap-2">
                      {newsItems.length < 6 && (
                        <Button variant="outline" size="sm" onClick={() => setNewsItems((p) => [...p, ""])} data-testid="button-add-news">
                          Add item
                        </Button>
                      )}
                      {newsItems.length > 3 && (
                        <Button variant="ghost" size="sm" onClick={() => setNewsItems((p) => p.slice(0, -1))}>
                          Remove last
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {newsScanResults.length > 0 && (
                <div className="space-y-2" data-testid="news-scan-results">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Newspaper className="h-4 w-4" /> News scan results — check a headline to add it as a news hook
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearNewsScan}
                      data-testid="button-clear-news-scan"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5 mr-1" /> Clear scan results
                    </Button>
                  </div>
                  {newsScanResults.map((r) =>
                    r.headlines.map((h) => {
                      const accepted = acceptedNewsUrls.has(h.url);
                      return (
                        <label
                          key={h.url}
                          className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                            accepted ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                          }`}
                          data-testid={`news-headline-${encodeURIComponent(h.url)}`}
                        >
                          <Checkbox
                            checked={accepted}
                            onCheckedChange={() => toggleNewsHeadline(h)}
                            className="mt-0.5 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-snug">{h.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {h.source && <span className="font-medium">{h.source} · </span>}
                              {h.snippet ? h.snippet.slice(0, 180) : ""}
                            </p>
                          </div>
                        </label>
                      );
                    }),
                  )}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="interview-notes">Anything else we should know? (optional)</Label>
                  <Textarea id="interview-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-notes" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interview-count">How many briefs? (5–10)</Label>
                  <Input
                    id="interview-count"
                    type="number"
                    min={5}
                    max={10}
                    value={briefCount}
                    onChange={(e) => setBriefCount(Math.min(10, Math.max(5, Number(e.target.value) || 8)))}
                    data-testid="input-brief-count"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => generateBriefs.mutate()} disabled={!interviewValid || generateBriefs.isPending} data-testid="button-generate-briefs">
                  {generateBriefs.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating briefs…</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" /> Generate briefs</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 1: Curate ── */}
        {step === 1 && result && (
          <Card>
            <CardHeader>
              <CardTitle>Curate your briefs</CardTitle>
              <CardDescription>
                Be picky — reject anything off voice or off topic. Fewer, sharper briefs beat more. We've pre-flagged the ones the AI itself wouldn't keep.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.briefs.map((b) => {
                const rejected = decisions[b.id] === "reject";
                const fit = b.fitAssessment;
                return (
                  <div
                    key={b.id}
                    className={`border rounded-lg p-4 space-y-2 transition-opacity ${rejected ? "opacity-50" : ""}`}
                    data-testid={`card-brief-${b.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-medium">{b.title}</div>
                        {b.summary && <p className="text-sm text-muted-foreground">{b.summary}</p>}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {(b.formCategories ?? []).map((c) => (
                            <Badge key={c} variant="outline">{CATEGORY_SHORT_LABELS[c as ContentFormCategory] ?? c}</Badge>
                          ))}
                          <Badge variant="secondary" className="capitalize">{b.funnelStage}</Badge>
                          {fit && (
                            <>
                              <Badge variant={FIT_BADGE[fit.voiceFit]}>voice: {fit.voiceFit}</Badge>
                              <Badge variant={FIT_BADGE[fit.topicFit]}>topic: {fit.topicFit}</Badge>
                            </>
                          )}
                        </div>
                        {fit?.recommendation === "reject" && (
                          <p className="text-xs text-destructive flex items-center gap-1 pt-1">
                            <ThumbsDown className="h-3 w-3" /> AI suggests rejecting: {fit.rationale || "weak fit"}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant={rejected ? "outline" : "default"}
                          onClick={() => setDecisions((d) => ({ ...d, [b.id]: "keep" }))}
                          data-testid={`button-keep-${b.id}`}
                        >
                          <Check className="h-4 w-4 mr-1" /> Keep
                        </Button>
                        <Button
                          size="sm"
                          variant={rejected ? "destructive" : "outline"}
                          onClick={() => setDecisions((d) => ({ ...d, [b.id]: "reject" }))}
                          data-testid={`button-reject-${b.id}`}
                        >
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-muted-foreground">
                  Keeping {keptBriefs.length} of {result.briefs.length}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(0)}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => confirmCuration.mutate()} disabled={keptBriefs.length === 0 || confirmCuration.isPending} data-testid="button-confirm-curation">
                    {confirmCuration.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Continue with {keptBriefs.length} brief{keptBriefs.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Plan outputs ── */}
        {step === 2 && result && (
          <Card>
            <CardHeader>
              <CardTitle>Plan the outputs</CardTitle>
              <CardDescription>
                For each brief, choose which forms to produce, how many, and when they should land. We've pre-selected each brief's suggested forms.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {keptBriefs.map((b) => (
                <div key={b.id} className="border rounded-lg p-4 space-y-3" data-testid={`card-plan-${b.id}`}>
                  <div className="font-medium">{b.title}</div>
                  <div className="grid lg:grid-cols-2 gap-3">
                    {CONTENT_FORM_CATEGORIES.map((cat) => (
                      <div key={cat} className="space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">{CATEGORY_LABELS[cat]}</div>
                        {FORM_CATEGORY_FORMATS[cat]
                          .filter((fmt) => !SOCIAL_DOC_FORMATS.includes(fmt))
                          .map((fmt) => {
                          const selection = (plan[b.id] ?? []).find((i) => i.format === fmt);
                          return (
                            <div key={fmt} className="flex items-center gap-2">
                              <Checkbox
                                checked={!!selection}
                                onCheckedChange={() => togglePlanFormat(b.id, cat, fmt)}
                                id={`plan-${b.id}-${fmt}`}
                                data-testid={`checkbox-${b.id}-${fmt}`}
                              />
                              <label htmlFor={`plan-${b.id}-${fmt}`} className="text-sm w-28 shrink-0 cursor-pointer">
                                {FORMAT_LABELS[fmt]}
                              </label>
                              {selection && (
                                <>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={10}
                                    className="w-16 h-8"
                                    value={selection.count}
                                    onChange={(e) =>
                                      updatePlanItem(b.id, fmt, { count: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })
                                    }
                                  />
                                  <Select value={selection.windowKey} onValueChange={(v) => updatePlanItem(b.id, fmt, { windowKey: v })}>
                                    <SelectTrigger className="h-8 flex-1">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {windows.map((w) => (
                                        <SelectItem key={w.key} value={w.key}>
                                          {w.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Social posts — real schedulable posts, one per channel per date. */}
                  {(() => {
                    const social = ensureSocial(socialPlan[b.id]);
                    const perChannel = social.count;
                    const total = social.channels.length * perChannel;
                    return (
                      <div className="space-y-2 border-t pt-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-medium text-muted-foreground">Social posts</div>
                          {total > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {total} post{total === 1 ? "" : "s"} ready to schedule
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {SOCIAL_CHANNELS.map((ch) => (
                            <div key={ch.value} className="flex items-center gap-1.5">
                              <Checkbox
                                checked={social.channels.includes(ch.value)}
                                onCheckedChange={() => toggleSocialChannel(b.id, ch.value)}
                                id={`social-${b.id}-${ch.value}`}
                                data-testid={`checkbox-social-${b.id}-${ch.value}`}
                              />
                              <label htmlFor={`social-${b.id}-${ch.value}`} className="text-sm cursor-pointer">
                                {ch.label}
                              </label>
                            </div>
                          ))}
                        </div>
                        {social.channels.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Posts per channel</span>
                            <Input
                              type="number"
                              min={1}
                              max={10}
                              className="w-16 h-8"
                              value={social.count}
                              onChange={(e) =>
                                updateSocialItem(b.id, { count: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })
                              }
                              data-testid={`input-social-count-${b.id}`}
                            />
                            <Select value={social.windowKey} onValueChange={(v) => updateSocialItem(b.id, { windowKey: v })}>
                              <SelectTrigger className="h-8 flex-1" data-testid={`select-social-window-${b.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {windows.map((w) => (
                                  <SelectItem key={w.key} value={w.key}>
                                    {w.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-muted-foreground">{totalPlanned} piece{totalPlanned === 1 ? "" : "s"} planned</div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { resetExpandProgress(); setStep(1); }}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => expandPlan.mutate()} disabled={totalPlanned === 0 || expandPlan.isPending} data-testid="button-expand-plan">
                    {expandPlan.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />}
                    Put {totalPlanned} piece{totalPlanned === 1 ? "" : "s"} on the calendar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Assets ── */}
        {step === 3 && result && (
          <Card>
            <CardHeader>
              <CardTitle>Campaign assets</CardTitle>
              <CardDescription>
                Pin the content library items most relevant to this campaign — images for posts and web pages to link to. The Review Images picker will show these first. You can skip this and add assets later from the campaign page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {interviewContentAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No content library items found. Add assets in the Content Library first, or skip this step.</p>
              ) : (
                <>
                  {visualAssets.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visual assets</div>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {visualAssets.map((a) => {
                          const checked = selectedInterviewAssets.includes(a.id);
                          return (
                            <label
                              key={a.id}
                              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                              data-testid={`label-visual-asset-${a.id}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) =>
                                  setSelectedInterviewAssets((prev) =>
                                    v ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                                  )
                                }
                                data-testid={`checkbox-visual-${a.id}`}
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{a.title}</div>
                                {a.fileUrl && <div className="text-xs text-muted-foreground truncate">{a.fileUrl}</div>}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {digitalAssets.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Digital assets</div>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {digitalAssets.map((a) => {
                          const checked = selectedInterviewAssets.includes(a.id);
                          return (
                            <label
                              key={a.id}
                              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                              data-testid={`label-digital-asset-${a.id}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) =>
                                  setSelectedInterviewAssets((prev) =>
                                    v ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                                  )
                                }
                                data-testid={`checkbox-digital-${a.id}`}
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{a.title}</div>
                                {a.url && <div className="text-xs text-muted-foreground truncate">{a.url}</div>}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-muted-foreground">
                  {selectedInterviewAssets.length > 0
                    ? `${selectedInterviewAssets.length} asset${selectedInterviewAssets.length === 1 ? "" : "s"} selected`
                    : "Nothing selected — full library fallback will apply"}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                  <Button onClick={saveInterviewAssets} disabled={savingInterviewAssets} data-testid="button-save-interview-assets">
                    {savingInterviewAssets ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Continue"}
                    {!savingInterviewAssets && <ChevronRight className="h-4 w-4 ml-1" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 4: Generate ── */}
        {step === 4 && result && (
          <Card>
            <CardHeader>
              <CardTitle>On the calendar</CardTitle>
              <CardDescription>
                {deliverables.length} document{deliverables.length === 1 ? "" : "s"}
                {socialPosts.length > 0 && ` and ${socialPosts.length} social post${socialPosts.length === 1 ? "" : "s"}`} are scheduled.
                {deliverables.length > 0 && " Draft the documents now, or draft individually later from the editorial calendar."}
                {socialPosts.length > 0 && " Social posts are ready to schedule — no drafting needed."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {drafting || Object.keys(draftStatus).length > 0 ? (
                <Progress value={deliverables.length ? (draftedCount / deliverables.length) * 100 : 0} />
              ) : null}

              {deliverables.length > 0 && (
              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {deliverables.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 p-2.5 text-sm" data-testid={`row-deliverable-${d.id}`}>
                    <span className="text-muted-foreground w-24 shrink-0">
                      {d.scheduledAt ? formatDate(new Date(d.scheduledAt), "MMM d, yyyy") : "—"}
                    </span>
                    <Badge variant="outline" className="shrink-0">{FORMAT_LABELS[d.format] ?? d.format}</Badge>
                    <span className="truncate flex-1">{d.title}</span>
                    {draftStatus[d.id] === "pending" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                    {draftStatus[d.id] === "ok" && <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />}
                    {draftStatus[d.id] === "error" && <CircleAlert className="h-4 w-4 text-destructive shrink-0" />}
                  </div>
                ))}
              </div>
              )}

              {socialPosts.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Social posts — ready to schedule</div>
                  <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                    {socialPosts.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-2.5 text-sm" data-testid={`row-social-${p.id}`}>
                        <span className="text-muted-foreground w-24 shrink-0">
                          {p.scheduledDate ? formatDate(new Date(p.scheduledDate), "MMM d, yyyy") : "—"}
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {SOCIAL_CHANNEL_LABELS[p.platform] ?? p.platform}
                        </Badge>
                        <span className="truncate flex-1">{p.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button asChild variant="outline">
                    <Link href="/app/marketing/marketing-calendar">Open marketing calendar</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/app/marketing/campaigns/${result.campaign.id}`}>Open campaign</Link>
                  </Button>
                </div>
                <Button onClick={draftAll} disabled={drafting || deliverables.length === 0} data-testid="button-draft-all">
                  {drafting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Drafting {draftedCount}/{deliverables.length}…</>
                  ) : draftedCount > 0 ? (
                    <><Sparkles className="h-4 w-4 mr-2" /> Re-run remaining drafts</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" /> Draft all content now</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
