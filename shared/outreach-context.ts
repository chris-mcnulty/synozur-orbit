import { z } from "zod";

export const messagingGroups = ["customer", "prospect", "partner", "partner_prospect"] as const;
export const contactFamiliarities = ["cold", "known", "personal_friend", "unknown"] as const;
export type ContactFamiliarity = typeof contactFamiliarities[number];
export const familiarityLabels: Record<ContactFamiliarity, string> = {
  cold: "Cold introduction", known: "Known contact", personal_friend: "Personal friend", unknown: "Unknown",
};
export const bulkMessagingSchema = z.object({
  prospectIds: z.array(z.string().trim().min(1)).min(1).max(200)
    .refine(ids => new Set(ids).size === ids.length, "Select each contact only once"),
  messagingGroup: z.enum(messagingGroups).nullable().optional(),
  familiarity: z.enum(contactFamiliarities).optional(),
}).strict().refine(body => body.messagingGroup !== undefined || body.familiarity !== undefined,
  "Choose a messaging group or familiarity to change");
export const messagingGroupLabels: Record<typeof messagingGroups[number], string> = {
  customer: "Existing customers", prospect: "Prospective customers",
  partner: "Existing partners", partner_prospect: "Prospective partners",
};
export const segmentBriefSchema = z.object({
  group: z.enum(messagingGroups), goal: z.string().trim().max(2000),
  guidance: z.string().trim().max(6000), ask: z.string().trim().max(2000),
  exclusions: z.string().trim().max(2000),
}).strict();
export type SegmentBrief = z.infer<typeof segmentBriefSchema>;
export const segmentBriefsSchema = z.array(segmentBriefSchema).max(4)
  .refine(rows => new Set(rows.map(r => r.group)).size === rows.length, "Each group must appear only once");
export const externalActivitySchema = z.object({
  pauseOutreach: z.boolean().optional(),
  direction: z.enum(["outbound", "inbound"]).default("outbound"),
  channel: z.enum(["email", "linkedin", "phone", "meeting", "other"]),
  occurredAt: z.string().datetime({ offset: true }).refine(s => Date.parse(s) <= Date.now(), "Activity cannot be in the future"),
  sender: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(12000),
  outcome: z.enum(["no_reply", "replied", "meeting_agreed", "other"]),
  reply: z.string().trim().max(12000).default(""),
  followUpAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict().refine(value => value.direction !== "inbound" || ["replied", "meeting_agreed"].includes(value.outcome),
  "A received reply must have a replied or meeting-agreed outcome");
export type ExternalActivityInput = z.infer<typeof externalActivitySchema>;
export interface OutreachContextSnapshot { fingerprint: string; group: string | null }
