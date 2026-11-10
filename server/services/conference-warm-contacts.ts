import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { emailSuppressions, marketingContacts, outreachCampaigns, outreachTouches, prospects } from "@shared/schema";
import { defaultMeetingContact, type WarmConferenceContact, type WarmConferenceShortlist } from "@shared/conference-meetings";
import { getConferenceWorkspace, MeetingError } from "./conference-meetings-service";
import { readConferenceHubspotContacts, type ConferenceHubspotContact } from "./hubspot-integration";
import { readHubspotRelationship } from "./conference-relationship-review";
import { addCampaignMembership, ensureContactForPerson } from "./prospect-contact-service";
import { rankWarmContact, sortWarmContacts } from "./conference-warm-ranking";

const emailKey = (s: string | null) => (s ?? "").trim().toLowerCase();
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);

/** All identity/context reads are tenant-scoped; market only restricts the destination campaign. */
async function localContext(tenant: string, contacts: ConferenceHubspotContact[]) {
  const ids = contacts.map(c => c.hubspotContactId);
  const emails = contacts.map(c => emailKey(c.email)).filter(Boolean);
  const linkedin = contacts.map(c => c.linkedinUrl).filter((v): v is string => !!v);
  if (!ids.length) return { contacts: [], memberships: [], suppressed: new Set<string>() };
  const local = await db.select().from(marketingContacts).where(and(eq(marketingContacts.tenantDomain, tenant), or(
    inArray(marketingContacts.hubspotContactId, ids),
    ...(emails.length ? [inArray(sql`lower(${marketingContacts.email})`, emails)] : []),
    ...(linkedin.length ? [inArray(marketingContacts.linkedinUrl, linkedin)] : []),
  )));
  const memberships = local.length ? await db.select({ person: prospects, campaignName: outreachCampaigns.name })
    .from(prospects).innerJoin(outreachCampaigns, eq(outreachCampaigns.id, prospects.campaignId))
    .where(and(eq(prospects.tenantDomain, tenant), eq(outreachCampaigns.tenantDomain, tenant), inArray(prospects.contactId, local.map(c => c.id)))) : [];
  const allEmails = [...new Set([...emails, ...local.map(c => emailKey(c.email)).filter(Boolean)])];
  const suppressions = allEmails.length ? await db.select({ email: emailSuppressions.email }).from(emailSuppressions)
    .where(and(eq(emailSuppressions.tenantDomain, tenant), inArray(sql`lower(${emailSuppressions.email})`, allEmails))) : [];
  return { contacts: local, memberships, suppressed: new Set(suppressions.map(s => emailKey(s.email))) };
}

function resolveCandidate(c: ConferenceHubspotContact, context: Awaited<ReturnType<typeof localContext>>, campaignId: string) {
  const matches = context.contacts.filter(l => l.hubspotContactId === c.hubspotContactId ||
    (!!c.email && emailKey(l.email) === emailKey(c.email)) || (!!c.linkedinUrl && l.linkedinUrl === c.linkedinUrl));
  // Do not merge conflicting CRM identities or choose between two shared contacts.
  if (matches.length > 1 || matches.some(l => l.hubspotContactId && l.hubspotContactId !== c.hubspotContactId)) return null;
  const local = matches[0];
  if (!local && !c.email && !c.linkedinUrl) return null;
  const memberships = context.memberships.filter(m => m.person.contactId === local?.id);
  if (c.optedOut || local?.emailOptOut || context.suppressed.has(emailKey(c.email)) ||
    context.suppressed.has(emailKey(local?.email ?? null)) ||
    memberships.some(m => m.person.campaignId === campaignId || m.person.meeting?.stage === "do_not_contact")) return null;
  const relationships = [...new Set([
    ...memberships.flatMap(m => m.person.meeting?.relationships ?? []),
    ...([c.lifecycleStage, local?.lifecycleStage].includes("customer") ? ["customer"] : []),
    ...(["lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity"].includes(c.lifecycleStage ?? "") ? ["prospect"] : []),
  ])].filter(r => r !== "unknown");
  const candidate: WarmConferenceContact = {
    hubspotContactId: c.hubspotContactId, name: c.name, email: c.email, company: c.company, jobTitle: c.jobTitle,
    linkedinUrl: c.linkedinUrl, crmOwnerId: c.crmOwnerId,
    ownerUserIds: [...new Set(memberships.map(m => m.person.ownerUserId).filter((id): id is string => !!id))],
    relatedCampaigns: [...new Set(memberships.map(m => m.campaignName))],
    relationships: relationships.length ? relationships : ["unknown"], score: 0, reasons: [], activities: [],
    limitations: [], attendance: "unknown",
  };
  return { candidate, local, memberships };
}

const activePreviews = new Set<string>();
export async function recommendConferenceContacts(tenant: string, campaignId: string, marketId?: string): Promise<WarmConferenceShortlist> {
  if (activePreviews.has(tenant)) throw new MeetingError("A HubSpot shortlist is already being checked for this workspace. Retry after it finishes.", 429);
  activePreviews.add(tenant);
  try { return await buildConferenceShortlist(tenant, campaignId, marketId); }
  finally { activePreviews.delete(tenant); }
}

