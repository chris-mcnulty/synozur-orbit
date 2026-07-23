import React from "react";

const WORD_DIFF_THRESHOLD = 2000;
const MAX_PARAGRAPHS = 500;

type DiffOp = { type: "equal" | "remove" | "insert"; value: string };
type DiffMode = "word" | "paragraph" | "summary";

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/);
}

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): DiffOp[] {
  const m = a.length;
  const n = b.length;

  if (m === 0 && n === 0) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = eq(a[i - 1], b[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && eq(a[i - 1], b[j - 1])) {
      ops.unshift({ type: "equal", value: a[i - 1] as unknown as string });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "insert", value: b[j - 1] as unknown as string });
      j--;
    } else {
      ops.unshift({ type: "remove", value: a[i - 1] as unknown as string });
      i--;
    }
  }
  return ops;
}

function computeWordDiff(before: string, after: string): DiffOp[] {
  return lcs(tokenize(before), tokenize(after));
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n/);
}

function quickLineCounts(
  before: string[],
  after: string[],
): { removed: number; added: number; unchanged: number } {
  const beforeSet = new Set(before.filter((l) => l.trim() !== ""));
  const afterSet = new Set(after.filter((l) => l.trim() !== ""));
  let unchanged = 0;
  for (const line of beforeSet) {
    if (afterSet.has(line)) unchanged++;
  }
  return {
    removed: beforeSet.size - unchanged,
    added: afterSet.size - unchanged,
    unchanged,
  };
}

function computeDiff(
  before: string,
  after: string,
): { ops: DiffOp[]; mode: DiffMode; summaryStats?: { removed: number; added: number; unchanged: number } } {
  const totalWords = countWords(before) + countWords(after);
  if (totalWords > WORD_DIFF_THRESHOLD) {
    const a = splitParagraphs(before);
    const b = splitParagraphs(after);
    if (a.length > MAX_PARAGRAPHS || b.length > MAX_PARAGRAPHS) {
      return {
        ops: [],
        mode: "summary",
        summaryStats: quickLineCounts(a, b),
      };
    }
    return { ops: lcs(a, b), mode: "paragraph" };
  }
  return { ops: computeWordDiff(before, after), mode: "word" };
}

interface SharpenDiffPanelProps {
  before: string;
  after: string;
  maxHeight?: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export function SharpenDiffPanel({
  before,
  after,
  maxHeight = "max-h-48",
  beforeLabel = "Before",
  afterLabel = "After",
}: SharpenDiffPanelProps) {
  const { ops, mode, summaryStats } = React.useMemo(
    () => computeDiff(before, after),
    [before, after],
  );

  const isParagraph = mode === "paragraph";
  const isSummary = mode === "summary";

  if (isSummary) {
    return (
      <div className="space-y-1">
        <p className="text-[10px] text-muted-foreground italic">
          Documents are too large to diff inline
          {summaryStats && (
            <>
              {" — "}
              {summaryStats.removed > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  ~{summaryStats.removed} line{summaryStats.removed !== 1 ? "s" : ""} removed
                </span>
              )}
              {summaryStats.removed > 0 && summaryStats.added > 0 && ", "}
              {summaryStats.added > 0 && (
                <span className="text-green-600 dark:text-green-400">
                  ~{summaryStats.added} line{summaryStats.added !== 1 ? "s" : ""} added
                </span>
              )}
              {summaryStats.removed === 0 && summaryStats.added === 0 && " — no significant changes detected"}
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              {beforeLabel}
            </p>
            <div
              className={`${maxHeight} overflow-y-auto rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-black/20 p-2 text-xs whitespace-pre-wrap`}
              data-testid="sharpen-before"
            >
              {before}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              {afterLabel}
            </p>
            <div
              className={`${maxHeight} overflow-y-auto rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-black/20 p-2 text-xs whitespace-pre-wrap`}
              data-testid="sharpen-after"
            >
              {after}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const beforeNodes = ops
    .filter((op) => op.type !== "insert")
    .map((op, i) =>
      op.type === "remove" ? (
        isParagraph ? (
          <div
            key={i}
            className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded-sm mb-0.5"
          >
            {op.value}
          </div>
        ) : (
          <mark
            key={i}
            className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded-sm"
          >
            {op.value}
          </mark>
        )
      ) : isParagraph ? (
        <div key={i} className="mb-0.5">
          {op.value}
        </div>
      ) : (
        <React.Fragment key={i}>{op.value}</React.Fragment>
      ),
    );

  const afterNodes = ops
    .filter((op) => op.type !== "remove")
    .map((op, i) =>
      op.type === "insert" ? (
        isParagraph ? (
          <div
            key={i}
            className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-sm mb-0.5"
          >
            {op.value}
          </div>
        ) : (
          <mark
            key={i}
            className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-sm"
          >
            {op.value}
          </mark>
        )
      ) : isParagraph ? (
        <div key={i} className="mb-0.5">
          {op.value}
        </div>
      ) : (
        <React.Fragment key={i}>{op.value}</React.Fragment>
      ),
    );

  return (
    <div className="space-y-1">
      {isParagraph && (
        <p className="text-[10px] text-muted-foreground italic">
          Large document — showing line-level changes
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {beforeLabel}
          </p>
          <div
            className={`${maxHeight} overflow-y-auto rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-black/20 p-2 text-xs whitespace-pre-wrap`}
            data-testid="sharpen-before"
          >
            {beforeNodes}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {afterLabel}
          </p>
          <div
            className={`${maxHeight} overflow-y-auto rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-black/20 p-2 text-xs whitespace-pre-wrap`}
            data-testid="sharpen-after"
          >
            {afterNodes}
          </div>
        </div>
      </div>
    </div>
  );
}
