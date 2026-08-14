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
