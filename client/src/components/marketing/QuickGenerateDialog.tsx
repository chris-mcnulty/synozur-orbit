/**
 * Quick Generate dialog — one plain-language prompt → campaign content.
 *
 * Two paths: "Just make it" (prompt → deliverables directly) or "Show me
 * angles first" (prompt → 6-8 candidate angles with honest fit assessments →
 * pick one → deliverables drafted from prompt + chosen angle). Weak-fit
 * angles are shown marked "Not recommended" with a rationale, never hidden.
 *
 * The generated items are normal drafts (social posts, blog brief + asset,
 * newsletter email) linked to a campaign, editable through the existing
 * editors and reachable via the standard deep links.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId } from "@/lib/tabContext";
import { useToast } from "@/hooks/use-toast";
import { itemDeepLinkHref } from "@/lib/marketing-deep-links";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sparkles, Lightbulb, Loader2, ArrowLeft, ExternalLink, CheckCircle2, AlertCircle,
} from "lucide-react";

const PLATFORM_OPTIONS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
] as const;

const DELIVERABLE_OPTIONS = [
  { value: "social", label: "Social posts", hint: "Drafts in the campaign's Social Posts tab" },
  { value: "blog", label: "Blog post", hint: "Content brief with a drafted asset attached" },
  { value: "newsletter", label: "Newsletter email", hint: "Email draft in Email Newsletters" },
] as const;

type Deliverable = (typeof DELIVERABLE_OPTIONS)[number]["value"];

interface FitAssessment {
  voiceFit: string;
  topicFit: string;
  recommendation: "keep" | "reject";
  rationale: string;
}

interface QuickAngle {
  title: string;
  summary: string | null;
  angle: string;
  keyPoints: string[];
  audience: string | null;
  fitAssessment: FitAssessment;
  /** Server-issued token; must be sent back unchanged with the chosen angle. */
  token?: string;
}

interface DeliverableResult {
  ok: boolean;
  error?: string;
  postIds?: string[];
  platforms?: string[];
  briefId?: string;
  assetId?: string;
  calendarId?: string;
  title?: string;
  emailId?: string;
  subject?: string;
}

interface GenerateResponse {
  campaign: { id: string; name: string; created: boolean };
  results: Partial<Record<Deliverable, DeliverableResult>>;
}

type Step = "compose" | "angles" | "results";

interface QuickGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, content is generated into this campaign (selector hidden). */
  campaignId?: string;
  campaignName?: string;
}

function fitBadgeVariant(fit: string): "default" | "secondary" | "destructive" {
  if (fit === "strong") return "default";
  if (fit === "weak") return "destructive";
  return "secondary";
}

