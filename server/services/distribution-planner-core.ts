/**
 * Distribution Planner — pure core.
 *
 * Deterministic scheduling: spread a set of content items across a date window
 * on weekdays at platform-appropriate hours, mapping formats to channels and
 * dates to fiscal-style quarters. No AI, no I/O — fully unit-testable.
 *
 * Timezone: best-posting hours are interpreted as the user's LOCAL wall-clock
 * time. Callers pass `tzOffsetMinutes` (the client's `Date.getTimezoneOffset()`)
 * and the scheduled UTC instant is computed as `localWallClock + offset`,
 * matching the conference-promotion scheduler. Defaults to UTC when omitted.
 */

export type Channel = "linkedin" | "twitter" | "blog" | "email" | "instagram" | "facebook";

/** Map a content-brief format onto a distribution channel. */
export function formatToChannel(format: string): Channel {
  switch (format) {
    case "linkedin_post":
      return "linkedin";
    case "x_post":
      return "twitter";
    case "newsletter":
      return "email";
    case "blog_post":
    case "landing_page":
    case "case_study":
    case "whitepaper":
      return "blog";
    case "video_script":
      return "instagram";
    default:
      return "linkedin";
  }
}

/** Best local posting hour (24h) per channel — sensible B2B defaults. */
export function bestHourForChannel(channel: string): number {
  switch (channel) {
    case "linkedin":
      return 9;
    case "twitter":
      return 12;
    case "email":
      return 10;
    case "blog":
      return 8;
    case "instagram":
      return 18;
    case "facebook":
      return 13;
    default:
      return 10;
  }
}

/** Calendar-quarter timeframe label used by marketing_tasks. */
export function dateToTimeframe(date: Date): "Q1" | "Q2" | "Q3" | "Q4" {
  const m = date.getUTCMonth(); // 0-11
  if (m <= 2) return "Q1";
  if (m <= 5) return "Q2";
  if (m <= 8) return "Q3";
  return "Q4";
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Push Saturday/Sunday forward to the following Monday. */
function avoidWeekend(date: Date): Date {
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  if (day === 6) return addDays(date, 2);
  if (day === 0) return addDays(date, 1);
  return date;
}

export interface PlanItemInput {
  id: string;
  title: string;
  format: string;
  /** Preferred channels (e.g. from a brief's `channels`); first valid wins. */
  preferredChannels?: string[] | null;
}

export interface ScheduledItem {
  briefId: string;
  title: string;
  format: string;
  channel: Channel;
  scheduledAt: string; // ISO 8601 (UTC)
  timeframe: "Q1" | "Q2" | "Q3" | "Q4";
}

export interface BuildScheduleOptions {
  periodStart: Date;
  periodEnd: Date;
  skipWeekends?: boolean;
  /**
   * Client timezone offset in minutes (`Date.getTimezoneOffset()`). Best-posting
   * hours are placed in this local timezone: UTC = localWallClock + offset.
   * Defaults to 0 (UTC).
   */
  tzOffsetMinutes?: number;
}

const VALID_CHANNELS = new Set<Channel>([
  "linkedin",
  "twitter",
  "blog",
  "email",
  "instagram",
  "facebook",
]);

function resolveChannel(item: PlanItemInput): Channel {
  for (const c of item.preferredChannels ?? []) {
    const norm = String(c).trim().toLowerCase().replace(/\/.*$/, "");
    const mapped = norm === "x" ? "twitter" : norm;
    if (VALID_CHANNELS.has(mapped as Channel)) return mapped as Channel;
  }
  return formatToChannel(item.format);
}

/**
 * Distribute items evenly across [periodStart, periodEnd]. Item i lands at
 * day-offset round((i + 0.5) * span / n) so items are centered in equal
 * sub-intervals (no clustering at the ends), then nudged off weekends.
 */
export function buildSchedule(
  items: PlanItemInput[],
  opts: BuildScheduleOptions,
): ScheduledItem[] {
  const n = items.length;
  if (n === 0) return [];

  // Normalize to UTC midnight bounds; ensure end >= start.
  const start = new Date(Date.UTC(
    opts.periodStart.getUTCFullYear(),
    opts.periodStart.getUTCMonth(),
    opts.periodStart.getUTCDate(),
  ));
  let end = new Date(Date.UTC(
    opts.periodEnd.getUTCFullYear(),
    opts.periodEnd.getUTCMonth(),
    opts.periodEnd.getUTCDate(),
  ));
  if (end.getTime() < start.getTime()) end = start;

  const spanDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));

  return items.map((item, i) => {
    const offset = n === 1 ? 0 : Math.round(((i + 0.5) * spanDays) / n);
    let date = addDays(start, Math.min(offset, spanDays));
    if (opts.skipWeekends) date = avoidWeekend(date);

    const channel = resolveChannel(item);
    // bestHour is a LOCAL wall-clock hour; convert to the UTC instant.
    const localWallClock = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      bestHourForChannel(channel),
      0,
      0,
    );
    const scheduledAt = new Date(localWallClock + (opts.tzOffsetMinutes ?? 0) * 60_000);

    return {
      briefId: item.id,
      title: item.title,
      format: item.format,
      channel,
      scheduledAt: scheduledAt.toISOString(),
      // Quarter of the local posting date (not the tz-shifted UTC instant).
      timeframe: dateToTimeframe(date),
    };
  });
}
