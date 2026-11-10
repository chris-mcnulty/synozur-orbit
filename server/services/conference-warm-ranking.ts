import type { MeetingBrief, WarmConferenceContact } from "@shared/conference-meetings";

const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const containsPhrase = (haystack: string, needle: string) => !!needle && ` ${haystack} `.includes(` ${needle} `);
const stopwords = new Set(["with", "from", "have", "that", "this", "their", "meet", "meeting", "contacts", "discuss", "about", "event", "conference", "goals", "customers", "partners", "prospects"]);

/** Literal evidence only: lexical fit is not inferred interest, intent, or attendance. */
export function rankWarmContact(contact: WarmConferenceContact, brief: Pick<MeetingBrief, "goals" | "targetAccounts">): WarmConferenceContact {
  let score = 0;
  const reasons: string[] = [];
  const company = normalized(contact.company ?? "");
  if (company && containsPhrase(normalized(brief.targetAccounts), company)) {
    score += 40;
    reasons.push(`Company “${contact.company}” appears in the saved target accounts.`);
  }
  const profile = normalized([contact.jobTitle, contact.company, ...contact.relationships, ...contact.activities.map(a => a.summary)].filter(Boolean).join(" "));
  const matches = [...new Set(normalized(brief.goals).split(" "))].filter(w => w.length >= 4 && !stopwords.has(w) && containsPhrase(profile, w)).slice(0, 4);
  if (matches.length) {
    score += matches.length * 5;
    reasons.push(`Saved goal terms match profile or accessible activity: ${matches.join(", ")} (text match, not confirmed interest).`);
  }
  const known = contact.relationships.filter(r => r !== "unknown");
  if (known.length) {
    score += known.includes("customer") || known.includes("partner") ? 20 : 10;
    reasons.push(`Recorded relationship: ${known.join(", ").replaceAll("_", " ")}.`);
  }
  if (contact.relatedCampaigns.length) {
    score += 5;
    reasons.push(`Existing Orbit campaign context: ${contact.relatedCampaigns.join(", ")}. Coordinate before outreach.`);
  }
  if (contact.activities.length) {
    score += 15;
    reasons.push(`Accessible dated activity in the selected lookback: ${contact.activities.length} record(s); latest ${contact.activities[0].at.slice(0, 10)}. Activity does not establish a reply or attendance.`);
  }
  if (contact.crmOwnerId || contact.ownerUserIds.length) reasons.push("An existing owner is recorded; coordinate with them. Ownership will not be reassigned.");
  return { ...contact, score, reasons, attendance: "unknown" };
}

export function sortWarmContacts(contacts: WarmConferenceContact[]) {
  return contacts.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.hubspotContactId.localeCompare(b.hubspotContactId));
}
