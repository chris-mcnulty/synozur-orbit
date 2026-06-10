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

/**
 * Definitive format → channel mappings. A format present here publishes on a
 * known channel, so its `format` is authoritative for scheduling. Formats NOT
 * listed (e.g. "other", "podcast_outline") have no obvious channel and fall
 * back to the brief's preferred channels before defaulting.
 */
const FORMAT_CHANNEL: Record<string, Channel> = {
  linkedin_post: "linkedin",
  x_post: "twitter",
  newsletter: "email",
  blog_post: "blog",
  landing_page: "blog",
  case_study: "blog",
  whitepaper: "blog",
  video_script: "instagram",
};

/** Map a content-brief format onto a distribution channel (defaults to linkedin). */
export function formatToChannel(format: string): Channel {
  return FORMAT_CHANNEL[format] ?? "linkedin";
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
  /**
   * Already-scheduled activity counts per local day (`YYYY-MM-DD` -> count), so
   * placement can steer away from days that are already busy. Days created by
   * this run are tracked on top of these, so newly-placed items also avoid
   * clustering on each other. Defaults to no existing load.
   */
  existingDayCounts?: Record<string, number>;
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
  // A brief's `format` is the actual deliverable (a blog post, a LinkedIn post,
  // a newsletter…), so when it maps to a known channel it decides where the
  // item publishes. The brief's `channels` are amplification/promotion channels
  // and must NOT override the deliverable — otherwise a blog post whose promo
  // channels lead with LinkedIn gets mis-scheduled as a LinkedIn post and "blog"
  // never shows up on the calendar. Formats with no definitive channel
  // (e.g. "other", "podcast_outline") fall back to preferred channels.
  if (item.format && item.format in FORMAT_CHANNEL) {
    return FORMAT_CHANNEL[item.format];
  }
  for (const c of item.preferredChannels ?? []) {
    const norm = String(c).trim().toLowerCase().replace(/\/.*$/, "");
    const mapped = norm === "x" ? "twitter" : norm;
    if (VALID_CHANNELS.has(mapped as Channel)) return mapped as Channel;
  }
  return formatToChannel(item.format);
}

/** Local-day key (YYYY-MM-DD) for a UTC-midnight date used internally. */
function ymdKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Distribute items across [periodStart, periodEnd]. Each item targets an ideal
 * day-offset round((i + 0.5) * span / n) so items are centered in equal
 * sub-intervals, then placement steers toward the least-busy nearby weekday so
 * activities don't stack up on days that are already booked (or on days this
 * run just filled). With no existing load and well-spread ideals this collapses
 * to picking the ideal day, preserving the simple even spread.
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

  // Running per-day load, seeded with what's already booked.
  const load = new Map<string, number>();
  if (opts.existingDayCounts) {
    for (const [k, v] of Object.entries(opts.existingDayCounts)) load.set(k, v);
  }

  const candidateDate = (off: number): Date | null => {
    if (off < 0 || off > spanDays) return null;
    let d = addDays(start, off);
    if (opts.skipWeekends) d = avoidWeekend(d);
    return d;
  };

  // Search outward from the ideal offset for the least-busy candidate day,
  // preferring days closest to the ideal (and forward over backward on ties).
  const chooseDate = (idealOffset: number): Date => {
    let best: { date: Date; load: number } | null = null;
    for (let r = 0; r <= spanDays; r++) {
      const offs = r === 0 ? [idealOffset] : [idealOffset + r, idealOffset - r];
      for (const off of offs) {
        const d = candidateDate(off);
        if (!d) continue;
        const l = load.get(ymdKey(d)) ?? 0;
        if (l === 0) return d; // closest open day — can't do better
        if (best === null || l < best.load) best = { date: d, load: l };
      }
    }
    return best ? best.date : (candidateDate(Math.min(Math.max(idealOffset, 0), spanDays)) ?? start);
  };

  return items.map((item, i) => {
    const idealOffset = n === 1 ? 0 : Math.round(((i + 0.5) * spanDays) / n);
    const date = chooseDate(idealOffset);
    const key = ymdKey(date);
    load.set(key, (load.get(key) ?? 0) + 1);

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
