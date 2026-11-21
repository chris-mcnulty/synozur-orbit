import { z } from "zod";
import { messagingGroups, contactFamiliarities } from "@shared/outreach-context";
import { emptyClassificationFilters, classificationValues, type ClassifiedPerson } from "@/components/sales/campaign-classification-helpers";

const text = z.string().max(300).catch("");
const choice = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).catch(fallback);
const option = (ids?: string[], unclassified = false) => z.string().max(500).catch("all").transform(v => !ids || v === "all" || (unclassified && v === "__unclassified__") || ids.includes(v) ? v : "all");
export const marketingCampaignViewSchema = z.object({
  campaignSearch: text,
  statusFilter: choice(["all", "draft", "active", "completed", "archived"], "all"),
});
// The outreach list currently has no user-controlled filters or sorting.
export const outreachCampaignViewSchema = z.object({});
export function prospectViewSchema(people?: ClassifiedPerson[]) {
  const classification = Object.fromEntries(Object.keys(emptyClassificationFilters()).map(key => [
    key, option(people?.flatMap(p => classificationValues(p, key as keyof ReturnType<typeof emptyClassificationFilters>)), true),
  ])) as Record<keyof ReturnType<typeof emptyClassificationFilters>, z.ZodEffects<z.ZodCatch<z.ZodString>, string, unknown>>;
  return z.object({
    searchQ: text,
    statusTab: choice(["all", "new", "researched", "action", "replied", "dormant", "disqualified"], "all"),
    sourceFilter: option(people?.flatMap(p => p.source ? [p.source] : [])),
    messagingGroupFilter: choice(["all", "unassigned", ...messagingGroups], "all"),
    familiarityFilter: choice(["all", ...contactFamiliarities], "all"),
    scoreFilter: choice(["all", "high", "medium", "low", "unscored"], "all"),
    sortKey: choice(["name", "company", "score", "status", "source", "priority"], "score"),
    sortDir: choice(["asc", "desc"], "desc"),
    classification: z.object(classification).catch(emptyClassificationFilters()),
    classificationGroupBy: choice(["none", "relationship", "attendance", "eventRole", "source", "sourceDetail", "tag", "meetingPriority"], "none"),
  });
}
export interface CalendarViewOptions {
  campaigns: { id: string }[]; solutionAreas: { id: string }[]; conferences: { id: string }[];
  socialChannels?: { id: string }[]; contentFormats?: { id: string }[];
}
export function calendarViewSchema(options?: CalendarViewOptions) {
  const assignments = {
    campaignId: option(options?.campaigns.map(v => v.id)),
    solutionAreaId: option(options?.solutionAreas.map(v => v.id)),
    conferenceId: option(options?.conferences.map(v => v.id)),
  };
  const all = { campaignId: "all", solutionAreaId: "all", conferenceId: "all" };
  const types = options ? ["all", "social", "email", "content", ...(options.socialChannels ?? []).map(v => `social:${v.id}`), ...(options.contentFormats ?? []).map(v => `content:${v.id}`)] : undefined;
  return z.object({
    view: choice(["calendar", "backlog"], "calendar"),
    grouping: choice(["month", "quarter"], "month"),
    groupBy: choice(["none", "campaign", "theme", "event"], "none"),
    filters: z.object(assignments).catch(all),
    typeFilter: option(types),
    backlogFilters: z.object({ ...assignments, status: choice(["all", "draft", "approved", "delivered"], "all").transform(v => v as string) }).catch({ ...all, status: "all" }),
  });
}
export const prospectViewDefaults = prospectViewSchema().parse({});
export const calendarViewDefaults = calendarViewSchema().parse({});
export const marketingCampaignViewDefaults = marketingCampaignViewSchema.parse({});

/** Only view-state parameters are accepted. Item IDs, dates, dialogs and actions never enter storage. */
export function urlViewState<T extends Record<string, unknown>>(defaults: T, search: string): Partial<T> {
  const params = new URLSearchParams(search);
  const result: Record<string, unknown> = {};
  const itemLink = ["post", "brief", "emailId", "prospect", "draft"].some(k => params.has(k));
  if (itemLink) Object.assign(result, defaults);
  for (const key of Object.keys(defaults)) {
    if (typeof defaults[key] === "string" && params.has(key)) result[key] = params.get(key);
  }
  if ("campaignSearch" in defaults && params.has("q")) result.campaignSearch = params.get("q");
  if ("searchQ" in defaults && params.has("q")) result.searchQ = params.get("q");
  if ("statusTab" in defaults && params.has("status")) result.statusTab = params.get("status");
  if ("statusFilter" in defaults && params.has("status")) result.statusFilter = params.get("status");
  for (const key of ["filters", "backlogFilters"]) {
    if (!(key in defaults)) continue;
    const group: Record<string, unknown> = {};
    for (const field of Object.keys(defaults[key] as object)) {
      const param = key === "filters" ? field : `backlog.${field}`;
      if (params.has(param)) group[field] = params.get(param);
    }
    if (Object.keys(group).length) result[key] = { ...(defaults[key] as object), ...group };
  }
  return result as Partial<T>;
}
