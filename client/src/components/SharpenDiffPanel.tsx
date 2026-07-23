import React from "react";

type DiffOp = { type: "equal" | "remove" | "insert"; value: string };

function tokenize(text: string): string[] {
  return text.split(/(\s+)/);
}

function computeDiff(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const m = a.length;
  const n = b.length;

  if (m === 0 && n === 0) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: "equal", value: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "insert", value: b[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "remove", value: a[i - 1] });
      i--;
    }
  }
  return ops;
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
  const ops = React.useMemo(() => computeDiff(before, after), [before, after]);

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
      )
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
      )
    );

  return (
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
  );
}
