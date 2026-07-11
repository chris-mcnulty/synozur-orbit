import { useState, useEffect, useRef } from "react";

/**
 * Reads a single URL search param on mount, then — once matching items are
 * available — scrolls `[data-testid="${testIdPrefix}-${id}"]` into view,
 * fires an optional `onFound` callback, and clears the highlight after
 * `clearAfterMs` (default 2 500 ms).
 *
 * Returns `[focusId, clearFocus]`.  Drive the ring CSS on each list item with:
 *   `focusId === item.id ? "ring-2 ring-primary ring-offset-2" : ""`
 *
 * Using a shared hook keeps the URL-param name, the testid prefix, and the
 * scroll/highlight logic in one place so that a rename of any of the three
 * breaks ONE test instead of being silently swallowed.
 */
export function useDeepLinkFocus<T extends { id: string }>(opts: {
  /** The query-string param that carries the target id (e.g. "brief"). */
  paramName: string;
  /** The live list of items to search; pass an empty array while loading. */
  items: T[] | undefined;
  /**
   * Prefix used to build the element selector:
   *   `[data-testid="${testIdPrefix}-${id}"]`
   */
  testIdPrefix: string;
  /** Optional side-effect to run when the target item is found (e.g. open an
   *  editor).  Stable ref semantics — changes to this function after mount are
   *  ignored intentionally, matching the original per-page behaviour where
   *  `openDraft` was excluded from effect deps. */
  onFound?: (item: T) => void;
  /** How long (ms) the highlight ring stays visible. Default: 2500. */
  clearAfterMs?: number;
}): [string | null, () => void] {
  const { paramName, items, testIdPrefix, clearAfterMs = 2500 } = opts;

  const onFoundRef = useRef(opts.onFound);
  useEffect(() => { onFoundRef.current = opts.onFound; }, [opts.onFound]);

  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get(paramName)
      : null,
  );

  useEffect(() => {
    if (!focusId || !items?.length) return;
    const item = items.find((i) => i.id === focusId);
    if (!item) return;
    const el = document.querySelector(
      `[data-testid="${testIdPrefix}-${focusId}"]`,
    );
    if (!el) return;
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    onFoundRef.current?.(item);
    const t = setTimeout(() => setFocusId(null), clearAfterMs);
    return () => clearTimeout(t);
  }, [focusId, items, testIdPrefix, clearAfterMs]);

  return [focusId, () => setFocusId(null)];
}
