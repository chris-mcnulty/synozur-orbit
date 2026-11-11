import { z } from "zod";

export const messagingGroups = ["customer", "prospect", "partner", "partner_prospect"] as const;
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
  channel: z.enum(["email", "linkedin", "phone", "meeting", "other"]),
  occurredAt: z.string().datetime({ offset: true }).refine(s => Date.parse(s) <= Date.now(), "Activity cannot be in the future"),
  sender: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(12000),
  outcome: z.enum(["no_reply", "replied", "meeting_agreed", "other"]),
  reply: z.string().trim().max(12000).default(""),
  followUpAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type ExternalActivityInput = z.infer<typeof externalActivitySchema>;
export interface OutreachContextSnapshot { fingerprint: string; group: string | null }
