import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Eye, Loader2, ShieldCheck } from "lucide-react";
import type { ApolloRevealPreview, ApolloRevealStatus } from "@shared/apollo-reveal";
import { MAX_APOLLO_REVEAL_BATCH } from "@shared/apollo-reveal";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface RevealedCandidate {
  candidate: {
    name: string;
    title: string | null;
    companyName: string | null;
    email: string | null;
    linkedinUrl: string | null;
    geography: string | null;
    industry: string | null;
    segment: string | null;
    sourceUrl: string | null;
    confidence?: "verified" | "reconfirm" | null;
    source: "web" | "salesnav" | "apollo";
  };
  scored: { score: number; qualified: boolean; disqualified: boolean };
}

interface RevealResponse {
  candidates: RevealedCandidate[];
  outcomes: Array<{ previewId: string; status: ApolloRevealStatus; message: string }>;
  attemptedCount: number;
}

interface ApolloRevealPreviewProps {
  campaignId: string;
  previews: ApolloRevealPreview[];
  onRevealed: (candidates: RevealedCandidate[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

function expirationLabel(expiresAt: string, now: number) {
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining)) return "Expiration unavailable";
  if (remaining <= 0) return "Expired";
  const minutes = Math.floor(remaining / 60_000);
  return minutes < 1 ? "Expires in under a minute" : `Expires in ${minutes} min`;
}

function statusLabel(status: ApolloRevealStatus) {
  switch (status) {
    case "revealed": return "Revealed";
    case "unavailable": return "Unavailable";
    case "out_of_scope": return "Outside campaign scope";
    case "already_attempted": return "Already attempted";
    case "failed": return "Reveal failed";
  }
}

export default function ApolloRevealPreview({
  campaignId,
  previews,
  onRevealed,
  onBusyChange,
  disabled = false,
}: ApolloRevealPreviewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [attemptedIds, setAttemptedIds] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [lastOutcomes, setLastOutcomes] = useState<RevealResponse["outcomes"]>([]);
  const [unknownAttempt, setUnknownAttempt] = useState(false);
  const busyRef = useRef(false);
  const selectedPreviews = useMemo(
    () => previews.filter((preview) => selectedIds.has(preview.id)),
    [previews, selectedIds],
  );
  const activeSelected = selectedPreviews.filter((preview) => {
    const expires = new Date(preview.expiresAt).getTime();
    return !attemptedIds.has(preview.id) && Number.isFinite(expires) && expires > now;
  });
  const availablePreviews = useMemo(() => previews.filter((preview) => {
    const expires = new Date(preview.expiresAt).getTime();
    return !attemptedIds.has(preview.id) && Number.isFinite(expires) && expires > now;
  }), [previews, attemptedIds, now]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const reveal = useMutation({
    retry: false,
    mutationFn: async (tokens: string[]) => {
      const response = await apiRequest(
        "POST",
        `/api/sales-outreach/campaigns/${campaignId}/discover/reveal`,
        { tokens, confirmCredits: true },
      );
      return response.json() as Promise<RevealResponse>;
    },
    onMutate: (tokens) => {
      const ids = previews.filter((preview) => tokens.includes(preview.token)).map((preview) => preview.id);
      setAttemptedIds((current) => new Set([...current, ...ids]));
      setUnknownAttempt(false);
      onBusyChange?.(true);
    },
    onSuccess: (result) => {
      setLastOutcomes(result.outcomes ?? []);
      setUnknownAttempt(false);
      setSelectedIds(new Set());
      setConfirming(false);
      onRevealed(result.candidates ?? []);
    },
    onError: () => {
      // The request may have reached Apollo. These previews must never be retried.
      setUnknownAttempt(true);
      setSelectedIds(new Set());
      setConfirming(false);
    },
    onSettled: () => { busyRef.current = false; onBusyChange?.(false); },
  });

  function togglePreview(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_APOLLO_REVEAL_BATCH) {
        next.add(id);
      }
      return next;
    });
    setConfirming(false);
    setLastOutcomes([]);
    setUnknownAttempt(false);
  }

  function beginReview() {
    if (!disabled && activeSelected.length > 0) setConfirming(true);
  }

  function confirmReveal() {
    if (busyRef.current || disabled) return;
    const stillAvailable = selectedPreviews.filter((preview) => {
      const expires = new Date(preview.expiresAt).getTime();
      return !attemptedIds.has(preview.id) && Number.isFinite(expires) && expires > Date.now();
    });
    if (!stillAvailable.length || stillAvailable.length !== selectedPreviews.length) {
      setNow(Date.now());
      setSelectedIds(new Set(stillAvailable.map((preview) => preview.id)));
      setConfirming(false);
      return;
    }
    busyRef.current = true;
    reveal.mutate(stillAvailable.map((preview) => preview.token));
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-3" data-testid="apollo-reveal-preview">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Eye className="h-4 w-4 text-primary" /> Review Apollo contact previews
          </h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            These are masked matches, not contact records. Select people to reveal them; nothing is imported or sent.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">{availablePreviews.length} available</Badge>
      </div>

      {previews.length > 0 ? (
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {previews.map((preview) => {
            const expires = new Date(preview.expiresAt).getTime();
            const expired = !Number.isFinite(expires) || expires <= now;
            const attempted = attemptedIds.has(preview.id);
            const rowDisabled = disabled || expired || attempted || reveal.isPending;
            return (
              <label
                key={preview.id}
                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${selectedIds.has(preview.id) ? "border-primary/40 bg-primary/5" : "border-border bg-background/70"} ${rowDisabled ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
                data-testid={`apollo-preview-${preview.id}`}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selectedIds.has(preview.id)}
                  disabled={rowDisabled || (!selectedIds.has(preview.id) && selectedIds.size >= MAX_APOLLO_REVEAL_BATCH)}
                  onCheckedChange={() => togglePreview(preview.id)}
                  aria-label={`Select masked Apollo preview ${preview.displayName}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">{preview.displayName}</span>
                    {preview.title && <span className="text-xs text-muted-foreground">{preview.title}</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[preview.companyName, preview.companyDomain].filter(Boolean).join(" · ") || "Company not listed"}
                  </span>
                  <span className={`mt-1 inline-flex items-center gap-1 text-[11px] ${expired ? "text-destructive" : "text-muted-foreground"}`}>
                    <Clock3 className="h-3 w-3" /> {expirationLabel(preview.expiresAt, now)}
                    {attempted && <span>· Reveal already attempted</span>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No masked Apollo matches were returned for this search.
        </p>
      )}

      {availablePreviews.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{activeSelected.length} selected · up to {activeSelected.length} Apollo credits</span>
            <span>Maximum {MAX_APOLLO_REVEAL_BATCH} people per reveal</span>
          </div>
          {!confirming ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={beginReview}
              disabled={disabled || !activeSelected.length || reveal.isPending}
              data-testid="button-review-apollo-reveal"
            >
              Review paid reveal
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-amber-300/70 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100">
              <p className="flex items-start gap-2 text-xs leading-relaxed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Reveal {activeSelected.length} selected {activeSelected.length === 1 ? "person" : "people"}? This requests demographic details and work email only—no phones, personal emails, or waterfall enrichment—and may use up to {activeSelected.length} Apollo credits. Actual billing is determined by Apollo. Each selection is attempted once; this action does not import or send.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={confirmReveal} disabled={disabled || reveal.isPending} data-testid="button-confirm-apollo-reveal">
                  {reveal.isPending ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Revealing…</> : <><ShieldCheck className="mr-1.5 h-4 w-4" />Confirm paid reveal</>}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={reveal.isPending}>Go back</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {reveal.isPending && (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground" role="status" aria-live="polite">
          Apollo reveal is in progress. Keep this dialog open; selected previews are locked against duplicate attempts.
        </p>
      )}
      {unknownAttempt && (
        <p className="rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100" role="alert">
          The reveal response could not be confirmed. These previews are disabled to prevent a duplicate paid attempt. Run a new discovery search for fresh previews.
        </p>
      )}
      {lastOutcomes.length > 0 && (
        <div className="space-y-1 rounded-md border border-border bg-background/70 p-3" role="status" aria-live="polite" data-testid="apollo-reveal-outcomes">
          <p className="text-xs font-semibold text-foreground">Reveal finished · {lastOutcomes.filter((outcome) => outcome.status === "revealed").length} revealed</p>
          {lastOutcomes.filter((outcome) => outcome.status !== "revealed").map((outcome) => (
            <p key={outcome.previewId} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{statusLabel(outcome.status)}:</span> {outcome.message}
            </p>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">Revealed contacts are in the import review list below and are not selected automatically.</p>
        </div>
      )}
    </section>
  );
}
