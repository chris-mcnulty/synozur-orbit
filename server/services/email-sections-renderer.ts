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
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";

export interface SectionGeneralInfo {
  senderSignoff?: string | null;   // e.g. "Best,"
  senderName?: string | null;      // e.g. "Chris McNulty"
  senderTitle?: string | null;     // e.g. "CTO, Synozur"
  aboutTitle?: string | null;      // e.g. "About Synozur"
  aboutText?: string | null;
  aboutImageUrl?: string | null;
}

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
  blogIndexUrl?: string | null;    // link to the full blog under the blog column
  blogSectionTitle?: string | null; // heading for the blog column (default "From Our Blog")
  blogIntro?: string | null;        // short message shown above the post list
  generalInfo?: SectionGeneralInfo | null;
  brandPrimary?: string;   // link/heading accent
}

/**
 * Keep case-study blurbs scannable: cut at a sentence boundary near maxChars.
 * AI summaries can run several paragraphs — an email card needs 2-3 sentences.
 */
export function truncateBlurb(text: string, maxChars = 300): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= maxChars) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [t];
  let out = "";
  for (const s of sentences) {
    if (out && (out + s).trim().length > maxChars) break;
    out += s;
  }
  out = out.trim();
  if (!out) out = t.slice(0, maxChars).trim() + "…";
  return out;
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
  // 240px wrapper with 20px right padding (border-box) = 220px image + a
  // visible gutter between image and text on desktop (MSO path has its own
  // 20px spacer cell).
  const img = cs.imageUrl
    ? `<div style="display:inline-block;width:100%;max-width:240px;vertical-align:top;box-sizing:border-box;padding:0 20px 12px 0;">
        ${cs.url ? `<a href="${esc(cs.url)}" target="_blank">` : ""}<img src="${esc(cs.imageUrl)}" alt="${esc(cs.title)}" width="220" style="width:100%;max-width:220px;height:auto;display:block;border-radius:6px;border:0;">${cs.url ? "</a>" : ""}
      </div><!--
      -->`
    : "";
  const textMax = cs.imageUrl ? 320 : 560;
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
          <p style="margin:0 0 10px 0;${BODY_TEXT}">${esc(truncateBlurb(cs.blurb))}</p>
          ${cs.quote ? `<p style="margin:0 0 10px 0;${BODY_TEXT}font-style:italic;color:#444444;">${esc(cs.quote)}</p>` : ""}
          ${cs.url ? `<p style="margin:0;${BODY_TEXT}"><a href="${esc(cs.url)}" target="_blank" style="color:${brand};text-decoration:underline;font-weight:bold;">Read the full case study &rarr;</a></p>` : ""}
        </div>
      </div>${msoClose}
    </div>
  </td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:0;line-height:0;height:24px;">&nbsp;</td></tr></table>`;
}

