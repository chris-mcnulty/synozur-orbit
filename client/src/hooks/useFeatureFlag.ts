import { useQuery } from "@tanstack/react-query";

/**
 * Loading-aware tenant feature flag.
 *
 * ANTI-PATTERN — do NOT write this inline in pages:
 *
 *   // eslint-disable-next-line -- documented anti-pattern, use useFeatureFlag()
 *   const isAllowed = tenantInfo?.features?.someKey === true;
 *
 * That check is `false` while `/api/tenant/info` is still in flight, which
 * flashes the upgrade/paywall screen at every page load (can last 10–80s in
 * prod). Even the "loading-aware" inline variant
 * (`tenantInfo === undefined || tenantInfo?.features?.X === true`) keeps
 * getting copy-pasted incorrectly. Always gate pages with this hook instead:
 *
 *   const isAllowed = useFeatureFlag("contentLibrary");
 *
 * Semantics:
 * - Returns `true` while tenant info is still loading (never flash the
 *   paywall before features have resolved — the backend enforces the real
 *   gate on every API call anyway).
 * - Returns the resolved boolean (`features[key] === true`) afterwards.
 *
 * For inline widgets that should render a skeleton while loading (to prevent
 * appearing-then-vanishing for tenants without the feature), use
 * `useFeatureFlagWithLoading` instead.
 */
export function useFeatureFlag(key: string): boolean {
  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
    staleTime: 60_000,
  });

  return tenantInfo === undefined || tenantInfo?.features?.[key] === true;
}

/**
 * Like `useFeatureFlag` but also exposes `isLoading`.
 *
 * Use this for **inline widgets** (not full pages) that should show a skeleton
 * while `/api/tenant/info` is in flight, so they never visibly appear and then
 * vanish for tenants without the feature.
 *
 * Usage:
 *   const { enabled, isLoading } = useFeatureFlagWithLoading("socialPosts");
 *   if (isLoading) return <WidgetSkeleton />;
 *   if (!enabled) return null;
 *
 * Page-level gates should keep using `useFeatureFlag` — the "default true
 * while loading" semantics there prevent paywall flashes, which is correct.
 */
export function useFeatureFlagWithLoading(key: string): { enabled: boolean; isLoading: boolean } {
  const { data: tenantInfo, isLoading } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
    staleTime: 60_000,
  });

  return {
    isLoading,
    enabled: tenantInfo === undefined ? true : tenantInfo?.features?.[key] === true,
  };
}
