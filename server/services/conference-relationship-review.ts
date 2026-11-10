import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { emailSuppressions, marketingContacts, outreachCampaigns, outreachTouches, prospects } from "@shared/schema";
import type { RelationshipActivity, RelationshipReview } from "@shared/conference-meetings";
import { getTenantAccessToken, HUBSPOT_REST_HOST } from "./hubspot-integration";
import { storage } from "../storage";

const clean = (value: unknown) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);

/** Bounded, permission-aware CRM read. Never equate inaccessible activity with no history. */
export async function readHubspotRelationship(
  tenantDomain: string, contactId: string, since: Date,
): Promise<{ activities: RelationshipActivity[]; limitations: string[] }> {
  const activities: RelationshipActivity[] = [];
  const limitations: string[] = [];
  try {
    if (!(await storage.getHubspotConnection(tenantDomain))) return { activities, limitations: ["HubSpot is not connected."] };
    const { accessToken, connection } = await getTenantAccessToken(tenantDomain);
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(`${HUBSPOT_REST_HOST}${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`HubSpot returned ${response.status}`);
      return response.json();
    };
    const specs = [
      { kind: "emails", properties: ["hs_timestamp", "hs_email_subject", "hs_email_text", "hs_email_direction"], title: "hs_email_subject", body: "hs_email_text" },
      { kind: "notes", properties: ["hs_timestamp", "hs_note_body"], title: "", body: "hs_note_body" },
      { kind: "meetings", properties: ["hs_timestamp", "hs_meeting_title", "hs_meeting_body"], title: "hs_meeting_title", body: "hs_meeting_body" },
      { kind: "calls", properties: ["hs_timestamp", "hs_call_title", "hs_call_body"], title: "hs_call_title", body: "hs_call_body" },
      { kind: "deals", properties: ["hs_lastmodifieddate", "dealname", "dealstage"], title: "dealname", body: "dealstage" },
    ];
    await Promise.all(specs.map(async spec => {
      try {
        const assoc = await request(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/${spec.kind}?limit=100`);
        if (assoc.paging?.next) limitations.push(`More than 100 associated ${spec.kind}; review older activity in HubSpot.`);
        const ids = (assoc.results ?? []).map((r: any) => ({ id: String(r.toObjectId) }));
        if (!ids.length) return;
        const result = await request(`/crm/v3/objects/${spec.kind}/batch/read`, { properties: spec.properties, inputs: ids });
        if (result.errors?.length || (result.results ?? []).length !== ids.length) limitations.push(`Some HubSpot ${spec.kind} could not be read.`);
        for (const row of result.results ?? []) {
          const p = row.properties ?? {};
          const rawAt = p.hs_timestamp ?? p.hs_lastmodifieddate ?? row.updatedAt;
          const at = new Date(rawAt);
          if (!Number.isFinite(at.getTime()) || at < since) continue;
          const direction = spec.kind === "emails" ? ` ${p.hs_email_direction ?? "(direction unavailable)"}` : "";
          const portal = connection.hubspotPortalId;
          activities.push({
            id: `hubspot:${spec.kind}:${row.id}`, source: "hubspot", kind: `${spec.kind}${direction}`,
            at: at.toISOString(), summary: clean([p[spec.title], p[spec.body]].filter(Boolean).join(" — ")) || spec.kind,
            ...(portal ? { url: `https://app.hubspot.com/contacts/${encodeURIComponent(String(portal))}/contact/${encodeURIComponent(contactId)}` } : {}),
          });
        }
      } catch {
        limitations.push(`HubSpot ${spec.kind} history is unavailable. Check connection permissions and CRM access.`);
      }
    }));
  } catch {
    limitations.push("HubSpot history is unavailable. Check the connection.");
  }
  return { activities, limitations };
}

export async function reviewConferenceRelationship(
  tenantDomain: string, prospectId: string, lookbackDays: number,
): Promise<RelationshipReview> {
  const [person] = await db.select({ membership: prospects, contact: marketingContacts })
    .from(prospects).innerJoin(marketingContacts, eq(marketingContacts.id, prospects.contactId))
    .where(and(eq(prospects.id, prospectId), eq(prospects.tenantDomain, tenantDomain), eq(marketingContacts.tenantDomain, tenantDomain)));
  if (!person) throw new Error("Prospect not found");
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const memberships = await db.select({ id: prospects.id, campaignId: prospects.campaignId, name: outreachCampaigns.name })
    .from(prospects).innerJoin(outreachCampaigns, eq(outreachCampaigns.id, prospects.campaignId))
    .where(and(eq(prospects.contactId, person.contact.id), eq(prospects.tenantDomain, tenantDomain), eq(outreachCampaigns.tenantDomain, tenantDomain)));
  const touches = await db.select().from(outreachTouches)
    .where(and(eq(outreachTouches.tenantDomain, tenantDomain), inArray(outreachTouches.prospectId, memberships.map(m => m.id)),
      gte(sql`coalesce(${outreachTouches.sentAt}, ${outreachTouches.generatedAt})`, since),
      inArray(outreachTouches.status, ["sent", "replied", "bounced"])))
    .orderBy(desc(sql`coalesce(${outreachTouches.sentAt}, ${outreachTouches.generatedAt})`)).limit(201);
  const suppression = person.contact.email ? await db.select({ id: emailSuppressions.id }).from(emailSuppressions)
    .where(and(eq(emailSuppressions.tenantDomain, tenantDomain), eq(emailSuppressions.email, person.contact.email.toLowerCase()))).limit(1) : [];
  const crm = person.contact.hubspotContactId
    ? await readHubspotRelationship(tenantDomain, person.contact.hubspotContactId, since)
    : { activities: [], limitations: ["This contact has no linked HubSpot record."] };
  const limitations = [...crm.limitations, "Only activity logged in Orbit and accessible HubSpot records is included; external mailboxes and LinkedIn messages are not covered."];
  if (touches.length > 200) limitations.push("Orbit history is limited to the 200 most recent activities.");
  const activities: RelationshipActivity[] = [
    ...crm.activities,
    ...touches.slice(0, 200).map(t => ({
      id: `orbit:${t.id}`, source: "orbit" as const,
      kind: `${t.channel} ${t.status === "replied" ? "sent (reply recorded; reply timestamp unavailable)" : t.status}${t.sentAt ? "" : " (legacy timestamp: draft creation)"}`,
      at: (t.sentAt ?? t.generatedAt).toISOString(), summary: clean([t.subject, t.body].filter(Boolean).join(" — ")),
    })),
    ...(person.membership.status === "replied" && person.membership.updatedAt >= since ? [{
      id: `orbit:reply-status:${person.membership.id}`, source: "orbit" as const, kind: "reply status detected (status update time)",
      at: person.membership.updatedAt.toISOString(), summary: "Orbit recorded a reply. Review the original conversation before further outreach.",
    }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    checkedAt: new Date().toISOString(),
    coverage: activities.length ? "partial" : crm.limitations.length ? "unavailable" : "partial",
    limitations, activities,
    relatedCampaigns: memberships.filter(m => m.campaignId !== person.membership.campaignId).map(m => m.name),
    suppressed: person.contact.emailOptOut || suppression.length > 0,
  };
}
