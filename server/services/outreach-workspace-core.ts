import type { CampaignClassification } from "@shared/campaign-classification";
import type { MeetingContact } from "@shared/conference-meetings";

export interface WorkspacePerson {
  id: string; contactId: string; name: string; companyName: string | null;
  status: string; researchDossier: string | null; nextActionAt: Date | null;
  classification: CampaignClassification | null; meeting: MeetingContact | null;
  outreachHold: boolean; emailOptOut: boolean; removedAt?: Date | null;
}
export interface WorkspaceTouch {
  id: string; prospectId: string; status: string; generatedAt: Date; sentAt: Date | null;
}
export interface WorkspaceActivity {
  contactId: string; direction: string; outcome: string; occurredAt: Date; followUpAt: Date | null;
}
export interface CampaignNextStep {
  id: string; prospectId: string; prospectName: string; companyName: string | null;
  priority: "urgent" | "high" | "normal"; title: string; reason: string;
  action: "review_draft" | "review_history" | "research" | "compose" | "meeting";
  touchId?: string; dueAt?: string | null;
}
const blockedStages = new Set(["declined", "unavailable", "do_not_contact"]);
const terminalStatuses = new Set(["disqualified", "unsubscribed", "bounced", "removed", "completed"]);

/** Read-only recommendations; no provider, generation, cadence, or send operations. */
export function buildOutreachWorkspace(
  campaign: { name: string; status: string; salesGoal: string | null; conferenceId: string | null },
  inputPeople: WorkspacePerson[], touches: WorkspaceTouch[], activities: WorkspaceActivity[], now = new Date(),
) {
  const people = inputPeople.filter(p => !p.removedAt);
  const ids = new Set(people.map(p => p.id));
  const activeTouches = touches.filter(t => ids.has(t.prospectId));
  const byPerson = new Map<string, WorkspaceTouch[]>();
  for (const t of activeTouches) byPerson.set(t.prospectId, [...(byPerson.get(t.prospectId) ?? []), t]);
  const latestActivity = new Map<string, WorkspaceActivity>();
  const externalReplies = new Set<string>();
  for (const a of activities) {
    if (a.direction === "inbound" || ["replied", "meeting_agreed"].includes(a.outcome)) externalReplies.add(a.contactId);
    const previous = latestActivity.get(a.contactId);
    if (!previous || a.occurredAt > previous.occurredAt) latestActivity.set(a.contactId, a);
  }
  const counts = { contacts: people.length, pendingDrafts: activeTouches.filter(t => t.status === "draft_pending_approval").length,
    sent: activeTouches.filter(t => t.sentAt || ["sent", "replied"].includes(t.status)).length,
    replied: 0, held: 0, overdue: 0 };
  const items: CampaignNextStep[] = [];
  for (const p of people) {
    const history = byPerson.get(p.id) ?? [];
    const external = latestActivity.get(p.contactId);
    const replied = p.status === "replied" || history.some(t => t.status === "replied") ||
      externalReplies.has(p.contactId);
    if (replied) counts.replied++;
    const held = p.outreachHold || p.emailOptOut || p.meeting?.stage === "do_not_contact";
    if (held) counts.held++;
    const stopped = held || terminalStatuses.has(p.status) || blockedStages.has(p.meeting?.stage ?? "");
    // Replies stop automated cadence; only a separately recorded follow-up remains actionable.
    const due = external?.followUpAt ?? (!replied && !stopped ? p.nextActionAt : null);
    const overdue = !!due && due.getTime() < now.getTime() && !stopped;
    if (overdue) counts.overdue++;
    const add = (action: CampaignNextStep["action"], priority: CampaignNextStep["priority"], title: string, reason: string, touch?: WorkspaceTouch) => {
      items.push({ id: `${p.id}:${touch?.id ?? title}`, prospectId: p.id, prospectName: p.name,
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
  items.sort((a, b) => ranks[a.priority] - ranks[b.priority] ||
    (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
    a.prospectName.localeCompare(b.prospectName) || a.id.localeCompare(b.id));
  const generatedAt = now.toISOString();
  const summary = [
    `${campaign.name} — current campaign summary`,
    `Status: ${campaign.status}.${campaign.salesGoal ? ` Goal: ${campaign.salesGoal}` : ""}`,
    `${counts.contacts} active campaign contacts; ${counts.pendingDrafts} pending drafts; ${counts.sent} Orbit messages recorded as sent; ${counts.replied} contacts with recorded replies.`,
    `${counts.held} contacts have outreach restrictions. ${counts.overdue} contacts have overdue follow-ups.`,
    items.length ? `Next priorities:\n${items.slice(0, 5).map(s => `• ${s.prospectName}: ${s.title} (${s.priority}).`).join("\n")}` : "No actionable next steps were identified from the current records.",
    "Based on current Orbit records, not a live mailbox check. Approved drafts are not counted as sent. Counts exclude removed contacts; replies include campaign-scoped external communications.",
  ].join("\n\n");
  return { generatedAt, items, summary, counts, nextSteps: items };
}
