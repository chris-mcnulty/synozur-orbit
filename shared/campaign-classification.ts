import { z } from "zod";
import { attendanceStates, defaultMeetingContact, relationshipRoles, type MeetingContact } from "./conference-meetings";

export const campaignEventRoles = ["speaker", "sponsor", "exhibitor", "organizer"] as const;
export interface CampaignClassification {
  tags: string[];
  eventRoles: (typeof campaignEventRoles)[number][];
  sourceDetail: string;
}
export const emptyCampaignClassification = (): CampaignClassification => ({ tags: [], eventRoles: [], sourceDetail: "" });
export const classificationPatchSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  tagsMode: z.enum(["replace", "add", "remove"]).optional(),
  eventRoles: z.array(z.enum(campaignEventRoles)).max(4).optional(),
  sourceDetail: z.string().trim().max(500).optional(),
  relationships: z.array(z.enum(relationshipRoles)).min(1).max(6).optional(),
  attendance: z.enum(attendanceStates).optional(),
  attendanceEvidence: z.string().trim().max(2000).optional(),
}).strict().refine(p => Object.keys(p).some(k => k !== "tagsMode"), "Choose at least one change")
  .refine(p => !p.tagsMode || p.tags !== undefined, "Tag mode requires tags");
export type ClassificationPatch = z.infer<typeof classificationPatchSchema>;
export const campaignClassificationRequestSchema = z.object({
  prospectIds: z.array(z.string().min(1).max(100)).min(1).max(200),
  patch: classificationPatchSchema,
}).strict();
function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function applyCampaignClassification(
  classification: CampaignClassification | null | undefined,
  meeting: MeetingContact | null | undefined,
  patch: ClassificationPatch,
) {
  const next = { ...emptyCampaignClassification(), ...classification };
  if (patch.tags) {
    next.tags = patch.tagsMode === "remove"
      ? next.tags.filter(t => !patch.tags!.some(r => r.toLowerCase() === t.toLowerCase()))
      : uniqueTags(patch.tagsMode === "add" ? [...next.tags, ...patch.tags] : patch.tags);
    if (next.tags.length > 30) throw new Error("A contact can have at most 30 campaign tags.");
  }
  if (patch.eventRoles) next.eventRoles = [...new Set(patch.eventRoles)];
  if (patch.sourceDetail !== undefined) next.sourceDetail = patch.sourceDetail;
  const changesMeeting = patch.relationships !== undefined || patch.attendance !== undefined || patch.attendanceEvidence !== undefined;
  const nextMeeting = changesMeeting ? { ...defaultMeetingContact(), ...meeting } : meeting;
  if (nextMeeting && changesMeeting) {
    if (patch.relationships) {
      const roles = [...new Set(patch.relationships)];
      nextMeeting.relationships = roles.length > 1 ? roles.filter(r => r !== "unknown") : roles;
    }
    if (patch.attendance !== undefined) nextMeeting.attendance = patch.attendance;
    if (patch.attendanceEvidence !== undefined) nextMeeting.attendanceEvidence = patch.attendanceEvidence;
  }
  return { classification: next, ...(changesMeeting ? { meeting: nextMeeting! } : {}) };
}

export function classificationLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
export function campaignSourceLabel(source?: string | null) {
  if (source === "manual") return "Added manually";
  if (source === "hubspot") return "HubSpot";
  return source ? classificationLabel(source) : "Unknown source";
}
