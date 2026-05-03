export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatLifecycleStage(stage: string): string {
  const cleaned = stage.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return stage;
  return cleaned
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function buildHubspotCompanyUrl(portalId: string | null | undefined, companyId: string): string {
  const portalSegment = portalId && portalId.length > 0 ? portalId : "0";
  return `https://app.hubspot.com/contacts/${portalSegment}/company/${encodeURIComponent(companyId)}`;
}
