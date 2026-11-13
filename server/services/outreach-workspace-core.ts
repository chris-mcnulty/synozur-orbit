import type { CampaignClassification } from "@shared/campaign-classification";
import type { MeetingContact } from "@shared/conference-meetings";
import { createHash } from "crypto";
import type { CampaignMeeting, CampaignNextStep, NextStepCompletion } from "@shared/outreach-workspace";
export type { CampaignNextStep } from "@shared/outreach-workspace";

export interface WorkspacePerson {
  id: string; contactId: string; name: string; companyName: string | null;
  status: string; researchDossier: string | null; nextActionAt: Date | null;
  classification: CampaignClassification | null; meeting: MeetingContact | null;
  outreachHold: boolean; emailOptOut: boolean; removedAt?: Date | null;
  signals?: Record<string, unknown> | null;
}
export interface WorkspaceTouch {
  id: string; prospectId: string; status: string; generatedAt: Date; sentAt: Date | null;
}
export interface WorkspaceActivity {
  contactId: string; direction: string; outcome: string; occurredAt: Date; followUpAt: Date | null;
  id?: string; updatedAt?: Date;
}
export function nextStepCompletions(signals: unknown): Record<string, NextStepCompletion> {
  if (!signals || typeof signals !== "object") return {};
  const value = (signals as Record<string, unknown>).nextStepCompletions;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    const item = entry as NextStepCompletion | null;
    return item && typeof item.version === "string" && /^[a-f0-9]{64}$/.test(item.version)
      && typeof item.completedAt === "string" && Number.isFinite(Date.parse(item.completedAt))
      && typeof item.completedBy === "string";
  })) as Record<string, NextStepCompletion>;
}
const blockedStages = new Set(["declined", "unavailable", "do_not_contact"]);
const terminalStatuses = new Set(["disqualified", "unsubscribed", "bounced", "removed", "completed"]);

