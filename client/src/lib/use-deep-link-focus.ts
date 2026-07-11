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
 *
 * ## Revealing hidden UI before scrolling (e.g. tab switch)
 *
 * When the target element may be hidden behind a tab or filter, use `preReveal`
 * instead of (or in addition to) `onFound`.  `preReveal` fires immediately when
 * the item is found in `items`, then the hook waits `revealDelayMs` (default
 * 120 ms) for React to re-render before it queries the DOM and scrolls.
 * `onFound` always fires after the scroll and does NOT trigger the reveal delay.
 *
 * ## In-page navigation (search-string changes without remount)
 *
 * Pass `currentSearch` (e.g. from wouter's `useSearch()`) to re-read the param
 * whenever the URL changes while the component is mounted.  Without it, the hook
 * only reads the param once on mount.
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
  /**
   * Optional: the current URL search string (e.g. from wouter `useSearch()`).
   * When provided the hook re-reads the param whenever this string changes,
   * enabling in-page navigation to trigger focus without a remount.
   */
  currentSearch?: string;
  /**
   * Optional callback that fires **before** the DOM is queried, as soon as the
   * target item appears in `items`.  Use this to reveal hidden UI (switch tabs,
   * clear filters, drill into a batch) so the element will exist when the hook
   * tries to scroll to it.  The hook then waits `revealDelayMs` for React to
   * re-render before querying the DOM.  Stable ref semantics.
   */
  preReveal?: (item: T) => void;
  /**
   * How long (ms) to wait after `preReveal` before querying the DOM.
   * Default: 120.  Only applied when `preReveal` is provided.
   */
  revealDelayMs?: number;
  /** Optional side-effect to run after scrolling (e.g. open an editor).
   *  Stable ref semantics — changes to this function after mount are
   *  ignored intentionally, matching the original per-page behaviour where
   *  `openDraft` was excluded from effect deps. */
  onFound?: (item: T) => void;
  /** How long (ms) the highlight ring stays visible. Default: 2500. */
  clearAfterMs?: number;
}): [string | null, () => void] {
  const { paramName, items, testIdPrefix, clearAfterMs = 2500, revealDelayMs = 120 } = opts;

  const onFoundRef = useRef(opts.onFound);
  useEffect(() => { onFoundRef.current = opts.onFound; }, [opts.onFound]);

  const preRevealRef = useRef(opts.preReveal);
  useEffect(() => { preRevealRef.current = opts.preReveal; }, [opts.preReveal]);

  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(opts.currentSearch ?? window.location.search).get(paramName)
      : null,
  );

  // When currentSearch changes (in-page navigation), re-read the param so the
  // hook fires again without requiring a component remount.
  useEffect(() => {
    if (opts.currentSearch === undefined) return;
    const newId = new URLSearchParams(opts.currentSearch).get(paramName);
    if (newId) setFocusId(newId);
  }, [opts.currentSearch, paramName]);

  useEffect(() => {
    if (!focusId || !items?.length) return;
    const item = items.find((i) => i.id === focusId);
    if (!item) return;

    if (preRevealRef.current) {
      // Pre-reveal path: call preReveal first (tab switch, filter reset, etc.)
      // so the target element will exist in the DOM, then wait revealDelayMs
      // for React to flush before querying the DOM and scrolling.
      preRevealRef.current(item);
      let clearTimer: ReturnType<typeof setTimeout> | null = null;
      const scrollTimer = setTimeout(() => {
        const el = document.querySelector(
          `[data-testid="${testIdPrefix}-${focusId}"]`,
        );
        if (!el) return;
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
        onFoundRef.current?.(item);
        clearTimer = setTimeout(() => setFocusId(null), clearAfterMs);
      }, revealDelayMs);
      return () => {
        clearTimeout(scrollTimer);
        if (clearTimer) clearTimeout(clearTimer);
      };
    }

    // Default path (no preReveal): synchronous DOM query and scroll.
    const el = document.querySelector(
      `[data-testid="${testIdPrefix}-${focusId}"]`,
    );
    if (!el) return;
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    onFoundRef.current?.(item);
    const t = setTimeout(() => setFocusId(null), clearAfterMs);
    return () => clearTimeout(t);
  }, [focusId, items, testIdPrefix, clearAfterMs, revealDelayMs]);

  return [focusId, () => setFocusId(null)];
}
