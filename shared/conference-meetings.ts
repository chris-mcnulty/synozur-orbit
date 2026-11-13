import { z } from "zod";

export const calendarInvitationSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  agenda: z.string().trim().min(1).max(6000),
  location: z.string().trim().min(1).max(2000),
  durationMinutes: z.number().int().min(5).max(480),
  attendees: z.array(z.string().trim().email().max(320)).min(1).max(50)
    .transform(emails => [...new Set(emails.map(email => email.toLowerCase()))]),
}).strict();
export type CalendarInvitationInput = z.infer<typeof calendarInvitationSchema>;
export interface CalendarInvitationPreview extends CalendarInvitationInput {
  start: string;
  end: string;
  timezone: string;
  owner: string;
  organizer: string;
  fingerprint: string;
}
export interface CalendarInvitationState {
  status: "creating" | "sent" | "cancelled";
  eventId?: string;
  webLink?: string;
  organizerUserId: string;
  preview: CalendarInvitationPreview;
}

export const relationshipRoles = ["customer", "prospect", "partner", "former_customer", "industry_peer", "unknown"] as const;
export const meetingStages = ["shortlisted", "researched", "ready_for_review", "contacted", "replied", "meeting_booked", "follow_up", "declined", "unavailable", "do_not_contact"] as const;
export const attendanceStates = ["confirmed", "suggested", "unknown", "not_attending"] as const;
const text = (max = 4000) => z.string().trim().max(max);
export const eventPresenceSchema = z.object({
  timezone: text(100).default("UTC").refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid timezone"),
  confirmation: z.enum(["proposed", "confirmed"]).default("proposed"),
  team: text().default(""),
  attendanceDates: text(1000).default(""),
  meetingLocations: text(2000).default(""),
  activities: text().default(""),
}).strict();
export const meetingBriefSchema = z.object({
  enabled: z.boolean().default(true),
  goals: text().default(""),
  targetAccounts: text().default(""),
  availability: text().default(""),
  schedulingUrl: z.union([z.literal(""), z.string().url().max(2000)]).default(""),
  lookbackDays: z.number().int().min(7).max(365).default(90),
}).strict();
export const meetingAngleSchema = z.object({
  id: text(100).min(1),
  hook: text(400).min(1),
  evidence: z.array(text(2000)).max(8),
  ask: text(1000).min(1),
  cautions: z.array(text(1000)).max(8),
});
export const meetingContactEditSchema = z.object({
  relationships: z.array(z.enum(relationshipRoles)).min(1).max(6),
  attendance: z.enum(attendanceStates),
  attendanceEvidence: text(2000),
  relationshipNotes: text(6000),
  ownerNotes: text(2000),
  stage: z.enum(meetingStages),
  selectedAngleId: text(100).nullable(),
  selectedHook: text(1000),
  selectedAsk: text(1000),
  meetingAt: z.union([z.literal(""), z.string().datetime({ offset: true })]),
  meetingLocation: text(2000),
  participants: text(2000),
  meetingOwner: text(1000),
  followUp: text(4000),
}).strict();
export type EventPresence = z.infer<typeof eventPresenceSchema>;
export type MeetingBrief = z.infer<typeof meetingBriefSchema>;
export type MeetingAngle = z.infer<typeof meetingAngleSchema>;
export interface RelationshipActivity {
  id: string;
  source: "hubspot" | "orbit" | "external";
  kind: string;
  at: string;
  summary: string;
  url?: string;
}
export interface RelationshipReview {
  checkedAt: string;
  coverage: "complete" | "partial" | "unavailable";
  limitations: string[];
  activities: RelationshipActivity[];
  relatedCampaigns: string[];
  suppressed: boolean;
}
export type MeetingContact = z.infer<typeof meetingContactEditSchema> & {
  /** Server-owned campaign membership ID identifying one shared booking. */
  sharedMeetingId?: string;
  review?: RelationshipReview;
  angles?: MeetingAngle[];
  anglesFingerprint?: string;
};
export interface MeetingDraftContext {
  fingerprint: string;
  historyCheckedAt: string;
  /** Server-recorded direction; never accepted from an approval request. */
  operatorBrief?: string;
  relationshipReview?: RelationshipReview;
}
export interface WarmConferenceContact {
  hubspotContactId: string;
  name: string;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  crmOwnerId: string | null;
  ownerUserIds: string[];
  relatedCampaigns: string[];
  relationships: string[];
  score: number;
  reasons: string[];
  activities: RelationshipActivity[];
  limitations: string[];
  attendance: "unknown";
}
export interface WarmConferenceShortlist {
  contacts: WarmConferenceContact[];
  checkedAt: string;
  candidateCount: number;
  limitations: string[];
}
export const defaultMeetingContact = (): MeetingContact => ({
  relationships: ["unknown"], attendance: "unknown", attendanceEvidence: "",
  relationshipNotes: "", ownerNotes: "", stage: "shortlisted",
  selectedAngleId: null, selectedHook: "", selectedAsk: "",
  meetingAt: "", meetingLocation: "", participants: "", meetingOwner: "", followUp: "",
});
