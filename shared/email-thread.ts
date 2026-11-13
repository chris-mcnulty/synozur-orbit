import { z } from "zod";

export const threadContactSchema = z.object({
  name: z.string().trim().max(300).default(""),
  email: z.string().trim().max(320).default(""),
  title: z.string().trim().max(300).default(""),
  companyName: z.string().trim().max(300).default(""),
  linkedinUrl: z.string().trim().max(2000).default(""),
  phone: z.string().trim().max(100).default(""),
});
export const threadMeetingSchema = z.object({
  proposal: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(2000),
  proposer: z.string().trim().max(300).default(""),
  dateText: z.string().trim().max(300).default(""),
  timeText: z.string().trim().max(300).default(""),
  timezone: z.string().trim().max(100).default(""),
  status: z.enum(["proposed", "accepted", "declined", "unclear"]).default("unclear"),
  needsConfirmation: z.boolean().default(true),
});
export const emailThreadParseSchema = z.object({
  text: z.string().trim().min(1).max(30000),
  prospectId: z.string().min(1).max(100).optional(),
}).strict();
export const threadLocationSchema = z.object({
  location: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().min(1).max(2000),
  status: z.enum(["current", "superseded", "unclear", "cancelled"]),
});
export type ThreadLocation = z.infer<typeof threadLocationSchema>;
export interface ThreadLocationSuggestion extends ThreadLocation { token?: string }
export interface ThreadLocationReview {
  currentLocation: string;
  token: string;
  expiresAt: number;
}
export const emailThreadSaveSchema = z.object({
  prospectId: z.string().min(1).max(100).optional(),
  contact: threadContactSchema,
  meetingTimes: z.array(threadMeetingSchema).max(20),
  confirmed: z.literal(true),
  locationUpdate: z.object({
    suggestion: threadLocationSchema,
    evidenceToken: z.string().min(1).max(200),
    reviewToken: z.string().min(1).max(200),
    expiresAt: z.number().int(),
    confirmed: z.literal(true),
  }).strict().optional(),
}).strict().refine(value => value.prospectId || value.contact.email || value.contact.linkedinUrl, "Select an existing contact or include an email or LinkedIn profile for a new contact.");
export type ThreadContact = z.infer<typeof threadContactSchema>;
export type ThreadMeeting = z.infer<typeof threadMeetingSchema>;
export interface ThreadParticipant extends ThreadContact { matchedProspectId?: string }
export interface EmailThreadPreview { contacts: ThreadParticipant[]; meetingTimes: ThreadMeeting[]; meetingLocations?: ThreadLocationSuggestion[]; warnings: string[] }