/** Events + From Our Blog: two fluid columns that stack on mobile. */
function renderTwoColumn(
  events: SectionEvent[],
  posts: SectionPost[],
  eventsCalendarUrl: string | null | undefined,
  blogIndexUrl: string | null | undefined,
  brand: string,
  blogSectionTitle?: string | null,
  blogIntro?: string | null,
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
          <h2 style="${H2}">${esc(blogSectionTitle?.trim() || "From Our Blog")}</h2>
          ${blogIntro?.trim() ? `<p style="margin:0 0 10px 0;${BODY_TEXT}">${esc(blogIntro.trim())}</p>` : ""}
          <ul style="margin:0;padding:0 0 0 20px;">${postItems}</ul>
          ${blogIndexUrl ? `<p style="margin:12px 0 0 0;${BODY_TEXT}">${link(blogIndexUrl, "Read more on our blog →", brand)}</p>` : ""}
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

/** General info block: sign-off + About company. Rendered last, below the content sections. */
function renderGeneralInfo(g: SectionGeneralInfo): string {
  const hasSignoff = g.senderName || g.senderTitle;
  const hasAbout = g.aboutTitle || g.aboutText;
  if (!hasSignoff && !hasAbout) return "";

  const signoffHtml = hasSignoff ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:24px 16px 8px 16px;">
    ${g.senderSignoff ? `<p style="margin:0 0 6px 0;${BODY_TEXT}">${esc(g.senderSignoff)}</p>` : ""}
    ${g.senderName ? `<p style="margin:0 0 2px 0;${BODY_TEXT}font-weight:bold;">${esc(g.senderName)}</p>` : ""}
    ${g.senderTitle ? `<p style="margin:0;${BODY_TEXT}color:#444444;">${esc(g.senderTitle)}</p>` : ""}
  </td></tr>
</table>` : "";

  if (!hasAbout) return signoffHtml;

  const img = g.aboutImageUrl
    ? `<div style="display:inline-block;width:100%;max-width:240px;vertical-align:top;box-sizing:border-box;padding:0 20px 12px 0;">
        <img src="${esc(g.aboutImageUrl)}" alt="${esc(g.aboutTitle ?? "")}" width="220" style="width:100%;max-width:220px;height:auto;display:block;border-radius:6px;border:0;">
      </div><!--
      -->`
    : "";
  const textMax = g.aboutImageUrl ? 300 : 560;
  const msoOpen = g.aboutImageUrl
    ? `<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td width="220" valign="top"><![endif]-->`
    : "";
  const msoMid = g.aboutImageUrl ? `<!--[if mso]></td><td width="20">&nbsp;</td><td width="300" valign="top"><![endif]-->` : "";
  const msoClose = g.aboutImageUrl ? `<!--[if mso]></td></tr></table><![endif]-->` : "";

  const aboutHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:${hasSignoff ? "0" : "24px"} 16px 24px 16px;border-top:1px solid #e5e5e5;">
    <div style="padding-top:24px;font-size:0;text-align:left;">
      ${msoOpen}${img}${msoMid}<div style="display:inline-block;width:100%;max-width:${textMax}px;vertical-align:top;">
        <div style="${BODY_TEXT}${g.aboutImageUrl ? "padding:8px 0 0 0;" : ""}">
          ${g.aboutTitle ? `<p style="margin:0 0 10px 0;${BODY_TEXT}font-weight:bold;">${esc(g.aboutTitle)}</p>` : ""}
          ${g.aboutText ? `<p style="margin:0;${BODY_TEXT}">${esc(g.aboutText)}</p>` : ""}
        </div>
      </div>${msoClose}
    </div>
  </td></tr>
</table>`;

  return signoffHtml + aboutHtml;
}

export function renderEmailSections(input: RenderSectionsInput): string {
  const brand = input.brandPrimary || "#7C3AED";
  const parts: string[] = [];
  if (input.caseStudy) parts.push(renderCaseStudy(input.caseStudy, brand));
  const twoCol = renderTwoColumn(input.events ?? [], input.posts ?? [], input.eventsCalendarUrl, input.blogIndexUrl, brand, input.blogSectionTitle, input.blogIntro);
  if (twoCol) parts.push(twoCol);
  const genInfo = renderGeneralInfo(input.generalInfo ?? {});
  if (genInfo) parts.push(genInfo);
  if (!parts.length) return "";
  return `\n<!-- orbit:sections:start -->\n${parts.join("\n")}\n<!-- orbit:sections:end -->\n`;
}

/** Shape of the JSONB `sections` column on generated_emails. */
export interface SectionsConfig {
  caseStudyAssetId?: string | null;
  eventIds?: string[];
  blogAssetIds?: string[];
  eventsCalendarUrl?: string | null;
  blogIndexUrl?: string | null;
  blogSectionTitle?: string | null;
  blogIntro?: string | null;
  generalInfo?: SectionGeneralInfo | null;
}

/**
 * Remove an AI-generated "About …" block from the main email body when the
 * configured sections already include an About block — older saved emails
 * were generated before the prompt forbade the AI from writing its own,
 * which produced two About sections in the final output.
 *
 * Conservative: only removes the nearest enclosing <tr> (or, failing that,
 * the heading plus its immediately following paragraph), and only when the
 * removed chunk is small and does not contain the deterministic sections
 * marker.
 */
export function stripDuplicateAboutSection(html: string, aboutTitle?: string | null, companyName?: string | null): string {
  // Only remove headings that unambiguously duplicate the configured About
  // block: the exact configured title (e.g. "About Synozur"), "About Us",
  // or "About <company name>". A generic /^About/ match would eat
  // legitimate content like "About the webinar".
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titles = ["About Us"];
  if (aboutTitle?.trim()) titles.push(aboutTitle.trim());
  if (companyName?.trim()) titles.push(`About ${companyName.trim()}`);
  const titleAlt = titles.map(escapeRe).join("|");
  // Tolerate inline markup inside the heading (e.g. <h2><strong>About Us</strong></h2>)
  // and non-heading "headings" the AI sometimes emits as a bold paragraph.
  const inner = `(?:\\s|<[^>]+>)*`;
  const patterns = [
    new RegExp(`<(h[1-4])\\b[^>]*>${inner}(?:${titleAlt})${inner}<\\/\\1>`, "i"),
    new RegExp(`<p\\b[^>]*>${inner}<(?:strong|b)\\b[^>]*>\\s*(?:${titleAlt})\\s*<\\/(?:strong|b)>${inner}<\\/p>`, "i"),
  ];
  let out = html;
  // Remove every duplicate occurrence (AI has been seen writing About at both
  // the top and bottom of the body), with a hard cap as a safety valve.
  for (let pass = 0; pass < 4; pass++) {
    let m: RegExpExecArray | null = null;
    for (const re of patterns) {
      m = re.exec(out);
      if (m) break;
    }
    if (!m) break;
    const headStart = m.index;
    const headEnd = m.index + m[0].length;
    // Prefer removing the enclosing <tr> row (AI emails are table-based) —
    // but only when the row is provably an isolated About block: small, no
    // other headings, no nested tables/CTA modules, and not our own sections.
    const trStart = out.lastIndexOf("<tr", headStart);
    const trEndIdx = out.indexOf("</tr>", headEnd);
    if (trStart !== -1 && trEndIdx !== -1) {
      const chunk = out.slice(trStart, trEndIdx + 5);
      const headingCount = (chunk.match(/<h[1-4]\b/gi) ?? []).length;
      const isolated =
        chunk.length < 4000 &&
        !chunk.includes("orbit:sections") &&
        headingCount <= 1 &&
        !/<table\b/i.test(chunk) &&        // nested module (CTA button table, etc.)
        !/<a\b[^>]*class="[^"]*btn/i.test(chunk);
      if (isolated) {
        out = out.slice(0, trStart) + out.slice(trEndIdx + 5);
        continue;
      }
    }
    // Fallback: heading + the paragraph immediately after it.
    const after = out.slice(headEnd);
    const pMatch = /^\s*<p\b[^>]*>[\s\S]{0,2000}?<\/p>/i.exec(after);
    const removeEnd = headEnd + (pMatch ? pMatch[0].length : 0);
    out = out.slice(0, headStart) + out.slice(removeEnd);
  }
  return out;
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

  const { caseStudyAssetId, eventIds, blogAssetIds, eventsCalendarUrl, blogIndexUrl, blogSectionTitle, blogIntro, generalInfo } = sections;
  const wantedEventIds = Array.isArray(eventIds) ? eventIds.filter(Boolean) : [];
  const wantedBlogIds = Array.isArray(blogAssetIds) ? blogAssetIds.filter(Boolean) : [];

  if (!caseStudyAssetId && !wantedEventIds.length && !wantedBlogIds.length) return null;

  // Event IDs mix sources: "ca_<uuid>" → content-asset events (workshops,
  // webinars), "mcp_*" → website-MCP events (not in our DB, dropped here),
  // everything else → conferences. Passing prefixed IDs to the conferences
  // query used to throw (invalid uuid), which silently killed the whole
  // re-render — and with it, the events column in send/export output.
  const caEventIds = wantedEventIds.filter(id => id.startsWith("ca_")).map(id => id.slice(3));
  const confEventIds = wantedEventIds.filter(id => !id.startsWith("ca_") && !id.startsWith("mcp_"));

  const [caseStudyRows, eventRows, caEventRows, blogRows, tenantRows] = await Promise.all([
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
    confEventIds.length
      ? db.select().from(conferences)
          .where(and(
            inArray(conferences.id, confEventIds),
            eq(conferences.tenantDomain, context.tenantDomain),
            or(eq(conferences.marketId, context.marketId), isNull(conferences.marketId)),
          ))
          .orderBy(conferences.startDate)
      : Promise.resolve([] as any[]),
    caEventIds.length
      ? db.select().from(contentAssets)
          .where(and(
            inArray(contentAssets.id, caEventIds),
            eq(contentAssets.tenantDomain, context.tenantDomain),
            eq(contentAssets.marketId, context.marketId),
            ne(contentAssets.status, "archived"),
          ))
          .orderBy(contentAssets.assetDate)
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

  // Sort blog posts chronologically (newest first) by publish date, falling
  // back to createdAt; silently skip items archived/deleted since the config
  // was saved.
  const blogById = new Map((blogRows as any[]).map((r: any) => [r.id, r]));
  const posts: SectionPost[] = wantedBlogIds
    .map((id: string) => blogById.get(id))
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const da = new Date(a.assetDate ?? a.createdAt ?? 0).getTime();
      const db2 = new Date(b.assetDate ?? b.createdAt ?? 0).getTime();
      return db2 - da;
    })
    .map((r: any) => ({ title: r.title, url: r.url || null }));

  // Merge conference + content-asset events, preserving the user's selected order.
  const confById = new Map((eventRows as any[]).map((r: any) => [r.id, r]));
  const caById = new Map((caEventRows as any[]).map((r: any) => [r.id, r]));
  const eventsData: SectionEvent[] = wantedEventIds
    .map((id: string) => {
      if (id.startsWith("ca_")) {
        const r = caById.get(id.slice(3));
        return r ? {
          name: r.title as string,
          dateLabel: fmtDate(r.assetDate),
          location: null,
          website: r.url || null,
        } as SectionEvent : null;
      }
      const ev = confById.get(id);
      return ev ? {
        name: ev.name as string,
        dateLabel: fmtRange(ev.startDate, ev.endDate),
        location: ev.location || null,
        website: ev.website || null,
      } as SectionEvent : null;
    })
    .filter((e): e is SectionEvent => e !== null);

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
    blogIndexUrl: blogIndexUrl || null,
    blogSectionTitle: blogSectionTitle || null,
    blogIntro: blogIntro || null,
    generalInfo: generalInfo || null,
    brandPrimary: tenantRows[0]?.primaryColor || undefined,
  });

  return html || null;
}
