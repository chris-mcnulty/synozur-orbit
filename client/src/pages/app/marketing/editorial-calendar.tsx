import { useState } from "react";
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
  CalendarDays,
  Loader2,
  Sparkles,
  PenLine,
  Trash2,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { FeatureGate } from "@/components/UpgradePrompt";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  body: string;
  meta: string | null;
  format: string;
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
  other: "Other",
};

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

const STATUS_OPTIONS = ["suggested", "accepted", "in_progress", "scheduled", "removed"];

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

export default function EditorialCalendarPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState(15);
  const [draft, setDraft] = useState<DraftResult | null>(null);

  const { data: tenant } = useQuery<{ features?: Record<string, boolean> } | null>({
    queryKey: ["/api/tenant/info"],
    queryFn: () => getJson("/api/tenant/info"),
  });
  const allowed = tenant?.features?.editorialCalendar !== false;

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

  const draftBrief = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/content-briefs/${id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to draft content");
      return res.json();
    },
    onSuccess: (data: { draft: DraftResult }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/editorial-calendars", activeId] });
      setDraft(data.draft);
      toast.success("Draft created and saved to the content library");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
  const funnelCounts = briefs.reduce<Record<string, number>>((acc, b) => {
    acc[b.funnelStage] = (acc[b.funnelStage] ?? 0) + 1;
    return acc;
  }, {});
  const pct = (n: number) => (briefs.length ? Math.round((n / briefs.length) * 100) : 0);

  return (
    <AppLayout>
      <FeatureGate
        feature="Editorial Calendar"
        requiredPlan="Enterprise"
        isAllowed={allowed}
        description="Generate demand-scored content briefs grounded in your messaging framework, competitive gaps, personas, and SEO demand. Upgrade to unlock the Editorial Calendar."
      >
        <div className="space-y-6 p-1">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <CalendarDays className="h-6 w-6 text-primary" />
                Editorial Calendar
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

          {/* Funnel summary */}
          {briefs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {briefs.length} briefs · funnel mix
                </CardTitle>
                <CardDescription>Target balance: 40% awareness · 35% consideration · 25% decision</CardDescription>
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
          ) : (
            <div className="grid gap-3">
              {briefs.map((b) => (
                <Card key={b.id} data-testid={`brief-${b.id}`}>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${FUNNEL_BADGE[b.funnelStage] ?? ""}`}>
                            {FUNNEL_LABELS[b.funnelStage] ?? b.funnelStage}
                          </span>
                          <Badge variant="secondary">{FORMAT_LABELS[b.format] ?? b.format}</Badge>
                          {b.status === "drafted" && <Badge>Drafted</Badge>}
                          {b.targetKeyword && (
                            <span className="text-xs text-muted-foreground">🔑 {b.targetKeyword}</span>
                          )}
                          {b.estimatedHours != null && (
                            <span className="text-xs text-muted-foreground">~{b.estimatedHours}h</span>
                          )}
                        </div>
                        <p className="font-medium">{b.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
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
                                {s.replace("_", " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={draftBrief.isPending}
                          onClick={() => draftBrief.mutate(b.id)}
                          data-testid={`draft-${b.id}`}
                        >
                          {draftBrief.isPending && draftBrief.variables === b.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <PenLine className="mr-1 h-4 w-4" />
                          )}
                          {b.contentAssetId ? "Re-draft" : "Draft"}
                        </Button>
                      </div>
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
        <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{draft?.title}</DialogTitle>
              {draft?.meta && <DialogDescription>{draft.meta}</DialogDescription>}
            </DialogHeader>
            <div className="rounded-md bg-muted/40 p-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm">{draft?.body}</pre>
            </div>
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>AI-generated draft. Saved to your content library — review and edit before publishing.</span>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
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
              <Button onClick={() => setDraft(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </FeatureGate>
    </AppLayout>
  );
}
