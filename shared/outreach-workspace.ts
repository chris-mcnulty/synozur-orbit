export interface CampaignNextStep {
  id: string; version: string; prospectId: string; prospectName: string; companyName: string | null;
  priority: "urgent" | "high" | "normal"; title: string; reason: string;
  action: "review_draft" | "review_history" | "research" | "compose" | "meeting";
  touchId?: string; dueAt?: string | null; completedAt?: string;
}
export interface CampaignWorkspaceCounts {
  contacts: number; pendingDrafts: number; sent: number; replied: number; held: number; overdue: number;
  worked: number; communicated: number; externallyContacted: number; externalCommunications: number;
  meetings: number; bookedMeetings: number; agreedMeetings: number;
}
export interface CampaignMeeting {
  id: string; status: "booked" | "agreed";
  contacts: { prospectId: string; name: string; companyName: string | null }[];
  meetingAt: string | null; location: string; owner: string;
}
export interface CampaignWorkspace {
  generatedAt: string; items: CampaignNextStep[]; completedItems: CampaignNextStep[];
  counts: CampaignWorkspaceCounts; meetings: CampaignMeeting[];
  summary: string; nextSteps: CampaignNextStep[];
}
export interface NextStepCompletion {
  version: string; completedAt: string; completedBy: string;
}
