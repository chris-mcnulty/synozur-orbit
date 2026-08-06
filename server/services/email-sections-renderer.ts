/**
 * Email Sections Renderer
 *
 * Deterministic, email-safe HTML for the three conventional supplementary
 * sections appended after a campaign email's main message:
 *   1. Case study card  — image left / text right on desktop, stacked on mobile
 *   2. Upcoming events + Recent updates — two columns on desktop, stacked on mobile
 *
 * Layout uses the "fluid hybrid" pattern: side-by-side blocks are
 * display:inline-block divs with max-widths, so they stack naturally on
 * narrow screens WITHOUT media queries. That makes the layout survive the
 * HubSpot copy/paste path (which strips <head>/<style>) as well as Orbit's
 * own SendGrid sends. Media queries in the send-time wrapper are purely
 * progressive enhancement.
 *
 * All body text is 16px minimum for mobile readability.
 */

import { db } from "../db";
import { conferences, contentAssets, tenants } from "@shared/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

export interface SectionCaseStudy {
  title: string;
  blurb: string;        // 2-4 sentence summary; plain text (will be escaped)
  quote?: string | null;
  url?: string | null;
  imageUrl?: string | null;
}

export interface SectionEvent {
  name: string;
  dateLabel: string;    // e.g. "April 21-23, 2026"
  location?: string | null;
  website?: string | null;
}

export interface SectionPost {
  title: string;
  url?: string | null;
}

export interface RenderSectionsInput {
  caseStudy?: SectionCaseStudy | null;
  events?: SectionEvent[];
  posts?: SectionPost[];
  eventsCalendarUrl?: string | null;
  brandPrimary?: string;   // link/heading accent
}

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const BODY_TEXT = `${FONT}font-size:16px;line-height:1.55;color:#333333;`;
const H2 = `${FONT}font-size:20px;line-height:1.3;color:#1a1a1a;font-weight:bold;margin:0 0 12px 0;`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function link(href: string, text: string, color: string): string {
  return `<a href="${esc(href)}" target="_blank" style="color:${color};text-decoration:underline;">${esc(text)}</a>`;
}

/** Case study: image-left / text-right on desktop, stacked on mobile. */
function renderCaseStudy(cs: SectionCaseStudy, brand: string): string {
  const img = cs.imageUrl
    ? `<div style="display:inline-block;width:100%;max-width:220px;vertical-align:top;">
        ${cs.url ? `<a href="${esc(cs.url)}" target="_blank">` : ""}<img src="${esc(cs.imageUrl)}" alt="${esc(cs.title)}" width="220" style="width:100%;max-width:220px;height:auto;display:block;border-radius:6px;border:0;">${cs.url ? "</a>" : ""}
      </div><!--
      -->`
    : "";
  const textMax = cs.imageUrl ? 340 : 560;
  const titleHtml = cs.url ? link(cs.url, cs.title, brand) : `<span style="color:#1a1a1a;">${esc(cs.title)}</span>`;
  // Outlook's Word engine ignores inline-block/max-width — give it a fixed
  // two-cell table via MSO conditionals; all other clients use the fluid divs.
  const msoOpen = cs.imageUrl
    ? `<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td width="220" valign="top"><![endif]-->`
    : "";
  const msoMid = cs.imageUrl ? `<!--[if mso]></td><td width="20">&nbsp;</td><td width="320" valign="top"><![endif]-->` : "";
  const msoClose = cs.imageUrl ? `<!--[if mso]></td></tr></table><![endif]-->` : "";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:24px 16px;background:#f7f7f9;border-radius:8px;">
    <h2 style="${H2}">Case Study</h2>
    <div style="font-size:0;text-align:left;">
      ${msoOpen}${img}${msoMid}<div style="display:inline-block;width:100%;max-width:${textMax}px;vertical-align:top;">
        <div style="${BODY_TEXT}${cs.imageUrl ? "padding:8px 0 0 0;" : ""}">
          <p style="margin:0 0 10px 0;${BODY_TEXT}font-weight:bold;">${titleHtml}</p>
          <p style="margin:0 0 10px 0;${BODY_TEXT}">${esc(cs.blurb)}</p>
          ${cs.quote ? `<p style="margin:0;${BODY_TEXT}font-style:italic;color:#555555;">${esc(cs.quote)}</p>` : ""}
        </div>
      </div>${msoClose}
    </div>
  </td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:0;line-height:0;height:24px;">&nbsp;</td></tr></table>`;
}

