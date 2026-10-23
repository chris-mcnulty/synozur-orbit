import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { conferences, conferenceSessions, CONFERENCE_SESSION_TYPES } from "@shared/schema";
import { callWebsiteTool, getWebsiteConnection } from "./website-mcp-client";

export class WebsiteEventImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const text = z.string().nullable().optional();
const date = z.string().datetime({ offset: true }).nullable().optional();
// Synozur uses serial integer IDs; tolerate string IDs from other MCP versions.
const sourceIdSchema = z.union([z.number().int().positive(), z.string().min(1)]).transform(String);
const eventSchema = z.object({
  id: sourceIdSchema, slug: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1), description: text, teaser: text,
  startDate: z.string().datetime({ offset: true }), endDate: date,
  location: text, timezone: text, registrationUrl: text,
  sessions: z.array(z.object({
    id: sourceIdSchema, title: z.string().trim().min(1),
    sessionType: text, speakers: text, track: text, room: text,
    startTime: date, sessionUrl: text,
  })).max(500),
});
export type WebsiteEventDetail = z.infer<typeof eventSchema>;
export type EventImportScope = { tenantDomain: string; marketId: string | null; userId: string };

export function websiteEventSlug(source: unknown, origin: string): string {
  if (typeof source !== "string" || !source.trim() || source.length > 2000)
    throw new WebsiteEventImportError("Enter the website event URL or slug.");
  let slug = source.trim();
  if (/^https?:\/\//i.test(slug)) {
    let url: URL;
    try { url = new URL(slug); }
    catch { throw new WebsiteEventImportError("Enter a valid website event URL."); }
    if (url.origin !== origin || url.username || url.password)
      throw new WebsiteEventImportError("Use an event URL from the connected website.");
    const match = url.pathname.match(/^\/events\/([^/]+)(?:\/schedule)?\/?$/);
    if (!match) throw new WebsiteEventImportError("Use the event's /events/… page or schedule URL.");
    slug = match[1];
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(slug))
    throw new WebsiteEventImportError("Enter a valid event slug or event page URL.");
  return slug;
}

export function parseWebsiteEvent(value: unknown): WebsiteEventDetail {
  const result = eventSchema.safeParse(value);
  if (!result.success) throw new WebsiteEventImportError("The website returned an invalid event or schedule. Nothing was imported.", 502);
  const event = result.data;
  if (new Set(event.sessions.map(s => s.id)).size !== event.sessions.length)
    throw new WebsiteEventImportError("The website schedule contains duplicate session IDs. Nothing was imported.", 502);
  if (event.endDate && new Date(event.endDate) < new Date(event.startDate))
    throw new WebsiteEventImportError("The website event ends before it starts. Nothing was imported.", 502);
  return event;
}