export function QuickGenerateDialog({ open, onOpenChange, campaignId, campaignName }: QuickGenerateDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("compose");
  const [prompt, setPrompt] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>(["social"]);
  const [platforms, setPlatforms] = useState<string[]>(["linkedin"]);
  const [campaignChoice, setCampaignChoice] = useState<string>(campaignId ?? "new");
  const [angles, setAngles] = useState<QuickAngle[]>([]);
  const [selectedAngle, setSelectedAngle] = useState<number | null>(null);
  const [response, setResponse] = useState<GenerateResponse | null>(null);

  const { data: campaignList = [] } = useQuery<{ id: string; name: string; status: string }[]>({
    queryKey: ["/api/campaigns", getTabMarketId(), "quick-generate"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/campaigns");
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.items ?? [];
      return rows.filter((c: any) => c.status !== "deleted" && c.status !== "archived");
    },
    enabled: open && !campaignId,
  });

  const promptOk = prompt.trim().length >= 12;
  const socialSelected = deliverables.includes("social");
  const composeValid = promptOk && deliverables.length > 0 && (!socialSelected || platforms.length > 0);

  const anglesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quick-generate/angles", { prompt: prompt.trim() });
      return (await res.json()) as { angles: QuickAngle[] };
    },
    onSuccess: (data) => {
      setAngles(data.angles);
      setSelectedAngle(null);
      setStep("angles");
    },
    onError: (err: any) => {
      toast({ title: "Couldn't generate angles", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (angle: QuickAngle | null) => {
      const res = await apiRequest("POST", "/api/quick-generate", {
        prompt: prompt.trim(),
        deliverables,
        platforms: socialSelected ? platforms : [],
        campaignId: campaignChoice === "new" ? undefined : campaignChoice,
        angle: angle ?? undefined,
      });
      return (await res.json()) as GenerateResponse;
    },
    onSuccess: (data) => {
      setResponse(data);
      setStep("results");
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/planning-hub"] });
      const failed = Object.values(data.results).filter((r) => r && !r.ok).length;
      if (failed > 0) {
        toast({
          title: "Some deliverables failed",
          description: "The successful ones were kept. See details in the dialog.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Quick Generate failed", description: err.message, variant: "destructive" });
    },
  });

  const busy = anglesMutation.isPending || generateMutation.isPending;

  const resetAndClose = (nextOpen: boolean) => {
    if (busy) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setStep("compose");
      setAngles([]);
      setSelectedAngle(null);
      setResponse(null);
    }
  };

  const toggleDeliverable = (d: Deliverable) => {
    setDeliverables((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const resultRows = useMemo(() => {
    if (!response) return [];
    const cid = response.campaign.id;
    return DELIVERABLE_OPTIONS.filter((d) => response.results[d.value]).map((d) => {
      const r = response.results[d.value]!;
      let href: string | undefined;
      if (r.ok) {
        if (d.value === "social" && r.postIds?.length) {
          href = itemDeepLinkHref({ itemType: "social", itemId: r.postIds[0], campaignId: cid });
        } else if (d.value === "blog" && r.briefId) {
          href = itemDeepLinkHref({ itemType: "brief", itemId: r.briefId, calendarId: r.calendarId, campaignId: cid });
        } else if (d.value === "newsletter" && r.emailId) {
          href = itemDeepLinkHref({ itemType: "email", itemId: r.emailId });
        }
      }
      return { key: d.value, label: d.label, result: r, href };
    });
  }, [response]);

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {step === "compose" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" /> Quick Generate
              </DialogTitle>
              <DialogDescription>
                Describe what you want to promote in your own words. The content will state only the
                facts you write here — nothing invented.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="quick-generate-prompt">Your prompt</Label>
                <Textarea
                  id="quick-generate-prompt"
                  rows={5}
                  placeholder={'e.g. "I\'m showing three pieces at Airfield Estates in Woodinville through September — promote the event and thank the Woodinville Arts Alliance for sponsoring."'}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  data-testid="input-quick-generate-prompt"
                />
              </div>

              <div className="space-y-1.5">
                <Label>What should be created?</Label>
                <div className="space-y-2">
                  {DELIVERABLE_OPTIONS.map((d) => (
                    <label key={d.value} className="flex items-start gap-2.5 cursor-pointer">
                      <Checkbox
                        checked={deliverables.includes(d.value)}
                        onCheckedChange={() => toggleDeliverable(d.value)}
                        data-testid={`checkbox-deliverable-${d.value}`}
                      />
                      <span className="text-sm leading-tight">
                        {d.label}
                        <span className="block text-xs text-muted-foreground">{d.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {socialSelected && (
                <div className="space-y-1.5">
                  <Label>Social platforms</Label>
                  <div className="flex flex-wrap gap-3">
                    {PLATFORM_OPTIONS.map((p) => (
                      <label key={p.value} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <Checkbox
                          checked={platforms.includes(p.value)}
                          onCheckedChange={() => togglePlatform(p.value)}
                          data-testid={`checkbox-platform-${p.value}`}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Campaign</Label>
                {campaignId ? (
                  <div className="text-sm text-muted-foreground" data-testid="text-locked-campaign">
                    {campaignName || "This campaign"}
                  </div>
                ) : (
                  <Select value={campaignChoice} onValueChange={setCampaignChoice}>
                    <SelectTrigger data-testid="select-quick-generate-campaign">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Create a new campaign from my prompt</SelectItem>
                      {campaignList.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={!composeValid || busy}
                onClick={() => anglesMutation.mutate()}
                data-testid="button-show-angles"
              >
                {anglesMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Lightbulb className="w-4 h-4" />}
                Show me angles first
              </Button>
              <Button
                className="gap-1.5"
                disabled={!composeValid || busy}
                onClick={() => generateMutation.mutate(null)}
                data-testid="button-just-make-it"
              >
                {generateMutation.isPending && !anglesMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Sparkles className="w-4 h-4" />}
                Just make it
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "angles" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5" /> Pick an angle
              </DialogTitle>
              <DialogDescription>
                Each angle is a different take on your prompt — the facts stay exactly as you wrote
                them. Weak fits are shown too, marked not recommended.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2.5 py-2">
              {angles.map((a, i) => {
                const rejected = a.fitAssessment?.recommendation === "reject";
                const selected = selectedAngle === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedAngle(i)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selected ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                    data-testid={`card-angle-${i}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm">{a.title}</div>
                      <div className="flex items-center gap-1 shrink-0">
                        {rejected ? (
                          <Badge variant="destructive" className="text-[10px]" data-testid={`badge-angle-${i}-rejected`}>
                            Not recommended
                          </Badge>
                        ) : (
                          <Badge className="text-[10px]">Recommended</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{a.angle}</p>
                    {a.keyPoints.length > 0 && (
                      <ul className="mt-1.5 text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                        {a.keyPoints.map((p, j) => <li key={j}>{p}</li>)}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <Badge variant={fitBadgeVariant(a.fitAssessment?.voiceFit)} className="text-[10px]">
                        Voice: {a.fitAssessment?.voiceFit}
                      </Badge>
                      <Badge variant={fitBadgeVariant(a.fitAssessment?.topicFit)} className="text-[10px]">
                        Topic: {a.fitAssessment?.topicFit}
                      </Badge>
                      {a.audience && (
                        <Badge variant="outline" className="text-[10px]">{a.audience}</Badge>
                      )}
                    </div>
                    {a.fitAssessment?.rationale && (
                      <p className="text-xs text-muted-foreground mt-1.5 italic">{a.fitAssessment.rationale}</p>
                    )}
                  </button>
                );
              })}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" className="gap-1.5" disabled={busy} onClick={() => setStep("compose")} data-testid="button-angles-back">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <Button
                className="gap-1.5"
                disabled={selectedAngle === null || busy}
                onClick={() => generateMutation.mutate(selectedAngle !== null ? angles[selectedAngle] : null)}
                data-testid="button-draft-with-angle"
              >
                {generateMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Sparkles className="w-4 h-4" />}
                Draft with this angle
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "results" && response && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" /> Content created
              </DialogTitle>
              <DialogDescription>
                {response.campaign.created
                  ? <>Created campaign <span className="font-medium">{response.campaign.name}</span> and attached the drafts below.</>
                  : <>Drafts attached to <span className="font-medium">{response.campaign.name}</span>.</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              {resultRows.map(({ key, label, result, href }) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  data-testid={`result-${key}`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {result.ok
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{label}</div>
                      {result.ok ? (
                        <div className="text-xs text-muted-foreground truncate">
                          {key === "social" && `${result.postIds?.length ?? 0} draft(s): ${result.platforms?.join(", ")}`}
                          {key === "blog" && result.title}
                          {key === "newsletter" && result.subject}
                        </div>
                      ) : (
                        <div className="text-xs text-destructive" data-testid={`result-${key}-error`}>
                          {result.error || "Generation failed"}
                        </div>
                      )}
                    </div>
                  </div>
                  {result.ok && href && (
                    <Button variant="outline" size="sm" asChild className="gap-1 shrink-0">
                      <Link href={href} data-testid={`link-result-${key}`}>
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" asChild className="gap-1.5">
                <Link href={`/app/marketing/campaigns/${response.campaign.id}#hub`} data-testid="link-open-campaign-hub">
                  <ExternalLink className="w-4 h-4" /> Open campaign hub
                </Link>
              </Button>
              <Button onClick={() => resetAndClose(false)} data-testid="button-quick-generate-done">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