async function buildConferenceShortlist(tenant: string, campaignId: string, marketId?: string): Promise<WarmConferenceShortlist> {
  const workspace = await getConferenceWorkspace(tenant, campaignId, marketId);
  if (!workspace.brief?.enabled || (!workspace.brief.goals.trim() && !workspace.brief.targetAccounts.trim())) {
    throw new MeetingError("Save an active event brief with goals or target accounts before requesting recommendations.", 422);
  }
  let crm;
  try {
    crm = await readConferenceHubspotContacts(tenant, { queries: workspace.brief.targetAccounts.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean).slice(0, 3) });
  } catch {
    throw new MeetingError("HubSpot contacts are unavailable. Check the connection and contact permissions, then retry.", 409);
  }
  const context = await localContext(tenant, crm.contacts);
  const eligible = crm.contacts.map(c => resolveCandidate(c, context, campaignId)).filter((c): c is NonNullable<typeof c> => !!c);
  const since = new Date(Date.now() - workspace.brief.lookbackDays * 86400000);
  const membershipIds = eligible.flatMap(e => e.memberships.map(m => m.person.id));
  const touches = membershipIds.length ? await db.select().from(outreachTouches)
    .where(and(eq(outreachTouches.tenantDomain, tenant), inArray(outreachTouches.prospectId, membershipIds),
      inArray(outreachTouches.status, ["sent", "replied", "bounced"]), gte(outreachTouches.sentAt, since)))
    .orderBy(desc(outreachTouches.sentAt)).limit(501) : [];
  for (const e of eligible) {
    const membershipSet = new Set(e.memberships.map(m => m.person.id));
    e.candidate.activities = touches.slice(0, 500).filter(t => membershipSet.has(t.prospectId) && t.sentAt && t.sentAt <= new Date()).slice(0, 5).map(t => ({
      id: `orbit:${t.id}`, source: "orbit", kind: `${t.channel} ${t.status === "replied" ? "sent (reply recorded; reply timestamp unavailable)" : t.status}`,
      at: t.sentAt!.toISOString(), summary: clean([t.subject, t.body].filter(Boolean).join(" — ")),
    }));
  }
  const brief = workspace.brief;
  const top = sortWarmContacts(eligible.map(e => rankWarmContact(e.candidate, brief))).slice(0, 10);
  // Two contacts at a time, at most 100 CRM association/batch requests, 25s overall history deadline.
  const signal = AbortSignal.timeout(25000);
  for (let i = 0; i < top.length; i += 2) {
    await Promise.all(top.slice(i, i + 2).map(async c => {
      const history = await readHubspotRelationship(tenant, c.hubspotContactId, since, signal);
      c.activities = [...c.activities, ...history.activities.filter(a => Date.parse(a.at) <= Date.now())]
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10).map(a => ({ ...a, summary: clean(a.summary) }));
      c.limitations = [
        ...history.limitations,
        "Only logged Orbit activity and accessible HubSpot history are covered; external mailboxes and LinkedIn messages are not included.",
        "Activity excerpts are limited to the 10 most recent returned records. No returned activity does not mean no relationship history.",
      ];
      if (touches.length > 500) c.limitations.push("Orbit activity sample reached its 500-record limit across candidates.");
      if (c.ownerUserIds.length > 1) c.limitations.push("Multiple Orbit owners exist; coordinate rather than reassigning ownership.");
    }));
  }
  return {
    contacts: sortWarmContacts(top.map(c => rankWarmContact(c, brief))).filter(c => c.score > 0),
    checkedAt: new Date().toISOString(), candidateCount: crm.contacts.length,
    limitations: [...crm.limitations,
      "Excluded existing campaign members, opted-out/suppressed contacts, do-not-contact relationships, and ambiguous identities.",
      "History is checked for at most 10 candidates selected by target-account, goal, relationship and logged Orbit activity fit, then those candidates are re-ranked. Scores are relative fit, not probabilities.",
      "Recommendations do not confirm attendance. Preview adds no contacts and sends nothing.",
    ],
  };
}

export async function importConferenceRecommendations(tenant: string, campaignId: string, ids: string[], marketId?: string) {
  const workspace = await getConferenceWorkspace(tenant, campaignId, marketId);
  const selectedIds = [...new Set(ids)];
  let selected;
  try { selected = await readConferenceHubspotContacts(tenant, { ids: selectedIds }); }
  catch { throw new MeetingError("Selected HubSpot contacts could not be revalidated. Refresh the shortlist and retry.", 409); }
  const context = await localContext(tenant, selected.contacts);
  let imported = 0;
  const seenContacts = new Set<string>();
  for (const c of selected.contacts) {
    const resolved = resolveCandidate(c, context, workspace.campaignId);
    if (!resolved) continue;
    // Prefer the existing shared identity even if CRM email has changed or is absent.
    const contactId = resolved.local?.id ?? (await ensureContactForPerson(tenant, {
      name: c.name, email: c.email, companyName: c.company, title: c.jobTitle,
      linkedinUrl: c.linkedinUrl, hubspotContactId: c.hubspotContactId,
    }, "hubspot")).contactId;
    if (seenContacts.has(contactId)) continue;
    seenContacts.add(contactId);
    const meeting = defaultMeetingContact();
    // Relationship context is a recommendation, not attendance evidence.
    meeting.relationships = resolved.candidate.relationships as typeof meeting.relationships;
    const membership = await addCampaignMembership({
      tenantDomain: tenant, campaignId: workspace.campaignId, marketId: workspace.conference.marketId,
      contactId, source: "hubspot", status: "new", meeting,
      // CRM owner ids are not Orbit user ids. Never map or reassign them implicitly.
      ownerUserId: resolved.candidate.ownerUserIds.length === 1 ? resolved.candidate.ownerUserIds[0] : null,
    });
    if (membership.created) imported++;
  }
  return { imported, skipped: selectedIds.length - imported };
}
