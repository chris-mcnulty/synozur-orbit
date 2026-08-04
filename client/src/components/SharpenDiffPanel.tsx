import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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

// ── Paragraph-mode segment grouping ──────────────────────────────────────────

/** A run of equal lines shown verbatim in both columns. */
type EqualSegment = { type: "equal"; ops: DiffOp[] };

/**
 * A run that contains BOTH removed AND inserted lines — rendered as a
 * collapsible "~N lines replaced" block spanning both columns.
 */
type ReplacedSegment = { type: "replaced"; removes: DiffOp[]; inserts: DiffOp[] };

/**
 * A run of ONLY removed lines (no corresponding inserts) or ONLY inserted
 * lines (no corresponding removes). Rendered as normal inline coloured lines
 * in the appropriate column; the opposite column stays empty for those rows.
 */
type PureChangeSegment = { type: "pure_change"; removes: DiffOp[]; inserts: DiffOp[] };

type DiffSegment = EqualSegment | ReplacedSegment | PureChangeSegment;

/**
 * Groups consecutive remove/insert ops into typed segments.
 * A "replaced" segment is only created when the run has BOTH removals and
 * insertions. Pure-remove or pure-insert runs become "pure_change" segments
 * and are rendered as plain coloured lines (not collapsed).
 */
export function groupParagraphOps(ops: DiffOp[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "remove" || op.type === "insert") {
      const removes: DiffOp[] = [];
      const inserts: DiffOp[] = [];
      while (i < ops.length && (ops[i].type === "remove" || ops[i].type === "insert")) {
        if (ops[i].type === "remove") removes.push(ops[i]);
        else inserts.push(ops[i]);
        i++;
      }
      if (removes.length > 0 && inserts.length > 0) {
        segments.push({ type: "replaced", removes, inserts });
      } else {
        segments.push({ type: "pure_change", removes, inserts });
      }
    } else {
      const equalOps: DiffOp[] = [];
      while (i < ops.length && ops[i].type === "equal") {
        equalOps.push(ops[i]);
        i++;
      }
      segments.push({ type: "equal", ops: equalOps });
    }
  }

  return segments;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ReplacedBlock({
  removes,
  inserts,
  segIdx,
}: {
  removes: DiffOp[];
  inserts: DiffOp[];
  segIdx: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const lineCount = Math.max(removes.length, inserts.length);
  const nonEmptyRemoves = removes.filter((op) => op.value.trim() !== "");
  const nonEmptyInserts = inserts.filter((op) => op.value.trim() !== "");
  const totalNonEmpty = nonEmptyRemoves.length + nonEmptyInserts.length;

  // If the block is tiny (≤2 non-empty lines total), render inline — collapsing
  // a 1-line change adds more noise than it removes.
  if (totalNonEmpty <= 2) {
    return (
      <>
        {removes.map((op, k) => (
          <div
            key={`r-${segIdx}-${k}`}
            className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded-sm mb-0.5"
          >
            {op.value}
          </div>
        ))}
        {inserts.map((op, k) => (
          <div
            key={`i-${segIdx}-${k}`}
            className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-sm mb-0.5"
          >
            {op.value}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="mb-1">
      {/* Collapsed banner */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 w-full text-left px-2 py-0.5 rounded text-[11px] font-medium
                   bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800
                   text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40
                   transition-colors"
        data-testid={`sharpen-replaced-toggle-${segIdx}`}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span>
          ~{lineCount} line{lineCount !== 1 ? "s" : ""} replaced
        </span>
      </button>

      {/* Expanded inline view */}
      {expanded && (
        <div
          className="mt-0.5 border border-amber-200 dark:border-amber-800 rounded overflow-hidden"
          data-testid={`sharpen-replaced-content-${segIdx}`}
        >
          <div className="grid grid-cols-2 divide-x divide-amber-200 dark:divide-amber-800">
            <div className="p-1.5 space-y-0.5">
              {removes.map((op, k) => (
                <div
                  key={k}
                  className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded-sm px-0.5"
                >
                  {op.value || "\u00a0"}
                </div>
              ))}
            </div>
            <div className="p-1.5 space-y-0.5">
              {inserts.map((op, k) => (
                <div
                  key={k}
                  className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-sm px-0.5"
                >
                  {op.value || "\u00a0"}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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

  // ── Paragraph mode: grouped rendering ──────────────────────────────────────
  if (isParagraph) {
    const segments = groupParagraphOps(ops);

    const rows: React.ReactNode[] = [];

    segments.forEach((seg, segIdx) => {
      if (seg.type === "equal") {
        seg.ops.forEach((op, k) => {
          rows.push(
            <React.Fragment key={`eq-${segIdx}-${k}`}>
              <div className="mb-0.5">{op.value}</div>
              <div className="mb-0.5">{op.value}</div>
            </React.Fragment>,
          );
        });
      } else if (seg.type === "replaced") {
        // Collapsible block spanning both columns
        rows.push(
          <div key={`rep-${segIdx}`} className="col-span-2">
            <ReplacedBlock removes={seg.removes} inserts={seg.inserts} segIdx={segIdx} />
          </div>,
        );
      } else {
        // pure_change: removes show in left column, inserts in right column
        const maxLen = Math.max(seg.removes.length, seg.inserts.length);
        for (let k = 0; k < maxLen; k++) {
          const rem = seg.removes[k];
          const ins = seg.inserts[k];
          rows.push(
            <React.Fragment key={`pc-${segIdx}-${k}`}>
              <div className="mb-0.5">
                {rem ? (
                  <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded-sm">
                    {rem.value}
                  </span>
                ) : null}
              </div>
              <div className="mb-0.5">
                {ins ? (
                  <span className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-sm">
                    {ins.value}
                  </span>
                ) : null}
              </div>
            </React.Fragment>,
          );
        }
      }
    });

    return (
      <div className="space-y-1">
        <p className="text-[10px] text-muted-foreground italic">
          Large document — showing line-level changes
        </p>
        <div className="grid grid-cols-2 gap-x-2">
          {/* Column headers */}
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {beforeLabel}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {afterLabel}
          </p>
        </div>
        {/* Unified scrollable area spanning both columns */}
        <div
          className={`${maxHeight} overflow-y-auto rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-black/20 p-2 text-xs whitespace-pre-wrap`}
          data-testid="sharpen-paragraph"
        >
          <div className="grid grid-cols-2 gap-x-2">
            {rows}
          </div>
        </div>
      </div>
    );
  }

  // ── Word mode: unchanged rendering ─────────────────────────────────────────
  const beforeNodes = ops
    .filter((op) => op.type !== "insert")
    .map((op, i) =>
      op.type === "remove" ? (
        <mark
          key={i}
          className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded-sm"
        >
          {op.value}
        </mark>
      ) : (
        <React.Fragment key={i}>{op.value}</React.Fragment>
      ),
    );

  const afterNodes = ops
    .filter((op) => op.type !== "remove")
    .map((op, i) =>
      op.type === "insert" ? (
        <mark
          key={i}
          className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-sm"
        >
          {op.value}
        </mark>
      ) : (
        <React.Fragment key={i}>{op.value}</React.Fragment>
      ),
    );

  return (
    <div className="space-y-1">
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
