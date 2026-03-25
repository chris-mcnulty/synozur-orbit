/**
 * Utility functions for calculating and displaying data staleness
 */

export type StalenessLevel = "fresh" | "aging" | "stale" | "never";

export interface StalenessInfo {
  level: StalenessLevel;
  color: string;
  label: string;
  dotColor: string;
}

/**
 * Calculate staleness level based on last updated timestamp
 * @param lastUpdated - Date string or Date object
 * @returns Staleness level
 */
export function calculateStaleness(lastUpdated: string | Date | null | undefined): StalenessLevel {
  if (!lastUpdated) return "never";
  
  const lastUpdate = new Date(lastUpdated);
  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;
  
  if (diffHours < 24) return "fresh";
  if (diffDays < 7) return "aging";
  return "stale";
}

/**
 * Get staleness info (color, label, etc.) for a given level
 * @param level - Staleness level
 * @returns Staleness info object
 */
export function getStalenessInfo(level: StalenessLevel): StalenessInfo {
  const info: Record<StalenessLevel, StalenessInfo> = {
    fresh: {
      level: "fresh",
      color: "text-green-500",
      label: "Fresh",
      dotColor: "bg-green-500",
    },
    aging: {
      level: "aging",
      color: "text-yellow-500",
      label: "Aging",
      dotColor: "bg-yellow-500",
    },
    stale: {
      level: "stale",
      color: "text-red-500",
      label: "Stale",
      dotColor: "bg-red-500",
    },
    never: {
      level: "never",
      color: "text-gray-400",
      label: "Never fetched",
      dotColor: "bg-gray-400",
    },
  };
  
  return info[level];
}

/**
 * Get human-readable time ago string
 * @param lastUpdated - Date string or Date object
 * @returns Human-readable string
 */
export function getTimeAgo(lastUpdated: string | Date | null | undefined): string {
  if (!lastUpdated) return "Never";
  
  const lastUpdate = new Date(lastUpdated);
  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Combined function to get all staleness information
 * @param lastUpdated - Date string or Date object
 * @returns Object with level, info, and timeAgo
 */
export function getFullStalenessInfo(lastUpdated: string | Date | null | undefined) {
  const level = calculateStaleness(lastUpdated);
  const info = getStalenessInfo(level);
  const timeAgo = getTimeAgo(lastUpdated);
  
  return {
    level,
    ...info,
    timeAgo,
    lastUpdated,
  };
}

export interface ArtifactFreshness {
  isStale: boolean;
  artifactDate: Date | null;
  latestSourceDate: Date | null;
  daysBehind: number;
  label: string;
}

export function checkArtifactFreshness(
  artifactGeneratedAt: string | Date | null | undefined,
  sourceDates: (string | Date | null | undefined)[]
): ArtifactFreshness {
  if (!artifactGeneratedAt) {
    return { isStale: false, artifactDate: null, latestSourceDate: null, daysBehind: 0, label: "Not yet generated" };
  }

  const artifactDate = new Date(artifactGeneratedAt);
  const validSourceDates = sourceDates
    .filter((d): d is string | Date => !!d)
    .map(d => new Date(d));

  if (validSourceDates.length === 0) {
    return { isStale: false, artifactDate, latestSourceDate: null, daysBehind: 0, label: "Up to date" };
  }

  const latestSourceDate = new Date(Math.max(...validSourceDates.map(d => d.getTime())));
  const daysBehind = Math.floor((latestSourceDate.getTime() - artifactDate.getTime()) / (1000 * 60 * 60 * 24));
  const isStale = latestSourceDate.getTime() > artifactDate.getTime();

  let label = "Up to date";
  if (isStale) {
    if (daysBehind === 0) label = "Source data updated today";
    else if (daysBehind === 1) label = "1 day behind source data";
    else label = `${daysBehind} days behind source data`;
  }

  return { isStale, artifactDate, latestSourceDate, daysBehind, label };
}

export function formatShortDate(date: string | Date | null | undefined): string {
  if (!date) return "Never";
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export type IntelligenceHealthStatus = "healthy" | "attention" | "critical";

export interface IntelligenceHealthSummary {
  status: IntelligenceHealthStatus;
  totalSources: number;
  freshSources: number;
  staleSources: number;
  agingSources: number;
  staleArtifacts: string[];
  healthPercent: number;
}

export function computeIntelligenceHealth(
  sourceDates: { label: string; date: string | Date | null | undefined }[],
  artifacts: { label: string; generatedAt: string | Date | null | undefined; sourceDates: (string | Date | null | undefined)[] }[]
): IntelligenceHealthSummary {
  let freshSources = 0;
  let staleSources = 0;
  let agingSources = 0;

  for (const src of sourceDates) {
    const level = calculateStaleness(src.date);
    if (level === "fresh") freshSources++;
    else if (level === "stale" || level === "never") staleSources++;
    else agingSources++;
  }

  const staleArtifacts: string[] = [];
  for (const art of artifacts) {
    const freshness = checkArtifactFreshness(art.generatedAt, art.sourceDates);
    if (freshness.isStale) staleArtifacts.push(art.label);
  }

  const totalSources = sourceDates.length;
  const healthPercent = totalSources > 0
    ? Math.round(((freshSources + agingSources * 0.5) / totalSources) * 100)
    : 100;

  let status: IntelligenceHealthStatus = "healthy";
  if (staleSources > 0 || staleArtifacts.length > 0) status = "attention";
  if (staleSources > totalSources / 2 || staleArtifacts.length > 2) status = "critical";

  return { status, totalSources, freshSources, staleSources, agingSources, staleArtifacts, healthPercent };
}
