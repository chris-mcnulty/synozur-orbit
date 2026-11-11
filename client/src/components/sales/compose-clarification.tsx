import { AlertCircle, ArrowRight, Clock3, FileX2, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ComposeClarificationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientName: string;
  channelLabel: string;
  code: string;
  explanation: string;
  questions: string[];
  additionalContext: string;
  onContextChange: (value: string) => void;
  retryError: string;
  isPending: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

/**
 * Renders model-provided clarification as readable plain text rather than
 * exposing its Markdown formatting or interpreting it as HTML.
 */
export function formatClarificationText(text: string): string {
  return text
    .replace(/^\d{3}:\s*/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line
      .replace(/^\s*```[a-z]*\s*$/i, "")
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/, "")
      .replace(/^\s{0,3}>\s?/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(`{1,3})(.*?)\1/g, "$2")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
      .trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const knownOperatorCodes: Record<string, { title: string; savedDraftNotice: string }> = {
  OUTREACH_NEEDS_INPUT: {
    title: "Clarify before drafting",
    savedDraftNotice: "The assistant needs your input. No draft was saved. Answer below, then retry drafting. Nothing is sent automatically.",
  },
  OUTREACH_REFUSED: {
    title: "Drafting could not proceed",
    savedDraftNotice: "Orbit could not fulfill this drafting request. No draft was saved or sent. The explanation below is private and is not a message to the recipient.",
  },
  OUTREACH_INVALID_DRAFT: {
    title: "Orbit could not finish this draft",
    savedDraftNotice: "Orbit generated a draft that failed its own checks. This is not an error in your input. No additional context is required. Nothing was saved or sent.",
  },
};

export function ComposeClarification({
  open,
  onOpenChange,
  recipientName,
  channelLabel,
  code,
  explanation,
  questions,
  additionalContext,
  onContextChange,
  retryError,
  isPending,
  onRetry,
  onDiscard,
}: ComposeClarificationProps) {
  const knownCode = knownOperatorCodes[code];
  const needsInput = code === "OUTREACH_NEEDS_INPUT";
  const title = knownCode?.title ?? "Drafting could not finish";
  const formattedExplanation = formatClarificationText(explanation);
  const formattedQuestions = questions
    .map(formatClarificationText)
    .filter(Boolean);

  const requestClose = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (nextOpen || !isPending) onOpenChange(nextOpen);
    }}>
      <DialogContent
        className="flex max-h-[min(90dvh,48rem)] w-[calc(100%-1.25rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl border-border/80 bg-background p-0 shadow-xl"
        hideCloseButton
        data-testid="dialog-compose-clarification"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="relative shrink-0 border-b border-border/70 bg-muted/35 px-5 pb-4 pt-5 text-left sm:px-7 sm:pt-6">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Private to you
            </span>
            <span aria-hidden="true">/</span>
            <span>{needsInput ? "Outreach clarification" : "Draft generation"}</span>
          </div>
          <DialogTitle className="pr-10 text-xl font-semibold tracking-tight sm:text-2xl" data-testid="compose-clarification-title">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-xl text-sm leading-relaxed">
            {knownCode?.savedDraftNotice ?? "Orbit could not finish generating the draft. Nothing was sent. You can retry without adding context."}
          </DialogDescription>
          <button
            type="button"
            onClick={requestClose}
            disabled={isPending}
            aria-label="Keep clarification for later"
            data-testid="button-compose-clarification-close"
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 sm:right-5 sm:top-5"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <section aria-label="Outreach recipient and channel" className="flex flex-wrap gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 rounded-md border border-border/80 bg-muted/35 px-3 py-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">To</span>
              <span className="truncate font-medium text-foreground">{recipientName}</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-muted/35 px-3 py-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Channel</span>
              <span className="font-medium text-foreground">{channelLabel}</span>
            </span>
          </section>

          {formattedExplanation && (
            <section
              className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3.5"
              data-testid="compose-clarification-explanation"
              aria-label={needsInput ? "Why clarification is needed" : "Generation error"}
            >
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                {needsInput ? "What needs attention" : "What happened"}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{formattedExplanation}</p>
            </section>
          )}

          {needsInput && formattedQuestions.length > 0 && (
            <section
              className="space-y-2.5"
              aria-label="Questions for you"
              data-testid="compose-clarification-questions"
            >
              <h3 className="text-sm font-semibold text-foreground">A few things to clarify</h3>
              <ol className="space-y-2">
                {formattedQuestions.map((question, index) => (
                  <li key={`${index}-${question}`} className="flex gap-3 rounded-lg border border-border/70 bg-card px-3.5 py-3 text-sm leading-relaxed">
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="whitespace-pre-wrap break-words">{question}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {needsInput && <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <Label htmlFor="input-compose-additional-context" className="text-sm font-semibold">
                Your private context
              </Label>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid="compose-context-count">
                {additionalContext.length}/6000
              </span>
            </div>
            <Textarea
              id="input-compose-additional-context"
              value={additionalContext}
              onChange={(event) => onContextChange(event.target.value.slice(0, 6000))}
              disabled={isPending}
              maxLength={6000}
              rows={5}
              placeholder="Add accurate facts or answers that can help shape the outreach."
              className="min-h-32 resize-y rounded-lg border-border/80 bg-card text-sm leading-relaxed placeholder:text-muted-foreground/75 focus-visible:ring-2"
              data-testid="input-compose-additional-context"
              aria-describedby="compose-context-help"
            />
            <p id="compose-context-help" className="text-xs leading-relaxed text-muted-foreground">
              Only used to help you prepare this draft. It is not part of the message to {recipientName}.
            </p>
          </div>}

          {retryError && (
            <div
              className="flex gap-2.5 rounded-lg border border-destructive/35 bg-destructive/[0.06] px-3.5 py-3 text-sm text-destructive"
              role="alert"
              data-testid="compose-retry-error"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="leading-relaxed">{retryError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3 border-t border-border/70 bg-background px-5 py-4 sm:flex-col sm:items-stretch sm:space-x-0 sm:gap-3 sm:px-7">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{needsInput ? "Keep for later closes this window without discarding your answers on this page." : "Retry uses the same saved brief and any context you already provided."}</span>
          </div>
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onDiscard}
              disabled={isPending}
              data-testid="button-compose-clarification-discard"
              className="text-muted-foreground hover:text-destructive"
            >
              <FileX2 className="mr-2 h-4 w-4" />
              {needsInput ? "Discard clarification" : "Dismiss"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
              disabled={isPending}
              data-testid="button-compose-clarification-later"
            >
              Keep for later
            </Button>
            <Button
              type="button"
              onClick={onRetry}
              disabled={isPending}
              data-testid="button-compose-retry"
              className="sm:min-w-40"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {isPending ? "Drafting…" : "Retry drafting"}
              {!isPending && <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ComposeClarification;