/** Read-only recommendations; no provider, generation, cadence, or send operations. */
export function buildOutreachWorkspace(
  campaign: { name: string; status: string; salesGoal: string | null; conferenceId: string | null },
  inputPeople: WorkspacePerson[], touches: WorkspaceTouch[], activities: WorkspaceActivity[], now = new Date(),
  sharedActivities: WorkspaceActivity[] = activities,
) {
  const people = inputPeople.filter(p => !p.removedAt && !["archived", "deleted", "removed"].includes(p.status));
  const ids = new Set(people.map(p => p.id));
  const activeTouches = touches.filter(t => ids.has(t.prospectId));
  const byPerson = new Map<string, WorkspaceTouch[]>();
  for (const t of activeTouches) byPerson.set(t.prospectId, [...(byPerson.get(t.prospectId) ?? []), t]);
  const latestActivity = new Map<string, WorkspaceActivity>();
  const externalReplies = new Set<string>();
  for (const a of sharedActivities) {
    if (a.direction === "inbound" || ["replied", "meeting_agreed"].includes(a.outcome)) externalReplies.add(a.contactId);
    const previous = latestActivity.get(a.contactId);
    if (!previous || a.occurredAt > previous.occurredAt) latestActivity.set(a.contactId, a);
  }
  const counts = { contacts: people.length, pendingDrafts: activeTouches.filter(t => t.status === "draft_pending_approval").length,
    sent: activeTouches.filter(t => t.sentAt || ["sent", "replied"].includes(t.status)).length,
    replied: 0, held: 0, overdue: 0, worked: 0, communicated: 0, externallyContacted: 0,
    externalCommunications: 0, meetings: 0, bookedMeetings: 0, agreedMeetings: 0 };
  const items: CampaignNextStep[] = [];
  const meetingGroups = new Map<string, CampaignMeeting>();
  const peopleById = new Map(people.map(person => [person.id, person]));
  for (const p of people) {
    const history = byPerson.get(p.id) ?? [];
    const external = latestActivity.get(p.contactId);
    const campaignHistory = activities.filter(a => a.contactId === p.contactId);
    const campaignExternal = campaignHistory.reduce<WorkspaceActivity | undefined>(
      (latest, a) => !latest || a.occurredAt > latest.occurredAt ? a : latest, undefined);
    const internalReply = p.status === "replied" || history.some(t => t.status === "replied");
    const campaignReplied = internalReply || campaignHistory.some(a =>
      a.direction === "inbound" || ["replied", "meeting_agreed"].includes(a.outcome));
    const communicated = ["sent", "awaiting_reply", "replied"].includes(p.status)
      || history.some(t => t.sentAt || ["sent", "replied"].includes(t.status)) || campaignHistory.length > 0;
    const agreed = campaignHistory.some(a => a.outcome === "meeting_agreed");
    if (communicated) counts.communicated++;
    if (campaignHistory.length) counts.externallyContacted++;
    counts.externalCommunications += campaignHistory.length;
    if (communicated || p.researchDossier || !["new", "qualified"].includes(p.status) || p.meeting?.meetingAt || agreed) counts.worked++;
    const booked = p.meeting?.stage === "meeting_booked" || (p.meeting?.stage === "follow_up" && !!p.meeting.meetingAt);
    if (booked || agreed) {
      const groupId = p.meeting?.sharedMeetingId || p.id;
      let entry = meetingGroups.get(groupId);
      if (!entry) {
        entry = { id: groupId, status: booked ? "booked" : "agreed", contacts: [],
          meetingAt: booked && p.meeting?.meetingAt ? p.meeting.meetingAt : null,
          location: booked ? p.meeting?.meetingLocation || "" : "", owner: booked ? p.meeting?.meetingOwner || "" : "" };
        meetingGroups.set(groupId, entry);
      } else if (booked && entry.status !== "booked") {
        Object.assign(entry, { status: "booked", meetingAt: p.meeting?.meetingAt || null,
          location: p.meeting?.meetingLocation || "", owner: p.meeting?.meetingOwner || "" });
      }
      entry.contacts.push({ prospectId: p.id, name: p.name, companyName: p.companyName });
    }
    const replied = internalReply || externalReplies.has(p.contactId);
    if (campaignReplied) counts.replied++;
    const held = p.outreachHold || p.emailOptOut || p.meeting?.stage === "do_not_contact";
    if (held) counts.held++;
    const stopped = held || terminalStatuses.has(p.status) || blockedStages.has(p.meeting?.stage ?? "");
    // Replies stop automated cadence; only a separately recorded follow-up remains actionable.
    const due = external?.followUpAt ?? (!replied && !stopped ? p.nextActionAt : null);
    const overdue = !!due && due.getTime() < now.getTime() && !stopped;
    const campaignDue = campaignExternal?.followUpAt ?? (!campaignReplied && !stopped ? p.nextActionAt : null);
    if (campaignDue && campaignDue.getTime() < now.getTime() && !stopped) counts.overdue++;
    const add = (action: CampaignNextStep["action"], priority: CampaignNextStep["priority"], title: string, reason: string, touch?: WorkspaceTouch) => {
      const evidence = sharedActivities.filter(a => a.contactId === p.contactId).map(a => JSON.stringify({
        id: a.id, direction: a.direction, outcome: a.outcome, occurredAt: a.occurredAt,
        followUpAt: a.followUpAt, updatedAt: a.updatedAt,
      })).sort();
      const version = createHash("sha256").update(JSON.stringify({
        action, title, status: p.status, due, held, evidence,
        touch: touch ? { id: touch.id, status: touch.status, generatedAt: touch.generatedAt } : undefined,
        meeting: action === "meeting" || title === "Prepare for booked meeting" ? {
          at: p.meeting?.meetingAt, location: p.meeting?.meetingLocation, owner: p.meeting?.meetingOwner,
          participants: p.meeting?.participants, group: p.meeting?.sharedMeetingId,
        } : undefined,
        stage: p.meeting?.stage, priority: p.classification?.meetingPriority,
      })).digest("hex");
      items.push({ id: `${p.id}:${touch?.id ?? title}`, version, prospectId: p.id, prospectName: p.name,
        companyName: p.companyName, action, priority, title, reason, ...(touch ? { touchId: touch.id } : {}), dueAt: due?.toISOString() ?? null });
    };
    if (campaign.status === "archived" || campaign.status === "completed") continue;
    if (stopped) {
      if (held) add("review_history", "high", "Review outreach restriction", "Outreach is on hold or opted out. Review history; do not contact automatically.");
      continue;
    }
    if (overdue) add("review_history", "urgent", "Review overdue follow-up", "A recorded follow-up is past due. Check the conversation before taking action.");
    const pending = history.filter(t => t.status === "draft_pending_approval").sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    for (const t of pending) add("review_draft", "high", "Review saved draft", "Continue editing in Orbit; Outlook is not required to save.", t);
    if (p.classification?.meetingPriority === "requested_meeting" && p.meeting?.stage !== "meeting_booked") {
      add(campaign.conferenceId ? "meeting" : "review_history", "high", "Respond to meeting request", "This contact is marked as having requested a meeting.");
    } else if (replied) {
      add("review_history", "high", "Review contact response", "A reply is recorded. Review the latest conversation before deciding what comes next.");
    } else if (!pending.length && !overdue) {
      const priority = p.classification?.meetingPriority === "high" ? "high" : "normal";
      if (p.meeting?.stage === "meeting_booked") add(campaign.conferenceId ? "meeting" : "review_history", priority, "Prepare for booked meeting", "Review the meeting details and relationship history.");
      else if (external) add("review_history", priority, "Review external conversation", "Communication was recorded outside Orbit. Review it before drafting a new message.");
      else if (history.some(t => t.status === "approved")) add("review_history", priority, "Check approved message", "Approval is not confirmation of sending. Check the delivery history before creating another message.");
      else if (p.status === "new" || p.status === "qualified") {
        add(p.researchDossier ? "compose" : "research", priority, p.researchDossier ? "Prepare outreach draft" : "Research contact", "Review this contact before starting outreach.");
      } else if (p.status === "researched") add("compose", priority, "Prepare outreach draft", "Research is available; prepare a message for review.");
    }
  }
  const ranks = { urgent: 0, high: 1, normal: 2 };
  const completedItems: CampaignNextStep[] = [];
  const pendingItems = items.filter(item => {
    const completion = nextStepCompletions(peopleById.get(item.prospectId)?.signals)[item.id];
    if (completion?.version !== item.version) return true;
    completedItems.push({ ...item, completedAt: completion.completedAt });
    return false;
  });
  pendingItems.sort((a, b) => ranks[a.priority] - ranks[b.priority] ||
    (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
    a.prospectName.localeCompare(b.prospectName) || a.id.localeCompare(b.id));
  const generatedAt = now.toISOString();
  const meetings = [...meetingGroups.values()].sort((a, b) => (a.meetingAt ?? "9999").localeCompare(b.meetingAt ?? "9999") || a.id.localeCompare(b.id));
  counts.meetings = meetings.length;
  counts.bookedMeetings = meetings.filter(meeting => meeting.status === "booked").length;
  counts.agreedMeetings = meetings.length - counts.bookedMeetings;
  const contactLabel = (name: string, company: string | null) => company ? `${name} (${company})` : name;
  const summary = [
    `${campaign.name} — current campaign summary`,
    `Status: ${campaign.status}.${campaign.salesGoal ? ` Goal: ${campaign.salesGoal}` : ""}`,
    `${counts.contacts} active campaign contacts; ${counts.pendingDrafts} pending drafts; ${counts.sent} Orbit messages recorded as sent; ${counts.replied} contacts with recorded replies.`,
    `${counts.worked} worked contacts; ${counts.communicated} contacts with confirmed communication. Outside Orbit: ${counts.externalCommunications} logged communications with ${counts.externallyContacted} contacts.`,
    `${counts.meetings} total meetings: ${counts.bookedMeetings} booked; ${counts.agreedMeetings} agreed, scheduling details needed. Shared meetings are counted once.`,
    `${counts.held} contacts have outreach restrictions. ${counts.overdue} contacts have overdue follow-ups.`,
    pendingItems.length ? `Next priorities:\n${pendingItems.slice(0, 5).map(s => `• ${contactLabel(s.prospectName, s.companyName)}: ${s.title} (${s.priority}).`).join("\n")}` : "No actionable next steps were identified from the current records.",
    meetings.length ? `Meetings:\n${meetings.map(meeting => `• ${meeting.contacts.map(contact => contactLabel(contact.name, contact.companyName)).join("; ")} — ${meeting.status === "booked" ? "Booked" : "Agreed, scheduling needed"}${meeting.meetingAt ? `; ${meeting.meetingAt}` : ""}${meeting.location ? `; ${meeting.location}` : ""}${meeting.owner ? `; owner: ${meeting.owner}` : ""}`).join("\n")}` : "No booked or agreed meetings are recorded.",
    "Based on current Orbit records, not a live mailbox check. Approved drafts are not counted as sent. Counts exclude removed contacts; replies include campaign-scoped external communications. Recommendations also consider shared-contact communications across campaigns within this tenant.",
  ].join("\n\n");
  return { generatedAt, items: pendingItems, completedItems, summary, counts, meetings, nextSteps: pendingItems };
}
