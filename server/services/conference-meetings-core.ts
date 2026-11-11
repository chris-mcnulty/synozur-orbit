import { createHash } from "crypto";
import type { Conference, ConferenceSession } from "@shared/schema";
import type { MeetingAngle, MeetingBrief, MeetingContact, RelationshipReview } from "@shared/conference-meetings";

/** Excludes private account notes and unrelated promotion settings. */
export function meetingFactsFingerprint(
  conference: Pick<Conference, "id" | "name" | "startDate" | "endDate" | "location" | "website" | "boothDetails" | "presence"> & Partial<Pick<Conference, "description" | "thematicBrief">>,
  sessions: (Pick<ConferenceSession, "id" | "title" | "sessionStart" | "sessionEnd" | "room" | "speakers" | "url"> & Partial<Pick<ConferenceSession, "speaker" | "abstract" | "track" | "sessionType">>)[],
  brief: MeetingBrief | null,
  sourceContext?: Record<string, unknown>,
): string {
  return createHash("sha256").update(JSON.stringify({
    event: {
      id: conference.id, name: conference.name, startDate: conference.startDate, endDate: conference.endDate,
      location: conference.location, website: conference.website, boothDetails: conference.boothDetails, presence: conference.presence,
      description: conference.description, thematicBrief: conference.thematicBrief,
    },
    sessions: [...sessions].sort((a, b) => a.id.localeCompare(b.id)).map(s => ({
      id: s.id, title: s.title, start: s.sessionStart, end: s.sessionEnd, room: s.room, speakers: s.speakers, url: s.url,
      speaker: s.speaker, abstract: s.abstract, track: s.track, sessionType: s.sessionType,
    })),
    brief,
    sourceContext,
  })).digest("hex");
}

export function meetingContactFingerprint(facts: string, meeting: MeetingContact): string {
  return createHash("sha256").update(JSON.stringify({
    facts, relationships: meeting.relationships, attendance: meeting.attendance,
    attendanceEvidence: meeting.attendanceEvidence, notes: meeting.relationshipNotes,
    ownerNotes: meeting.ownerNotes, review: meeting.review,
  })).digest("hex");
}

export function meetingDraftFingerprint(facts: string, meeting: MeetingContact, operatorBrief?: string): string {
  // JSONB reorders object keys. Reconstruct server-produced review order so
  // persisted snapshots hash exactly as they did when originally generated.
  // Keep the historical order for compatibility with already-created drafts.
  const review = meeting.review;
  const normalized = operatorBrief?.trim() && review ? {
    ...meeting,
    review: {
      checkedAt: review.checkedAt,
      coverage: review.coverage,
      limitations: review.limitations,
      activities: review.activities.map(a => ({
        id: a.id, source: a.source, kind: a.kind, at: a.at, summary: a.summary,
        ...(a.url !== undefined ? { url: a.url } : {}),
      })),
      relatedCampaigns: review.relatedCampaigns,
      suppressed: review.suppressed,
    },
  } : meeting;
  return createHash("sha256").update(JSON.stringify({
    relationship: meetingContactFingerprint(facts, normalized), selectedAngleId: meeting.selectedAngleId,
    selectedHook: meeting.selectedHook, selectedAsk: meeting.selectedAsk,
    ...(operatorBrief?.trim() ? { operatorBrief: operatorBrief.trim() } : {}),
  })).digest("hex");
}