export async function fetchWebsiteEvent(tenant: string, source: unknown) {
  const connection = await getWebsiteConnection(tenant);
  if (!connection?.enabled) throw new WebsiteEventImportError("Connect the website in Settings → Integrations first.");
  const origin = new URL(connection.endpoint).origin;
  const slug = websiteEventSlug(source, origin);
  const event = parseWebsiteEvent(await callWebsiteTool(tenant, "get_event", { slug }));
  if (event.slug !== slug) throw new WebsiteEventImportError("The website returned a different event. Nothing was imported.", 502);
  const sourceUrl = (value?: string | null) => {
    if (!value?.trim()) return null;
    let url: URL;
    try { url = new URL(value, origin); }
    catch { throw new WebsiteEventImportError("The website event contains an invalid link.", 502); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new WebsiteEventImportError("The website event contains an unsupported link.", 502);
    return url.href;
  };
  event.registrationUrl = sourceUrl(event.registrationUrl);
  event.sessions = event.sessions.map(session => ({ ...session, sessionUrl: sourceUrl(session.sessionUrl) }));
  return { event, origin };
}

// Serialized per source event, atomic across event + sessions. Reimports preserve
// promotion settings, graphics, post history, and manually added sessions.
export async function importWebsiteEvent(
  scope: EventImportScope, event: WebsiteEventDetail, origin: string,
  database: Pick<typeof db, "transaction"> = db,
) {
  const sourceId = `${origin}|${event.id}`;
  const website = `${origin}/events/${event.slug}`;
  const marketFilter = scope.marketId ? eq(conferences.marketId, scope.marketId) : isNull(conferences.marketId);
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([scope.tenantDomain, scope.marketId, sourceId])}, 0))`);
    const scopeFilter = and(eq(conferences.tenantDomain, scope.tenantDomain), marketFilter);
    // Only adopt older imports with no source identity; never overwrite an event
    // already associated with another website event.
    const candidates = await tx.select().from(conferences).where(and(scopeFilter, or(
      eq(conferences.websiteEventId, sourceId),
      and(isNull(conferences.websiteEventId), or(
        eq(conferences.website, website),
        ...(event.registrationUrl ? [and(eq(conferences.website, event.registrationUrl), eq(conferences.name, event.title))] : []),
        and(eq(conferences.name, event.title), eq(conferences.startDate, new Date(event.startDate))),
      )),
    )));
    const linked = candidates.find(c => c.websiteEventId === sourceId);
    if (!linked && candidates.length > 1)
      throw new WebsiteEventImportError("Multiple Orbit events match this website event. Resolve the duplicates before importing.", 409);
    const existing = linked ?? candidates[0];
    if (existing && existing.status !== "active")
      throw new WebsiteEventImportError("This event is archived or deleted in Orbit. Restore it before importing.", 409);
    const fields = {
      websiteEventId: sourceId, name: event.title, website,
      description: event.description ?? event.teaser ?? null,
      location: event.location ?? null,
      startDate: new Date(event.startDate), endDate: event.endDate ? new Date(event.endDate) : null,
      updatedAt: new Date(),
    };
    const [conference] = existing
      ? await tx.update(conferences).set(fields).where(and(scopeFilter, eq(conferences.id, existing.id))).returning()
      : await tx.insert(conferences).values({
        ...fields, tenantDomain: scope.tenantDomain, marketId: scope.marketId, createdBy: scope.userId,
      }).returning();
    const sessions = await tx.select().from(conferenceSessions).where(and(
      eq(conferenceSessions.conferenceId, conference.id), eq(conferenceSessions.tenantDomain, scope.tenantDomain),
    ));
    let sessionsAdded = 0, sessionsUpdated = 0, sessionsSkipped = 0;
    for (const [index, session] of event.sessions.entries()) {
      const direct = sessions.find(s => s.websiteSessionId === session.id);
      const legacy = sessions.filter(s => !s.websiteSessionId && s.title === session.title
        && (s.sessionStart?.toISOString() ?? null) === (session.startTime ? new Date(session.startTime).toISOString() : null));
      if (!direct && legacy.length > 1)
        throw new WebsiteEventImportError(`Multiple sessions match "${session.title}". Resolve them before importing.`, 409);
      const current = direct ?? legacy[0];
      if (current?.status === "deleted") { sessionsSkipped++; continue; }
      const sessionType = session.sessionType?.toUpperCase();
      const patch = {
        websiteSessionId: session.id, title: session.title,
        // The website supplies a display string, not per-speaker staff flags.
        speaker: session.speakers ?? null,
        speakers: current?.speaker === session.speakers ? current.speakers
          : session.speakers ? [{ name: session.speakers, isStaff: false }] : [],
        sessionType: CONFERENCE_SESSION_TYPES.includes(sessionType as any) ? sessionType : current?.sessionType ?? null,
        track: session.track ?? null, room: session.room ?? null,
        sessionStart: session.startTime ? new Date(session.startTime) : null,
        url: session.sessionUrl ?? null, sortOrder: index, updatedAt: new Date(),
        // MCP does not supply sessionEnd or abstract: preserve existing values.
      };
      if (current) {
        await tx.update(conferenceSessions).set(patch).where(and(
          eq(conferenceSessions.id, current.id), eq(conferenceSessions.conferenceId, conference.id),
          eq(conferenceSessions.tenantDomain, scope.tenantDomain),
        ));
        sessionsUpdated++;
      } else {
        await tx.insert(conferenceSessions).values({
          ...patch, conferenceId: conference.id, tenantDomain: scope.tenantDomain,
        });
        sessionsAdded++;
      }
    }
    return { conferenceId: conference.id, eventUpdated: !!existing, sessionsAdded, sessionsUpdated, sessionsSkipped };
  });
}
