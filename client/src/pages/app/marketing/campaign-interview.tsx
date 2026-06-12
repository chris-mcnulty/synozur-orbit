import { useEffect, useMemo, useState } from "react";
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
import { Link } from "wouter";
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

const STEPS = ["Interview", "Curate briefs", "Plan outputs", "Generate"];

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

export default function CampaignInterviewPage() {
  const { toast } = useToast();
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
      const initialPlan: Record<string, PlanSelection[]> = {};
      for (const b of keptBriefs) {
        const cats = (b.formCategories ?? []).filter((c): c is ContentFormCategory =>
          (CONTENT_FORM_CATEGORIES as readonly string[]).includes(c),
        );
        initialPlan[b.id] = cats.flatMap((cat) => {
          // Short-form social spans two primary channels — pre-select BOTH
          // LinkedIn and X by default so social coverage isn't single-channel.
          // (A newsletter-only short-form brief keeps just its own format.)
          if (cat === "short_form" && b.format !== "newsletter") {
            return (["linkedin_post", "x_post"] as const).map((fmt) => ({
              format: fmt,
              count: DEFAULT_COUNT[fmt] ?? 1,
              windowKey: String(DEFAULT_WINDOW_BY_CATEGORY[cat]),
            }));
          }
          const fmt =
            cat === "mid_form" && b.format === "press_release"
              ? "press_release"
              : FORM_CATEGORY_FORMATS[cat].includes(b.format as any)
                ? b.format
                : FORM_CATEGORY_FORMATS[cat][0];
          return [{
            format: fmt,
            count: DEFAULT_COUNT[fmt] ?? 1,
            windowKey: String(DEFAULT_WINDOW_BY_CATEGORY[cat]),
          }];
        });
      }
      setPlan(initialPlan);
      setStep(2);
    },
    onError: (err: Error) => toast({ title: "Could not save selections", description: err.message, variant: "destructive" }),
  });

  // ── Step 2: output plan ──────────────────────────────────────────────────
  const [plan, setPlan] = useState<Record<string, PlanSelection[]>>({});

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

  const totalPlanned = useMemo(
    () => Object.values(plan).flat().reduce((sum, i) => sum + i.count, 0),
    [plan],
  );

  const [deliverables, setDeliverables] = useState<Brief[]>([]);

  const expandPlan = useMutation({
    mutationFn: async () => {
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
      return apiJson(`/api/campaign-interview/${result!.campaign.id}/expand-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, tzOffsetMinutes: new Date().getTimezoneOffset() }),
      }) as Promise<{ briefs: Brief[] }>;
    },
    onSuccess: (data) => {
      setDeliverables(
        [...data.briefs].sort(
          (a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime(),
        ),
      );
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
                    <Label>Top news items for this release (3–6)</Label>
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
                        {FORM_CATEGORY_FORMATS[cat].map((fmt) => {
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
                </div>
              ))}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-muted-foreground">{totalPlanned} piece{totalPlanned === 1 ? "" : "s"} planned</div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)}>
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

        {/* ── Step 3: Generate ── */}
        {step === 3 && result && (
          <Card>
            <CardHeader>
              <CardTitle>On the calendar</CardTitle>
              <CardDescription>
                {deliverables.length} piece{deliverables.length === 1 ? "" : "s"} are scheduled. Draft them all now, or draft individually later from the editorial calendar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {drafting || Object.keys(draftStatus).length > 0 ? (
                <Progress value={deliverables.length ? (draftedCount / deliverables.length) * 100 : 0} />
              ) : null}

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
