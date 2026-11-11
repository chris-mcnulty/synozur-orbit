import { campaignSourceLabel, classificationLabel, type CampaignClassification } from "@shared/campaign-classification";
import type { MeetingContact } from "@shared/conference-meetings";

export interface ClassifiedPerson {
  id: string;
  name?: string;
  email?: string | null;
  source?: string | null;
  classification?: CampaignClassification | null;
  meeting?: MeetingContact | null;
}
export type ClassificationGroupBy = "none" | "relationship" | "attendance" | "eventRole" | "source" | "sourceDetail" | "tag" | "meetingPriority";
export type ClassificationFilters = Record<"relationship" | "attendance" | "eventRole" | "sourceDetail" | "tag" | "meetingPriority", string>;
export const ALL_CLASSIFICATIONS = "all";
export const UNCLASSIFIED = "__unclassified__";
export const emptyClassificationFilters = (): ClassificationFilters => ({
  relationship: "all", attendance: "all", eventRole: "all", sourceDetail: "all", tag: "all", meetingPriority: "all",
});
export function meetingPriorityLabel(value: string) {
  return value === "requested_meeting" ? "Requested a meeting" : classificationLabel(value);
}
export function meetingPriorityRank(person: ClassifiedPerson) {
  return person.classification?.meetingPriority === "requested_meeting" ? 2 : person.classification?.meetingPriority === "high" ? 1 : 0;
}
export function canClassifyCampaign(role?: string | null) {
  return role === "Analyst" || role === "Domain Admin" || role === "Global Admin";
}
export function classificationValues(person: ClassifiedPerson, dimension: Exclude<ClassificationGroupBy, "none">): string[] {
  let values: string[];
  switch (dimension) {
    case "meetingPriority": values = [person.classification?.meetingPriority ?? "normal"]; break;
    case "relationship": values = (person.meeting?.relationships ?? []).filter(value => value !== "unknown"); break;
    case "attendance": values = person.meeting?.attendance && person.meeting.attendance !== "unknown" ? [person.meeting.attendance] : []; break;
    case "eventRole": values = person.classification?.eventRoles ?? []; break;
    case "tag": values = person.classification?.tags ?? []; break;
    case "source": values = person.source ? [person.source] : []; break;
    case "sourceDetail": values = person.classification?.sourceDetail?.trim() ? [person.classification.sourceDetail.trim()] : []; break;
  }
  return values.length ? [...new Set(values.map(value => dimension === "tag" || dimension === "sourceDetail" ? value.toLocaleLowerCase() : value))] : [UNCLASSIFIED];
}
export function matchesClassification(person: ClassifiedPerson, filters: ClassificationFilters) {
  return (Object.entries(filters) as [keyof ClassificationFilters, string][]).every(([key, value]) =>
    value === ALL_CLASSIFICATIONS || classificationValues(person, key).includes(key === "tag" || key === "sourceDetail" ? value.toLocaleLowerCase() : value));
}
/** Include this in the existing table search predicate (OR name/email/company/title). */
export function classificationSearchText(person: ClassifiedPerson) {
  return [
    person.classification?.sourceDetail ?? "",
    ...(person.classification?.tags ?? []),
    ...(person.classification?.eventRoles ?? []).map(classificationLabel),
    ...(person.meeting?.relationships ?? []).map(classificationLabel),
    campaignSourceLabel(person.source),
    meetingPriorityLabel(person.classification?.meetingPriority ?? "normal"),
  ].join(" ").toLocaleLowerCase();
}
export function classificationGroupLabel(dimension: Exclude<ClassificationGroupBy, "none">, value: string) {
  if (dimension === "meetingPriority") return meetingPriorityLabel(value);
  if (value === UNCLASSIFIED) return dimension === "source" ? "Unknown source" : "Unclassified";
  if (dimension === "source") return campaignSourceLabel(value);
  if (dimension === "attendance" && value === "confirmed") return "Confirmed attendee";
  return dimension === "tag" || dimension === "sourceDetail" ? value : classificationLabel(value);
}
export function groupClassifiedPeople<T extends ClassifiedPerson>(people: T[], dimension: ClassificationGroupBy): { key: string; label: string; people: T[] }[] {
  // Default view is canonical even if an upstream result accidentally repeats an ID.
  const unique = [...new Map(people.map(person => [person.id, person])).values()];
  if (dimension === "none") return [{ key: "all", label: "All contacts", people: unique }];
  const groups = new Map<string, T[]>();
  for (const person of unique) {
    for (const value of classificationValues(person, dimension)) {
      const group = groups.get(value) ?? [];
      group.push(person);
      groups.set(value, group);
    }
  }
  return [...groups].map(([key, members]) => ({ key, label: classificationGroupLabel(dimension, key), people: members }))
    .sort((a, b) => dimension === "meetingPriority"
      ? ["requested_meeting", "high", "normal"].indexOf(a.key) - ["requested_meeting", "high", "normal"].indexOf(b.key)
      : a.key === UNCLASSIFIED ? 1 : b.key === UNCLASSIFIED ? -1 : a.label.localeCompare(b.label));
}
export function visibleSelectedIds(selected: Iterable<string>, people: ClassifiedPerson[]) {
  const visible = new Set(people.map(person => person.id));
  return [...new Set(selected)].filter(id => visible.has(id)).slice(0, 200);
}