/** Events + Recent Updates: two fluid columns that stack on mobile. */
function renderTwoColumn(
  events: SectionEvent[],
  posts: SectionPost[],
  eventsCalendarUrl: string | null | undefined,
  brand: string,
): string {
  const eventItems = events
    .map(ev => {
      const name = ev.website ? link(ev.website, ev.name, brand) : `<strong>${esc(ev.name)}</strong>`;
      const meta = [ev.dateLabel, ev.location].filter(Boolean).map(x => esc(x!)).join(" · ");
      return `<li style="margin:0 0 10px 0;${BODY_TEXT}">${name}${meta ? ` — ${meta}` : ""}</li>`;
    })
    .join("\n");
  const postItems = posts
    .map(p => `<li style="margin:0 0 10px 0;${BODY_TEXT}">${p.url ? link(p.url, p.title, brand) : esc(p.title)}</li>`)
    .join("\n");

  // 280 px each = 560 px total, which fits inside the ~568 px inner width of the
  // 600 px outer table with 16 px side padding.  Using 290 px (= 580 px total)
  // caused the columns to wrap in Gmail and other clients that honour max-width.
  // The MSO ghost-table cells below use the same 280 px value.
  const eventsCol = events.length
    ? `<div style="display:inline-block;width:100%;max-width:280px;vertical-align:top;">
        <div style="padding:0 12px 24px 0;">
          <h2 style="${H2}">Upcoming Events</h2>
          <ul style="margin:0;padding:0 0 0 20px;">${eventItems}</ul>
          ${eventsCalendarUrl ? `<p style="margin:12px 0 0 0;${BODY_TEXT}">Find the latest details on our ${link(eventsCalendarUrl, "Events Calendar", brand)}.</p>` : ""}
        </div>
      </div>`
    : "";
  const postsCol = posts.length
    ? `<div style="display:inline-block;width:100%;max-width:280px;vertical-align:top;">
        <div style="padding:0 0 24px 0;">
          <h2 style="${H2}">Recent Updates</h2>
          <ul style="margin:0;padding:0 0 0 20px;">${postItems}</ul>
        </div>
      </div>`
    : "";

  if (!eventsCol && !postsCol) return "";
  const both = Boolean(eventsCol && postsCol);
  // MSO conditional fixed-width two-cell table for Outlook desktop.
  const msoOpen = both
    ? `<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td width="280" valign="top"><![endif]-->`
    : "";
  const msoMid = both ? `<!--[if mso]></td><td width="280" valign="top"><![endif]-->` : "";
  const msoClose = both ? `<!--[if mso]></td></tr></table><![endif]-->` : "";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:8px 16px 0 16px;border-top:1px solid #e5e5e5;">
    <div style="font-size:0;text-align:left;padding-top:16px;">
      ${msoOpen}${eventsCol}${both ? "<!--\n      -->" : ""}${msoMid}${postsCol}${msoClose}
    </div>
  </td></tr>
</table>`;
}

/**
 * Insert the sections block into an email body safely:
 * - fragment bodies: append at the end;
 * - full HTML documents: insert before </body> so the sections aren't
 *   dropped by clients that stop parsing after </html>.
 * No-op if the body already contains a sections block.
 */
export function appendSectionsToBody(body: string, sectionsHtml: string | null | undefined): string {
  if (!sectionsHtml?.trim() || body.includes("orbit:sections:start")) return body;
  if (/<\/body>/i.test(body)) {
    return body.replace(/<\/body>/i, `${sectionsHtml}</body>`);
  }
  return `${body}\n${sectionsHtml}`;
}

export function renderEmailSections(input: RenderSectionsInput): string {
  const brand = input.brandPrimary || "#7C3AED";
  const parts: string[] = [];
  if (input.caseStudy) parts.push(renderCaseStudy(input.caseStudy, brand));
  const twoCol = renderTwoColumn(input.events ?? [], input.posts ?? [], input.eventsCalendarUrl, brand);
  if (twoCol) parts.push(twoCol);
  if (!parts.length) return "";
  return `\n<!-- orbit:sections:start -->\n${parts.join("\n")}\n<!-- orbit:sections:end -->\n`;
}

/** Shape of the JSONB `sections` column on generated_emails. */
export interface SectionsConfig {
  caseStudyAssetId?: string | null;
  eventIds?: string[];
  blogAssetIds?: string[];
  eventsCalendarUrl?: string | null;
}

/**
 * Re-render sections HTML from the stored selection config at send/export time
 * so changes to event dates, blog post titles, or archived/deleted items are
 * reflected in the outbound email rather than carrying the stale snapshot that
 * was saved when the user clicked "Save sections".
 *
 * Archived or deleted items are silently dropped from the rendered output.
 * Returns null when there is no config or the config produces no visible content.
 */
export async function reRenderSectionsHtml(
  sections: SectionsConfig | null | undefined,
  context: { tenantDomain: string; marketId: string },
): Promise<string | null> {
  if (!sections) return null;

  const { caseStudyAssetId, eventIds, blogAssetIds, eventsCalendarUrl } = sections;
  const wantedEventIds = Array.isArray(eventIds) ? eventIds.filter(Boolean) : [];
  const wantedBlogIds = Array.isArray(blogAssetIds) ? blogAssetIds.filter(Boolean) : [];

  if (!caseStudyAssetId && !wantedEventIds.length && !wantedBlogIds.length) return null;

  const [caseStudyRows, eventRows, blogRows, tenantRows] = await Promise.all([
    caseStudyAssetId
      ? db.select().from(contentAssets)
          .where(and(
            eq(contentAssets.id, caseStudyAssetId),
            eq(contentAssets.tenantDomain, context.tenantDomain),
            eq(contentAssets.marketId, context.marketId),
            eq(contentAssets.status, "active"),
          ))
          .limit(1)
      : Promise.resolve([] as any[]),
    wantedEventIds.length
      ? db.select().from(conferences)
          .where(and(
            inArray(conferences.id, wantedEventIds),
            eq(conferences.tenantDomain, context.tenantDomain),
            or(eq(conferences.marketId, context.marketId), isNull(conferences.marketId)),
          ))
          .orderBy(conferences.startDate)
      : Promise.resolve([] as any[]),
    wantedBlogIds.length
      ? db.select().from(contentAssets)
          .where(and(
            inArray(contentAssets.id, wantedBlogIds),
            eq(contentAssets.tenantDomain, context.tenantDomain),
            eq(contentAssets.marketId, context.marketId),
            eq(contentAssets.status, "active"),
          ))
      : Promise.resolve([] as any[]),
    db.select({ primaryColor: tenants.primaryColor })
      .from(tenants)
      .where(eq(tenants.domain, context.tenantDomain))
      .limit(1),
  ]);

  const fmtDate = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  const fmtRange = (s: Date | null, e: Date | null) => {
    if (!s) return "";
    if (!e || new Date(e).toDateString() === new Date(s).toDateString()) return fmtDate(s);
    const sd = new Date(s), ed = new Date(e);
    if (sd.getMonth() === ed.getMonth() && sd.getFullYear() === ed.getFullYear()) {
      return `${sd.toLocaleDateString("en-US", { month: "long", day: "numeric" })}-${ed.getDate()}, ${ed.getFullYear()}`;
    }
    return `${fmtDate(s)} – ${fmtDate(e)}`;
  };

  // Preserve the client-specified order for blog posts; silently skip items
  // that were archived or deleted since the config was saved.
  const blogById = new Map((blogRows as any[]).map((r: any) => [r.id, r]));
  const posts: SectionPost[] = wantedBlogIds
    .map((id: string) => blogById.get(id))
    .filter(Boolean)
    .map((r: any) => ({ title: r.title, url: r.url || null }));

  const eventsData: SectionEvent[] = (eventRows as any[]).map((ev: any) => ({
    name: ev.name,
    dateLabel: fmtRange(ev.startDate, ev.endDate),
    location: ev.location || null,
    website: ev.website || null,
  }));

  const cs = (caseStudyRows as any[])[0];
  const html = renderEmailSections({
    caseStudy: cs
      ? {
          title: cs.title,
          blurb: cs.aiSummary || cs.description || cs.overview || "",
          url: cs.url || null,
          imageUrl: cs.leadImageUrl || null,
        }
      : null,
    events: eventsData,
    posts,
    eventsCalendarUrl: eventsCalendarUrl || null,
    brandPrimary: tenantRows[0]?.primaryColor || undefined,
  });

  return html || null;
}