/** Three grounded choices without pretending a generated hook is a new fact. */
export function proposeMeetingAngles(
  eventName: string, contact: MeetingContact, review: RelationshipReview,
  sessions: Pick<ConferenceSession, "id" | "title" | "speakers">[],
  sharedContext?: { goals?: string; brief?: string },
): MeetingAngle[] {
  const cautions = [
    ...(contact.attendance !== "confirmed" ? ["Attendance is not confirmed. Ask whether they will attend; do not assume."] : []),
    ...(review.coverage !== "complete" ? ["Conversation history is incomplete; check for messages outside Orbit and HubSpot."] : []),
    ...(review.relatedCampaigns.length ? ["Coordinate with the relationship owner about overlapping campaigns."] : []),
  ];
  const activity = review.activities.find(a => a.kind !== "draft_pending_approval" && a.kind !== "approved");
  const relationship = contact.relationships.filter(r => r !== "unknown").join(", ").replace(/_/g, " ") || "relationship not yet classified";
  const staffSession = sessions.find(s => s.speakers?.some(speaker => speaker.isStaff));
  const angles: MeetingAngle[] = [
    {
      id: "continue-conversation",
      hook: activity ? "Continue a recent conversation" : "Establish the context for a conversation",
      evidence: activity ? [`${activity.source} ${activity.kind} (${activity.at}): ${activity.summary}`] : ["No recent conversation evidence is available."],
      ask: activity ? `Ask whether there is an unresolved topic worth discussing around ${eventName}.` : `Ask whether they are attending ${eventName} and what they would find useful to discuss.`,
      cautions: [...cautions, ...(activity ? ["Verify that the logged activity reflects a conversation, not just an outbound message."] : ["Do not imply a prior conversation."])],
    },
    {
      id: "relationship-objective",
      hook: contact.relationships.includes("customer") ? "Customer priorities check-in"
        : contact.relationships.includes("partner") ? "Explore a specific collaboration"
          : contact.relationships.includes("former_customer") ? "Reconnect without assuming current needs" : "Discuss current priorities",
      evidence: [`Operator-classified relationship: ${relationship}`, ...(contact.relationshipNotes ? [`Operator context: ${contact.relationshipNotes}`] : [])],
      ask: contact.relationships.includes("customer")
        ? "Offer a short check-in on their current priorities and any outstanding commitments."
        : contact.relationships.includes("partner")
          ? "Ask which shared priority would make a short partner conversation worthwhile."
          : "Ask whether a short conversation about their current priorities would be useful.",
      cautions,
    },
    {
      id: "event-topic",
      hook: staffSession ? `Connect around “${staffSession.title}”` : `Explore a useful meeting around ${eventName}`,
      evidence: staffSession ? [`Event session ${staffSession.id}: ${staffSession.title}; staff speaker recorded.`] : [`Campaign is linked to ${eventName}; no staff speaking session is recorded.`],
      ask: staffSession ? "Ask whether the session topic is relevant and offer a brief discussion if they are attending."
        : "Ask whether they plan to attend and, if so, whether there is a useful reason to meet.",
      cautions: [...cautions, "A session listing is not proof that this contact plans to attend it."],
    },
  ];
  const sharedEvidence = [
    ...(sharedContext?.goals ? [`Saved event/campaign goals: ${sharedContext.goals}`.slice(0, 2000)] : []),
    ...(sharedContext?.brief ? [`Saved event/campaign brief: ${sharedContext.brief}`.slice(0, 2000)] : []),
  ];
  return angles.map(angle => ({ ...angle, evidence: [...angle.evidence, ...sharedEvidence] }));
}

export function assertMeetingCanDraft(meeting: MeetingContact, fingerprint: string, operatorBrief?: string): void {
  if (["do_not_contact", "declined", "unavailable"].includes(meeting.stage) || meeting.attendance === "not_attending") {
    throw new Error("This contact is unavailable or excluded from event outreach.");
  }
  if (meeting.review?.suppressed) throw new Error("This contact is suppressed. Event outreach is blocked.");
  if (operatorBrief?.trim()) {
    if (!meeting.review) throw new Error("Review the relationship before drafting from your brief.");
    return;
  }
  if (!meeting.review || !meeting.angles?.some(a => a.id === meeting.selectedAngleId) || !meeting.selectedHook || !meeting.selectedAsk) {
    throw new Error("Review the relationship, generate angles, and select an angle before drafting.");
  }
  if (meeting.anglesFingerprint !== fingerprint) throw new Error("Event or relationship facts changed. Review the history and regenerate angles.");
}

export function activityAfterDraft(review: RelationshipReview, createdAt: Date): boolean {
  return review.activities.some(a => new Date(a.at).getTime() > createdAt.getTime());
}
