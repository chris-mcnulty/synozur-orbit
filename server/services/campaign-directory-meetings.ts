import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { conferences } from "@shared/schema";
import type { CalendarInvitationState } from "@shared/conference-meetings";

/** Tenant-scoped, batched directory metadata. No Graph calls or invitation changes. */
export async function campaignDirectoryMeetings(tenantDomain: string, campaignId: string, conferenceId: string) {
  const [events, invitations] = await Promise.all([
    db.select({ presence: conferences.presence }).from(conferences)
      .where(and(eq(conferences.id, conferenceId), eq(conferences.tenantDomain, tenantDomain))),
    db.execute(sql`SELECT p.id, i.state->>'status' AS status,
      i.state->'preview'->>'timezone' AS timezone
      FROM prospects p
      JOIN conference_calendar_invitations i ON i.prospect_id = coalesce(p.meeting->>'sharedMeetingId', p.id) AND i.tenant_domain = p.tenant_domain
      WHERE p.campaign_id = ${campaignId} AND p.tenant_domain = ${tenantDomain}`),
  ]);
  const timezone = events[0]?.presence?.timezone ?? null;
  const byPerson = new Map(invitations.rows.map(row => [String(row.id), {
    status: row.status as CalendarInvitationState["status"],
    timezone: typeof row.timezone === "string" ? row.timezone : null,
  }]));
  return { timezone, byPerson };
}
