/**
 * Conference Social Promotion service.
 *
 * Produces the promotional content for a conference:
 *  - 1-2 anchor posts for overall presence
 *  - one post per delivered session, each tied 1:1 to a matched graphic
 *  - 2-3 copy variations for every post (anchor + session)
 *
 * Posts are persisted into the shared `generatedPosts` table (tagged with
 * conferenceId / conferenceSessionId / postRole) so they reuse the existing
 * scheduling, calendar, and publishing machinery.
 *
 * Graphics support all three modes:
 *  - ai_generated      → gpt-image-1 via generateImageBuffer()
 *  - template_composite → session text overlaid on an uploaded brand template (sharp)
 *  - uploaded          → caller supplies the bytes; we only persist the reference
 *
 * Conference images live in their own object-storage prefix (conference-images/)
 * and their own DB table, never the brand library, so they don't clutter it and
 * can be archived in one click after the event.
 */

import sharp from "sharp";
import * as path from "path";
import { randomUUID } from "crypto";
import { eq, and, inArray, ne, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  conferences,
  conferenceSessions,
  conferenceImages,
  conferenceBackgrounds,
  generatedPosts,
  socialAccounts,
  campaignSocialAccounts,
  scheduledJobRuns,
  tenants,
  markets,
  brandAssets,
  tenantFonts,
  campaigns,
  type Conference,
  type ConferenceSession,
  type ConferenceImage,
} from "@shared/schema";
import { completeForFeature } from "./ai-provider";
import { AI_FEATURES } from "@shared/schema";
import {
  fetchVoiceProfile,
  buildSystemPrompt,
  parseVariants,
} from "./voice-service";
import { generateImageBuffer } from "../replit_integrations/image/client";
import {
  objectStorageClient,
  ObjectStorageService,
} from "../replit_integrations/object_storage/objectStorage";
import { archiveArtifactToSpe } from "./artifact-storage-helper";

const objectStorageService = new ObjectStorageService();

const IMAGE_PREFIX = "conference-images";

// Conference graphics are served back through Orbit's own unauthenticated route
// (`/public-objects/...`) rather than the raw `storage.googleapis.com` URL. The
// GCS bucket is NOT anonymously readable, so a direct storage.googleapis.com URL
// returns 403 to external schedulers (SocialPilot/Hootsuite/Sprout); an Orbit URL
// is publicly fetchable.
const PUBLIC_SERVE_PREFIX = "/public-objects/";

/** The bucket backing the public object-storage search path. */
function publicBucketName(): string {
  return splitObjectPath(objectStorageService.getPublicObjectSearchPaths()[0]).bucketName;
}

/** Parse a `https://storage.googleapis.com/<bucket>/<object>` URL, else null. */
function parseGcsUrl(url: string): { bucketName: string; objectName: string } | null {
  const m = url.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
  return m ? { bucketName: m[1], objectName: decodeURIComponent(m[2]) } : null;
}

/**
 * True once a URL is a stored Orbit-served public image — a RELATIVE
 * `/public-objects/...` path with a valid extension. Absolute URLs (raw GCS or
 * an environment-specific host) are NOT considered served, so they get healed
 * into a relative path on the next render.
 */
function isServedPublicImage(url: string): boolean {
  return url.startsWith(PUBLIC_SERVE_PREFIX) && hasValidImageExt(url);
}

type ReportProgress = (p: {
  phase: string;
  percent: number;
  currentItem?: number;
  totalItems?: number;
  currentItemName?: string;
}) => void;

// ─── object storage helpers ──────────────────────────────────────────────────

function splitObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

/**
 * Persist a generated/processed image buffer into the conference-images prefix
 * of the PUBLIC bucket and return its fully-qualified public URL plus its size.
 */
export async function saveConferenceImageBuffer(
  buffer: Buffer,
  contentType: string,
  ext: string,
): Promise<{ fileUrl: string; fileSize: number }> {
  // Conference graphics are stored in the PUBLIC bucket path and returned as a
  // fully-qualified storage.googleapis.com URL. These images are meant to be
  // posted publicly on social media, and external schedulers (SocialPilot,
  // Hootsuite, Sprout) must be able to fetch the graphic by URL without a
  // logged-in session — the private `/objects/...` route requires auth and
  // returns 401 to those tools, so the graphic never makes it into the post.
  const publicPaths = objectStorageService.getPublicObjectSearchPaths();
  // Format: /<bucket_name>/<prefix...> (e.g. /replit-objstore-xxx/public)
  const { bucketName, objectName: publicPrefix } = splitObjectPath(publicPaths[0]);
  const objectId = `${randomUUID()}.${ext}`;
  const objectName = `${publicPrefix.replace(/\/$/, "")}/${IMAGE_PREFIX}/${objectId}`;
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buffer, { metadata: { contentType } });
  // Return a RELATIVE Orbit path. The GCS bucket is not anonymously readable, so
  // external schedulers must fetch via Orbit's `/public-objects/` route rather
  // than storage.googleapis.com. We store the path (not an absolute URL) so it is
  // never tied to the environment it was generated in — the CSV export turns it
  // into an absolute URL using the host the user is exporting from.
  return {
    fileUrl: `${PUBLIC_SERVE_PREFIX}${IMAGE_PREFIX}/${objectId}`,
    fileSize: buffer.length,
  };
}

/** Read the bytes of a brand template, whether stored in object storage or at an external URL. */
export async function loadImageBytes(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith("/objects/")) {
    const file = await objectStorageService.getObjectEntityFile(fileUrl);
    const [buf] = await file.download();
    return buf;
  }
  // An Orbit `/public-objects/...` path (relative, or absolute with any host)
  // maps to a file in the public search path; read it straight from storage so
  // we never depend on the serving host being reachable.
  const publicIdx = fileUrl.indexOf(PUBLIC_SERVE_PREFIX);
  if (publicIdx !== -1) {
    const objectPath = fileUrl.slice(publicIdx + PUBLIC_SERVE_PREFIX.length);
    const file = await objectStorageService.searchPublicObject(objectPath);
    if (!file) throw new Error(`Public object not found: ${objectPath}`);
    const [buf] = await file.download();
    return buf;
  }
  // A raw GCS URL into our own bucket is not anonymously fetchable (HTTP 403);
  // read it straight from object storage instead. Used to heal legacy URLs.
  const gcs = parseGcsUrl(fileUrl);
  if (gcs && gcs.bucketName === publicBucketName()) {
    const [buf] = await objectStorageClient.bucket(gcs.bucketName).file(gcs.objectName).download();
    return buf;
  }
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to fetch template image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Map an image content type to a safe file extension (defaults to png). */
function extFromContentType(contentType?: string | null): string {
  const c = (contentType || "").toLowerCase();
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  if (c.includes("webp")) return "webp";
  if (c.includes("gif")) return "gif";
  if (c.includes("png")) return "png";
  return "png";
}

/** True when a URL ends in a recognizable image extension (schedulers need this). */
function hasValidImageExt(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

// ─── image generation ────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap text to a rough character width so it doesn't overflow the SVG band. */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\.*$/, "…");
  }
  return lines;
}

/** Wrap to a character width with no line cap (used by the responsive fitter). */
function wrapWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Font-size tiers (largest first) and the line count we allow at each. Bigger
// text is more eye-catching, so we prefer the top tier and only step down when
// the title would overflow horizontally (line count) or vertically (the `fits`
// guard below, used by the conference layout where space is fixed).
const TITLE_TIERS: Array<{ size: number; maxLines: number }> = [
  { size: 72, maxLines: 3 },
  { size: 64, maxLines: 3 },
  { size: 58, maxLines: 4 },
  { size: 50, maxLines: 4 },
  { size: 44, maxLines: 5 },
];

/**
 * Lay out a title onto the hero canvas by picking the largest font size at which
 * the whole title wraps into a comfortable number of lines with no truncation —
 * so the full, provocative thought stays on the card instead of being chopped
 * mid-sentence with a "…". `fits(lineCount, lineHeight)` lets the caller reject
 * a tier that would overflow vertically (e.g. the conference layout). Only the
 * smallest tier truncates, and even then it breaks on word boundaries.
 */
function layoutTitle(
  text: string,
  usableWidth: number,
  fits: (lineCount: number, lineHeight: number) => boolean = () => true,
): { lines: string[]; fontSize: number; lineHeight: number } {
  // Avenir bold renders at roughly this fraction of the font size per glyph;
  // err slightly wide so lines don't overrun the canvas.
  const AVG_CHAR = 0.54;
  const clean = text.trim().replace(/\s+/g, " ");
  for (const { size, maxLines } of TITLE_TIERS) {
    const maxChars = Math.max(8, Math.floor(usableWidth / (size * AVG_CHAR)));
    const lines = wrapWords(clean, maxChars);
    const lineHeight = Math.round(size * 1.16);
    if (lines.length <= maxLines && fits(lines.length, lineHeight)) {
      return { lines, fontSize: size, lineHeight };
    }
  }
  // Last resort: smallest size; truncate to the most lines that still fit
  // vertically (down to one), breaking on a word boundary with an ellipsis so
  // the card can never overflow the canvas even for pathological titles.
  const size = 44;
  const lineHeight = Math.round(size * 1.16);
  const maxChars = Math.max(8, Math.floor(usableWidth / (size * AVG_CHAR)));
  let maxLines = 5;
  while (maxLines > 1 && !fits(maxLines, lineHeight)) maxLines--;
  return { lines: wrapText(clean, maxChars, maxLines), fontSize: size, lineHeight };
}

/**
 * Compose session text (title / speaker / time) onto a 1200x675 canvas. When a
 * template image is supplied it is used as the background; otherwise a branded
 * gradient is drawn.
 */
export async function compositeSessionGraphic(opts: {
  templateBytes?: Buffer | null;
  title: string;
  speaker?: string | null;
  detail?: string | null;
  customFont?: { fontFaces: string; fontFamily: string } | null;
  companyLogoBytes?: Buffer | null;
  websiteUrl?: string | null;
  eventDates?: string | null;
}): Promise<Buffer> {
  const W = 1200;
  const H = 675;

  const customFontCss = opts.customFont?.fontFaces ?? "";
  const headingFamily = opts.customFont?.fontFamily
    ? `'${opts.customFont.fontFamily}', Arial, Helvetica, sans-serif`
    : "Arial, Helvetica, sans-serif";

  const displayUrl = opts.websiteUrl
    ? escapeXml(opts.websiteUrl.replace(/^https?:\/\/(www\.)?/, ""))
    : "";

  const titleLines = wrapText(opts.title, 34, 3);
  const titleSvg = titleLines
    .map(
      (l, i) =>
        `<text x="64" y="${300 + i * 64}" font-family="${headingFamily}" font-size="56" font-weight="700" fill="#ffffff">${escapeXml(l)}</text>`,
    )
    .join("");
  const speakerSvg = opts.speaker
    ? `<text x="64" y="${300 + titleLines.length * 64 + 36}" font-family="${headingFamily}" font-size="34" fill="#e2e8f0">${escapeXml(opts.speaker)}</text>`
    : "";
  const detailSvg = opts.detail
    ? `<text x="64" y="600" font-family="${headingFamily}" font-size="28" fill="#cbd5e1">${escapeXml(opts.detail)}</text>`
    : "";
  const datesSvg = opts.eventDates
    ? `<text x="64" y="632" font-family="${headingFamily}" font-size="22" fill="rgba(255,255,255,0.70)">${escapeXml(opts.eventDates)}</text>`
    : "";
  const urlSvg = displayUrl
    ? `<text x="64" y="657" font-family="${headingFamily}" font-size="22" fill="rgba(255,255,255,0.60)">${displayUrl}</text>`
    : "";

  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${customFontCss ? `<style>${customFontCss}</style>` : ""}
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(15,23,42,0.25)"/>
          <stop offset="55%" stop-color="rgba(15,23,42,0.55)"/>
          <stop offset="100%" stop-color="rgba(15,23,42,0.88)"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#scrim)"/>
      ${titleSvg}
      ${speakerSvg}
      ${detailSvg}
      ${datesSvg}
      ${urlSvg}
    </svg>`,
  );

  let base: sharp.Sharp;
  if (opts.templateBytes) {
    base = sharp(opts.templateBytes).resize(W, H, { fit: "cover" });
  } else {
    const bg = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#bg)"/>
      </svg>`,
    );
    base = sharp(bg);
  }

  const layers: sharp.OverlayOptions[] = [{ input: overlay, top: 0, left: 0 }];

  if (opts.companyLogoBytes) {
    const MAX_CO_W = 200;
    const MAX_CO_H = 56;
    const coResized = await sharp(opts.companyLogoBytes)
      .resize(MAX_CO_W, MAX_CO_H, { fit: "inside", withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(coResized).metadata();
    const coW = meta.width || MAX_CO_W;
    const coH = meta.height || MAX_CO_H;
    layers.push({
      input: coResized,
      top: H - coH - 28,
      left: W - coW - 40,
    });
  }

  return base
    .composite(layers)
    .png()
    .toBuffer();
}

/** Display string for a session's speakers — prefers the structured list, falls back to the legacy field. */
function sessionSpeakerText(session?: ConferenceSession | null): string | null {
  if (!session) return null;
  const speakers = session.speakers ?? [];
  if (speakers.length) return speakers.map((s) => s.name).join(", ");
  return session.speaker ?? null;
}

// Event/session times are floating wall-clock values stored as UTC. Render in
// UTC so the entered time appears verbatim, independent of server timezone.
function formatUtcDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
}

function formatUtcDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" });
}

// Absolute path to the Avenir Next LT Pro font files (served from the client
// public/fonts directory, co-located with the app). Sharp's SVG renderer uses
// these to embed the font at compositing time so the final PNG carries the brand
// typeface rather than a generic system fallback.
const FONTS_DIR = path.resolve(process.cwd(), "client/public/fonts");

function avenirFontFaces(): string {
  const faces = [
    { weight: 300, file: "AvenirNextLTPro-Light.ttf" },
    { weight: 400, file: "AvenirNextLTPro-Regular.ttf" },
    { weight: 500, file: "AvenirNextLTPro-Medium.ttf" },
    { weight: 700, file: "AvenirNextLTPro-Bold.ttf" },
  ];
  return faces
    .map(
      (f) =>
        `@font-face { font-family: 'Avenir Next LT Pro'; font-weight: ${f.weight}; src: url('${path.join(FONTS_DIR, f.file)}') format('truetype'); }`,
    )
    .join(" ");
}

/**
 * Resolve the custom brand font for image compositing.
 * Priority: market-scoped font brand asset (heading) → tenant font (heading) → null (use Avenir).
 * On success returns a ready-to-embed @font-face CSS block plus the font-family name.
 */
async function resolveCompositorFont(
  tenantDomain: string,
  marketId?: string | null,
): Promise<{ fontFaces: string; fontFamily: string } | null> {
  async function buildFromAsset(
    fileUrl: string | null | undefined,
    fontFamily: string | null | undefined,
    fontWeight: string | null | undefined,
    fileType: string | null | undefined,
  ): Promise<{ fontFaces: string; fontFamily: string } | null> {
    if (!fileUrl || !fontFamily) return null;
    try {
      const bytes = await loadImageBytes(fileUrl);
      const b64 = bytes.toString("base64");
      const mime = fileType?.startsWith("font/") ? fileType : "font/ttf";
      const fmt = mime.includes("woff2") ? "woff2" : mime.includes("woff") ? "woff" : mime.includes("otf") ? "opentype" : "truetype";
      const w = fontWeight || "400";
      return {
        fontFaces: `@font-face { font-family: '${fontFamily}'; font-weight: ${w}; src: url('data:${mime};base64,${b64}') format('${fmt}'); }`,
        fontFamily,
      };
    } catch {
      return null;
    }
  }

  // 1. Market-scoped font brand asset
  if (marketId) {
    const assets = await db.select().from(brandAssets).where(
      and(
        eq(brandAssets.tenantDomain, tenantDomain),
        eq(brandAssets.status, "active"),
        eq(brandAssets.marketId, marketId),
        eq(brandAssets.assetType, "font"),
      ),
    );
    const pick = assets.find((a) => a.fontUsage === "heading") ?? assets[0];
    const result = await buildFromAsset(pick?.fileUrl, pick?.fontFamily, pick?.fontWeight, pick?.fileType);
    if (result) return result;
  }

  // 2. Tenant-wide font (heading usage preferred)
  const tenantFontRows = await db.select().from(tenantFonts).where(eq(tenantFonts.tenantDomain, tenantDomain));
  const tenantPick = tenantFontRows.find((f) => f.fontUsage === "heading") ?? tenantFontRows[0];
  if (tenantPick) {
    const result = await buildFromAsset(tenantPick.fileUrl, tenantPick.fontFamily, tenantPick.fontWeight, tenantPick.fileType);
    if (result) return result;
  }

  return null;
}

/**
 * Compose a hero/anchor image from brand assets:
 *   1. Background: a location photo or a branded gradient.
 *   2. A translucent brand-colour scrim for readability.
 *   3. Conference/event name as large headline text (Avenir Next LT Pro Bold).
 *   4. Event logo centered (if provided).
 *   5. Company logo in the bottom-right corner (white variant preferred on dark bg).
 */
export async function compositeHeroImage(opts: {
  backgroundBytes?: Buffer | null;
  eventLogoBytes?: Buffer | null;
  companyLogoBytes?: Buffer | null;
  conferenceName: string;
  location?: string | null;
  primaryColor?: string | null;
  customFont?: { fontFaces: string; fontFamily: string } | null;
  websiteUrl?: string | null;
  eventDates?: string | null;
}): Promise<Buffer> {
  const W = 1200;
  const H = 675;
  const primary = opts.primaryColor || "#810FFB";

  const avenirFaces = avenirFontFaces();
  const customFontCss = opts.customFont?.fontFaces ?? "";
  const allFontFaces = customFontCss ? `${customFontCss} ${avenirFaces}` : avenirFaces;
  const headingFamily = opts.customFont?.fontFamily
    ? `'${opts.customFont.fontFamily}', 'Avenir Next LT Pro', Arial, sans-serif`
    : "'Avenir Next LT Pro', Arial, sans-serif";

  // Responsive title: scale the font so the whole headline fits without an
  // awkward mid-thought "…". ~80px margins each side keep centered text clear
  // of the canvas edges.
  const hasEventLogo = !!opts.eventLogoBytes;
  const subtitleRows = (opts.location ? 1 : 0) + (opts.eventDates ? 1 : 0);
  const CONFERENCE_TITLE_TOP = 380;
  // In conference mode the title starts at a fixed Y beneath the event logo, so
  // reject any font tier whose title + subtitle stack would run off the canvas.
  const fitsVertically = hasEventLogo
    ? (lineCount: number, lh: number) =>
        CONFERENCE_TITLE_TOP + lineCount * lh + 16 + subtitleRows * 40 <= H - 16
    : undefined;
  const { lines: titleLines, fontSize: titleSize, lineHeight } = layoutTitle(
    opts.conferenceName,
    W - 160,
    fitsVertically,
  );
  const subtitleText = opts.location ? escapeXml(opts.location) : "";

  // Conferences anchor the title beneath the event logo; standalone post
  // graphics centre the (variable-height) title block vertically for balance.
  const blockH = (titleLines.length - 1) * lineHeight;
  const titleStartY = hasEventLogo
    ? CONFERENCE_TITLE_TOP
    : Math.round((H - blockH) / 2);
  const titleSvgParts = titleLines.map(
    (l, i) =>
      `<text x="${W / 2}" y="${titleStartY + i * lineHeight}" text-anchor="middle" font-family="${headingFamily}" font-size="${titleSize}" font-weight="700" fill="#ffffff" style="filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5))">${escapeXml(l)}</text>`,
  );

  // Subtitle rows: location then dates, stacked below title
  let subtitleY = titleStartY + blockH + lineHeight + 16;
  const locationSvg = subtitleText
    ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle" font-family="${headingFamily}" font-size="32" font-weight="400" fill="rgba(255,255,255,0.85)">${subtitleText}</text>`
    : "";
  if (subtitleText) subtitleY += 40;
  const datesSvg = opts.eventDates
    ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle" font-family="${headingFamily}" font-size="28" font-weight="400" fill="rgba(255,255,255,0.70)">${escapeXml(opts.eventDates)}</text>`
    : "";

  const displayUrl = opts.websiteUrl
    ? escapeXml(opts.websiteUrl.replace(/^https?:\/\/(www\.)?/, ""))
    : "";
  const urlSvg = displayUrl
    ? `<text x="40" y="${H - 22}" font-family="${headingFamily}" font-size="22" fill="rgba(255,255,255,0.65)">${displayUrl}</text>`
    : "";

  // Hex → rgba for the scrim tint
  const hex = primary.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) || 129;
  const g = parseInt(hex.slice(2, 4), 16) || 15;
  const b = parseInt(hex.slice(4, 6), 16) || 251;

  const scrimSvg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>${allFontFaces}</style>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(${r},${g},${b},0.18)"/>
          <stop offset="45%" stop-color="rgba(15,23,42,0.55)"/>
          <stop offset="100%" stop-color="rgba(15,23,42,0.92)"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#scrim)"/>
      ${titleSvgParts.join("\n      ")}
      ${locationSvg}
      ${datesSvg}
      ${urlSvg}
    </svg>`,
  );

  let base: sharp.Sharp;
  if (opts.backgroundBytes) {
    base = sharp(opts.backgroundBytes).resize(W, H, { fit: "cover" });
  } else {
    const hex2 = primary.replace("#", "");
    const r2 = parseInt(hex2.slice(0, 2), 16) || 129;
    const g2 = parseInt(hex2.slice(2, 4), 16) || 15;
    const b2 = parseInt(hex2.slice(4, 6), 16) || 251;
    const darkened = `rgb(${Math.round(r2 * 0.4)},${Math.round(g2 * 0.4)},${Math.round(b2 * 0.4)})`;
    const bgSvg = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${darkened}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#bg)"/>
      </svg>`,
    );
    base = sharp(bgSvg);
  }

  const layers: sharp.OverlayOptions[] = [{ input: scrimSvg, top: 0, left: 0 }];

  // Event logo — centered horizontally, above the title block
  if (opts.eventLogoBytes) {
    const MAX_LOGO_W = 420;
    const MAX_LOGO_H = 140;
    const logoResized = await sharp(opts.eventLogoBytes)
      .resize(MAX_LOGO_W, MAX_LOGO_H, { fit: "inside", withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(logoResized).metadata();
    const logoW = meta.width || MAX_LOGO_W;
    const logoH = meta.height || MAX_LOGO_H;
    layers.push({
      input: logoResized,
      top: Math.round((titleStartY - logoH) / 2 + (opts.backgroundBytes ? 60 : 80)),
      left: Math.round((W - logoW) / 2),
    });
  }

  // Company logo — bottom-right corner
  if (opts.companyLogoBytes) {
    const MAX_CO_W = 200;
    const MAX_CO_H = 56;
    const coResized = await sharp(opts.companyLogoBytes)
      .resize(MAX_CO_W, MAX_CO_H, { fit: "inside", withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(coResized).metadata();
    const coW = meta.width || MAX_CO_W;
    const coH = meta.height || MAX_CO_H;
    layers.push({
      input: coResized,
      top: H - coH - 32,
      left: W - coW - 40,
    });
  }

  return base
    .composite(layers)
    .png()
    .toBuffer();
}

/**
 * Generate a standalone branded social graphic for a generated post: a brand-color
 * gradient (Synozur purple by default), a large centered headline, and the tenant
 * logo in the corner — the same visual language as the conference hero graphics,
 * but driven by arbitrary post copy instead of a conference. Returns the public
 * Orbit path so external schedulers can fetch the image by URL.
 */
/**
 * Resolve the tenant's brand kit for compositing: the best company logo bytes
 * (white variant preferred on dark backgrounds), the primary brand color
 * (market override → tenant default → brand purple), and the custom heading font.
 * Shared by the post graphic and the carousel slide compositors.
 */
export async function resolveBrandKit(
  tenantDomain: string,
  marketId?: string | null,
): Promise<{
  companyLogoBytes: Buffer | null;
  primaryColor: string | null;
  customFont: { fontFaces: string; fontFamily: string } | null;
}> {
  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.domain, tenantDomain));

  // Company logo: market-scoped brand asset → tenant-wide brand asset → tenant.logoUrl.
  const pickLogo = (assets: typeof brandAssets.$inferSelect[]) =>
    assets.find((a) => a.logoVariant === "white_horizontal" && a.fileUrl) ||
    assets.find((a) => a.logoVariant === "white_square" && a.fileUrl) ||
    assets.find((a) => a.logoVariant?.startsWith("white") && a.fileUrl) ||
    assets.find((a) => a.logoVariant?.startsWith("color") && a.fileUrl) ||
    assets.find((a) => a.logoVariant && a.fileUrl);

  let logoAsset: typeof brandAssets.$inferSelect | undefined;
  if (marketId) {
    const marketAssets = await db.select().from(brandAssets).where(and(
      eq(brandAssets.tenantDomain, tenantDomain),
      eq(brandAssets.status, "active"),
      eq(brandAssets.marketId, marketId),
    ));
    logoAsset = pickLogo(marketAssets);
  }
  if (!logoAsset) {
    const tenantAssets = await db.select().from(brandAssets).where(and(
      eq(brandAssets.tenantDomain, tenantDomain),
      eq(brandAssets.status, "active"),
    ));
    logoAsset = pickLogo(tenantAssets);
  }

  let companyLogoBytes: Buffer | null = null;
  if (logoAsset?.fileUrl) {
    try { companyLogoBytes = await loadImageBytes(logoAsset.fileUrl); } catch { /* skip */ }
  }
  if (!companyLogoBytes && tenantRow?.logoUrl) {
    try { companyLogoBytes = await loadImageBytes(tenantRow.logoUrl); } catch { /* skip */ }
  }

  let primaryColor: string | null = null;
  if (marketId) {
    const [marketRow] = await db.select().from(markets).where(eq(markets.id, marketId));
    primaryColor = marketRow?.primaryColor ?? null;
  }
  if (!primaryColor) primaryColor = tenantRow?.primaryColor ?? null;

  const customFont = await resolveCompositorFont(tenantDomain, marketId);
  return { companyLogoBytes, primaryColor, customFont };
}

export async function generateBrandedPostGraphic(opts: {
  tenantDomain: string;
  marketId?: string | null;
  headline: string;
  subtitle?: string | null;
  backgroundUrl?: string | null;
}): Promise<{ fileUrl: string; fileSize: number }> {
  const { tenantDomain, marketId, headline } = opts;

  const { companyLogoBytes, primaryColor, customFont } = await resolveBrandKit(tenantDomain, marketId);

  let backgroundBytes: Buffer | null = null;
  if (opts.backgroundUrl) {
    try { backgroundBytes = await loadImageBytes(opts.backgroundUrl); } catch { /* fall back to gradient */ }
  }

  const buffer = await compositeHeroImage({
    backgroundBytes,
    eventLogoBytes: null,
    companyLogoBytes,
    conferenceName: headline,
    location: opts.subtitle ?? null,
    primaryColor,
    customFont,
    websiteUrl: null,
    eventDates: null,
  });

  // WS6: keep the public object URL (needed for display/SocialPilot) but also
  // archive a vetted copy to SharePoint when the tenant has it enabled.
  // Fire-and-forget so generation latency is unaffected.
  void archiveArtifactToSpe({
    tenantDomain,
    buffer,
    filename: `post-graphic-${Date.now()}.png`,
    mimeType: "image/png",
    kind: "image",
    marketId: marketId ?? undefined,
    createdByUserId: "system",
  });

  return saveConferenceImageBuffer(buffer, "image/png", "png");
}

// ─── Branded carousel slides (multi-format repurposer) ────────────────────────

interface CarouselSlideInput {
  index: number; // 1-based
  total: number;
  role: "cover" | "body" | "close";
  kicker?: string | null;
  headline: string;
  supportingLines?: string[];
}

/** Parse a hex color into rgb, falling back to brand purple #810FFB. */
function hexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } {
  const h = (hex || "#810FFB").replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) || 129,
    g: parseInt(h.slice(2, 4), 16) || 15,
    b: parseInt(h.slice(4, 6), 16) || 251,
  };
}

/**
 * Compose one 1080x1080 branded carousel slide: a purple→magenta diagonal
 * gradient, an optional kicker label, a magenta accent bar, a large headline,
 * supporting lines, the company logo bottom-left, and an "n/5" index bottom-right.
 */
export async function compositeCarouselSlide(opts: {
  slide: CarouselSlideInput;
  companyLogoBytes?: Buffer | null;
  primaryColor?: string | null;
  customFont?: { fontFaces: string; fontFamily: string } | null;
}): Promise<Buffer> {
  const S = 1080;
  const PAD = 96;
  const { slide } = opts;

  const primary = opts.primaryColor || "#810FFB";
  const { r, g, b } = hexToRgb(primary);
  // Magenta accent derived from the brand purple — push red/green up, settle blue.
  const magenta = `rgb(${Math.min(255, Math.round(r * 1.05 + 80))},${Math.round(g * 0.4 + 18)},${Math.round(b * 0.55 + 40)})`;
  const darkened = `rgb(${Math.round(r * 0.32)},${Math.round(g * 0.32)},${Math.round(b * 0.42)})`;

  const avenirFaces = avenirFontFaces();
  const customFontCss = opts.customFont?.fontFaces ?? "";
  const allFontFaces = customFontCss ? `${customFontCss} ${avenirFaces}` : avenirFaces;
  const headingFamily = opts.customFont?.fontFamily
    ? `'${opts.customFont.fontFamily}', 'Avenir Next LT Pro', Arial, sans-serif`
    : "'Avenir Next LT Pro', Arial, sans-serif";

  const kicker = slide.kicker?.trim();
  const headlineLines = wrapText(slide.headline, 22, 4);
  const supporting = (slide.supportingLines ?? [])
    .filter((l) => l && l.trim())
    .slice(0, 3)
    .flatMap((l) => wrapText(l, 40, 2));

  // Vertical layout: kicker → accent bar → headline → supporting lines.
  let y = 300;
  const kickerSvg = kicker
    ? `<text x="${PAD}" y="${(y -= 70)}" font-family="${headingFamily}" font-size="34" font-weight="500" fill="rgba(255,255,255,0.78)" letter-spacing="2">${escapeXml(kicker)}</text>`
    : "";
  if (kicker) y += 70;

  const barY = y - 28;
  const accentBar = `<rect x="${PAD}" y="${barY}" width="140" height="10" rx="5" fill="${magenta}"/>`;
  y = barY + 70;

  const headlineSvg = headlineLines
    .map((l, i) => {
      const ly = y + i * 86;
      return `<text x="${PAD}" y="${ly}" font-family="${headingFamily}" font-size="76" font-weight="700" fill="#ffffff">${escapeXml(l)}</text>`;
    })
    .join("\n      ");
  let supportY = y + headlineLines.length * 86 + 24;
  const supportingSvg = supporting
    .map((l, i) => {
      const ly = supportY + i * 52;
      return `<text x="${PAD}" y="${ly}" font-family="${headingFamily}" font-size="38" font-weight="400" fill="rgba(255,255,255,0.88)">${escapeXml(l)}</text>`;
    })
    .join("\n      ");

  const indexSvg = `<text x="${S - PAD}" y="${S - 70}" text-anchor="end" font-family="${headingFamily}" font-size="34" font-weight="500" fill="rgba(255,255,255,0.70)">${slide.index}/${slide.total}</text>`;

  const svg = Buffer.from(
    `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>${allFontFaces}</style>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}"/>
          <stop offset="55%" stop-color="${magenta}"/>
          <stop offset="100%" stop-color="${darkened}"/>
        </linearGradient>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(15,23,42,0.05)"/>
          <stop offset="100%" stop-color="rgba(15,23,42,0.45)"/>
        </linearGradient>
      </defs>
      <rect width="${S}" height="${S}" fill="url(#bg)"/>
      <rect width="${S}" height="${S}" fill="url(#scrim)"/>
      ${kickerSvg}
      ${accentBar}
      ${headlineSvg}
      ${supportingSvg}
      ${indexSvg}
    </svg>`,
  );

  const layers: sharp.OverlayOptions[] = [];
  if (opts.companyLogoBytes) {
    const MAX_CO_W = 240;
    const MAX_CO_H = 68;
    const coResized = await sharp(opts.companyLogoBytes)
      .resize(MAX_CO_W, MAX_CO_H, { fit: "inside", withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(coResized).metadata();
    const coH = meta.height || MAX_CO_H;
    layers.push({ input: coResized, top: S - coH - 64, left: PAD });
  }

  return sharp(svg).composite(layers).png().toBuffer();
}

/**
 * Render and persist a full set of branded carousel slides (one image per slide).
 * Returns the public Orbit URLs in slide order. Each slide is rendered
 * independently; a single slide failing is surfaced to the caller via a throw so
 * the route can degrade gracefully for the whole carousel.
 */
export async function generateBrandedCarouselSet(opts: {
  tenantDomain: string;
  marketId?: string | null;
  slides: CarouselSlideInput[];
}): Promise<{ fileUrl: string; fileSize: number }[]> {
  const { tenantDomain, marketId } = opts;
  const { companyLogoBytes, primaryColor, customFont } = await resolveBrandKit(tenantDomain, marketId);

  const results: { fileUrl: string; fileSize: number }[] = [];
  for (const slide of opts.slides) {
    const buffer = await compositeCarouselSlide({ slide, companyLogoBytes, primaryColor, customFont });
    void archiveArtifactToSpe({
      tenantDomain,
      buffer,
      filename: `carousel-slide-${slide.index}-${Date.now()}.png`,
      mimeType: "image/png",
      kind: "image",
      marketId: marketId ?? undefined,
      createdByUserId: "system",
    });
    results.push(await saveConferenceImageBuffer(buffer, "image/png", "png"));
  }
  return results;
}

/**
 * Render a batch of branded carousel slides — one image per slide — in the
 * tenant's brand style (purple/magenta gradient, headline, logo). Brand inputs
 * are resolved once for the whole deck. Returns each slide's index, public file
 * URL, and the headline used, in slide order. Slides whose render fails are
 * omitted (the caller degrades gracefully).
 */
export async function generateBrandedCarouselSlides(opts: {
  tenantDomain: string;
  marketId?: string | null;
  slides: { index: number; headline: string; body?: string | null }[];
}): Promise<{ index: number; headline: string; fileUrl: string; fileSize: number }[]> {
  const { tenantDomain, marketId, slides } = opts;
  if (slides.length === 0) return [];

  const { companyLogoBytes, primaryColor, customFont } = await resolveBrandKit(
    tenantDomain,
    marketId,
  );

  const renderOne = async (slide: { index: number; headline: string; body?: string | null }) => {
    const buffer = await compositeHeroImage({
      backgroundBytes: null,
      eventLogoBytes: null,
      companyLogoBytes,
      conferenceName: slide.headline,
      location: slide.body?.trim() || null,
      primaryColor,
      customFont,
      websiteUrl: null,
      eventDates: null,
    });

    void archiveArtifactToSpe({
      tenantDomain,
      buffer,
      filename: `carousel-slide-${slide.index}-${Date.now()}.png`,
      mimeType: "image/png",
      kind: "image",
      marketId: marketId ?? undefined,
      createdByUserId: "system",
    });

    const saved = await saveConferenceImageBuffer(buffer, "image/png", "png");
    return { index: slide.index, headline: slide.headline, fileUrl: saved.fileUrl, fileSize: saved.fileSize };
  };

  const settled = await Promise.allSettled(slides.map(renderOne));
  const out: { index: number; headline: string; fileUrl: string; fileSize: number }[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(r.value);
    else console.error("[carousel slide render]", r.reason);
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

function defaultImagePrompt(conf: Conference, session?: ConferenceSession | null): string {
  if (session) {
    const speaker = sessionSpeakerText(session);
    return `Professional, on-brand conference session promotion graphic for "${session.title}"${
      speaker ? ` featuring ${speaker}` : ""
    } at ${conf.name}. Modern, clean, corporate marketing style with abstract tech background. No text.`;
  }
  return `Eye-catching conference presence announcement graphic for ${conf.name}${
    conf.location ? ` in ${conf.location}` : ""
  }. Modern, clean, corporate marketing style with abstract background. No text.`;
}

/**
 * Read the bytes behind an image's existing (non-Orbit) URL and re-publish them
 * through Orbit's public route, updating the row. Used to heal private uploads
 * and legacy raw-GCS URLs without regenerating the graphic.
 */
async function republishViaOrbit(image: ConferenceImage, current: string): Promise<string> {
  let bytes: Buffer;
  let contentType: string;
  if (current.startsWith("/objects/")) {
    // Private object path has no extension — derive the type from its metadata
    // (falling back to the recorded fileType).
    const file = await objectStorageService.getObjectEntityFile(current);
    const [metadata] = await file.getMetadata();
    [bytes] = await file.download();
    contentType = (metadata?.contentType as string | undefined) || image.fileType || "image/png";
  } else {
    bytes = await loadImageBytes(current);
    contentType = image.fileType || "image/png";
  }
  const ext = extFromContentType(contentType);
  const saved = await saveConferenceImageBuffer(bytes, contentType, ext);
  await db
    .update(conferenceImages)
    .set({ fileUrl: saved.fileUrl, fileSize: saved.fileSize, updatedAt: new Date() })
    .where(eq(conferenceImages.id, image.id));
  return saved.fileUrl;
}

/**
 * Render the bytes for a conference image record according to its source, store
 * them, and update the row with fileUrl/fileSize. No-op for uploaded images
 * (the caller already supplied a fileUrl). Returns the resolved fileUrl.
 */
export async function renderConferenceImage(
  image: ConferenceImage,
  conf: Conference,
  session?: ConferenceSession | null,
): Promise<string | null> {
  const current = image.fileUrl ?? null;

  // Self-heal: any image that already has bytes but lives at a URL external
  // schedulers can't fetch — a private `/objects/...` upload OR a legacy raw
  // `storage.googleapis.com` URL (which 403s anonymously) — is re-published
  // through Orbit's public route. This applies to ALL sources so previously
  // generated/composited graphics are preserved rather than regenerated.
  if (current && !isServedPublicImage(current)) {
    try {
      return await republishViaOrbit(image, current);
    } catch (err: any) {
      console.error("[Conference] Failed to re-publish image:", err?.message);
      // Uploaded images have no other way to be produced — keep the current URL.
      // Generated/composite images fall through and are regenerated below.
      if (image.source === "uploaded") return current;
    }
  }

  if (image.source === "uploaded") {
    // Uploaded image with no bytes (or already served) — nothing to render.
    return current;
  }

  let saved: { fileUrl: string; fileSize: number };

  // ── Shared assets (used by both logo_composite and template_composite) ──────

  // Format event dates without year: "March 18–21" / "March 18 – April 2"
  const eventDates = (() => {
    if (!conf.startDate) return null;
    const start = new Date(conf.startDate);
    const sm = start.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    const sd = start.toLocaleString("en-US", { day: "numeric", timeZone: "UTC" });
    if (!conf.endDate) return `${sm} ${sd}`;
    const end = new Date(conf.endDate);
    const em = end.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    const ed = end.toLocaleString("en-US", { day: "numeric", timeZone: "UTC" });
    return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
  })();

  // Tenant row — fetched here so both the logo block and brand-color block can use it.
  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.domain, conf.tenantDomain));

  // Company logo — market-scoped brand asset first, then tenant-wide brand asset,
  // then finally the tenant's own logoUrl as a last resort.
  let companyLogoBytes: Buffer | null = null;
  if (image.source !== "ai_generated") {
    const pickLogo = (assets: typeof brandAssets.$inferSelect[]) =>
      assets.find((a) => a.logoVariant === "white_horizontal" && a.fileUrl) ||
      assets.find((a) => a.logoVariant === "white_square" && a.fileUrl) ||
      assets.find((a) => a.logoVariant?.startsWith("white") && a.fileUrl) ||
      assets.find((a) => a.logoVariant?.startsWith("color") && a.fileUrl) ||
      assets.find((a) => a.logoVariant && a.fileUrl);

    let whLogoAsset: typeof brandAssets.$inferSelect | undefined;
    if (conf.marketId) {
      const marketLogoAssets = await db.select().from(brandAssets).where(and(
        eq(brandAssets.tenantDomain, conf.tenantDomain),
        eq(brandAssets.status, "active"),
        eq(brandAssets.marketId, conf.marketId),
      ));
      whLogoAsset = pickLogo(marketLogoAssets);
    }
    if (!whLogoAsset) {
      const tenantLogoAssets = await db.select().from(brandAssets).where(
        and(eq(brandAssets.tenantDomain, conf.tenantDomain), eq(brandAssets.status, "active")),
      );
      whLogoAsset = pickLogo(tenantLogoAssets);
    }
    if (whLogoAsset?.fileUrl) {
      try { companyLogoBytes = await loadImageBytes(whLogoAsset.fileUrl); } catch { /* skip */ }
    }
    // Last resort: use the tenant's own logoUrl (set in Tenant Settings)
    if (!companyLogoBytes && tenantRow?.logoUrl) {
      try { companyLogoBytes = await loadImageBytes(tenantRow.logoUrl); } catch { /* skip */ }
    }
  }

  if (image.source === "ai_generated") {
    const prompt = (image.imagePrompt && image.imagePrompt.trim()) || defaultImagePrompt(conf, session);
    const buffer = await generateImageBuffer(prompt, "1024x1024");
    saved = await saveConferenceImageBuffer(buffer, "image/png", "png");
    // WS6: archive a vetted SPE copy when enabled (fire-and-forget, gated).
    void archiveArtifactToSpe({ tenantDomain: conf.tenantDomain, buffer, filename: `event-${image.role}-${image.id}.png`, mimeType: "image/png", kind: "image", marketId: conf.marketId ?? undefined, createdByUserId: conf.createdBy ?? "system" });
  } else if (image.source === "logo_composite") {
    // Hero anchor image: background photo + brand scrim + event logo + company logo + conf name
    let backgroundBytes: Buffer | null = null;
    if (image.backgroundId) {
      const [bg] = await db.select().from(conferenceBackgrounds).where(eq(conferenceBackgrounds.id, image.backgroundId));
      if (bg?.fileUrl) {
        try { backgroundBytes = await loadImageBytes(bg.fileUrl); } catch { /* fall back to gradient */ }
      }
    }

    let eventLogoBytes: Buffer | null = null;
    if (conf.eventLogoFileUrl) {
      try { eventLogoBytes = await loadImageBytes(conf.eventLogoFileUrl); } catch { /* skip */ }
    }

    // Brand colors: prefer market-level override, fall back to tenant default.
    let primaryColor: string | null = null;
    if (conf.marketId) {
      const [marketRow] = await db.select().from(markets).where(eq(markets.id, conf.marketId));
      primaryColor = marketRow?.primaryColor ?? null;
    }
    if (!primaryColor) primaryColor = tenantRow?.primaryColor ?? null;

    const customFont = await resolveCompositorFont(conf.tenantDomain, conf.marketId);
    const buffer = await compositeHeroImage({
      backgroundBytes,
      eventLogoBytes,
      companyLogoBytes,
      conferenceName: conf.name,
      location: conf.location,
      primaryColor,
      customFont,
      websiteUrl: conf.website ?? null,
      eventDates,
    });
    saved = await saveConferenceImageBuffer(buffer, "image/png", "png");
    // WS6: archive a vetted SPE copy when enabled (fire-and-forget, gated).
    void archiveArtifactToSpe({ tenantDomain: conf.tenantDomain, buffer, filename: `event-${image.role}-${image.id}.png`, mimeType: "image/png", kind: "image", marketId: conf.marketId ?? undefined, createdByUserId: conf.createdBy ?? "system" });
  } else {
    // template_composite — session graphic
    let templateBytes: Buffer | null = null;
    if (image.templateAssetId) {
      const [tpl] = await db.select().from(brandAssets).where(eq(brandAssets.id, image.templateAssetId));
      if (tpl?.fileUrl) {
        try { templateBytes = await loadImageBytes(tpl.fileUrl); } catch (err: any) {
          console.error("[Conference] Failed to load template image:", err?.message);
        }
      }
    }
    const detail = [session?.room, formatUtcDateTime(session?.sessionStart)]
      .filter(Boolean)
      .join(" · ");
    const customFont = await resolveCompositorFont(conf.tenantDomain, conf.marketId);
    const buffer = await compositeSessionGraphic({
      templateBytes,
      title: session?.title || conf.name,
      speaker: sessionSpeakerText(session),
      detail: detail || conf.eventHashtag || null,
      customFont,
      companyLogoBytes,
      websiteUrl: conf.website ?? null,
      eventDates,
    });
    saved = await saveConferenceImageBuffer(buffer, "image/png", "png");
    // WS6: archive a vetted SPE copy when enabled (fire-and-forget, gated).
    void archiveArtifactToSpe({ tenantDomain: conf.tenantDomain, buffer, filename: `event-${image.role}-${image.id}.png`, mimeType: "image/png", kind: "image", marketId: conf.marketId ?? undefined, createdByUserId: conf.createdBy ?? "system" });
  }

  await db
    .update(conferenceImages)
    .set({ fileUrl: saved.fileUrl, fileType: "image/png", fileSize: saved.fileSize, updatedAt: new Date() })
    .where(eq(conferenceImages.id, image.id));

  return saved.fileUrl;
}

// ─── scheduling ────────────────────────────────────────────────────────────────

/**
 * Build `count` scheduled slots starting at promoStart, placing `postsPerDay`
 * posts distributed evenly across the full promoStart–promoEnd window
 * (skipping weekends unless included), with random times in the 6am–6pm
 * window per day. Extends past promoEnd only if the window is too small to
 * fit all posts at postsPerDay.
 */
export function buildScheduleSlots(opts: {
  promoStart: Date;
  promoEnd?: Date | null;
  postsPerDay: number;
  includeSaturday: boolean;
  includeSunday: boolean;
  count: number;
  /**
   * Client timezone offset in minutes, as returned by `Date.getTimezoneOffset()`
   * (i.e. minutes to ADD to local time to get UTC; positive west of UTC). When
   * provided, posting times land in the 6am–6pm window in the *user's* timezone
   * instead of the server's (UTC on Replit).
   */
  tzOffsetMinutes?: number;
}): Date[] {
  if (opts.count <= 0) return [];

  const tz = Number.isFinite(opts.tzOffsetMinutes as number) ? (opts.tzOffsetMinutes as number) : 0;
  const DAY_START_MIN = 6 * 60;   // 360 — 6:00 AM
  const DAY_END_MIN   = 18 * 60;  // 1080 — 6:00 PM
  const windowMin     = DAY_END_MIN - DAY_START_MIN; // 720 minutes
  const perDayCap     = Math.min(Math.max(1, opts.postsPerDay), 8);

  const isEligible = (d: Date) => {
    const dow = d.getUTCDay();
    return (dow !== 0 || opts.includeSunday) && (dow !== 6 || opts.includeSaturday);
  };

  // ── Step 1: collect every eligible day within [promoStart, promoEnd] ──────
  const eligibleDays: Date[] = [];
  const scan = new Date(opts.promoStart);
  scan.setUTCHours(0, 0, 0, 0);
  // Include the promoEnd day itself (23:59 boundary)
  const endBoundary = opts.promoEnd
    ? (() => { const d = new Date(opts.promoEnd); d.setUTCHours(23, 59, 59, 999); return d; })()
    : null;
  for (let g = 0; g < 3650; g++) {
    if (endBoundary && scan > endBoundary) break;
    if (isEligible(scan)) eligibleDays.push(new Date(scan));
    scan.setUTCDate(scan.getUTCDate() + 1);
    // If no promoEnd, stop once we have enough days to fit all posts
    if (!endBoundary && eligibleDays.length * perDayCap >= opts.count) break;
  }

  // ── Step 2: decide posts-per-day to spread evenly across the window ───────
  // optimalPerDay = smallest integer that fits count across eligibleDays,
  // but never more than perDayCap. If the window is too short we extend below.
  const postsPerDayActual = eligibleDays.length > 0
    ? Math.max(1, Math.min(perDayCap, Math.ceil(opts.count / eligibleDays.length)))
    : perDayCap;

  // ── Step 3: build day-assignment list ────────────────────────────────────
  // Distribute `count` posts across eligibleDays as evenly as possible,
  // putting at most postsPerDayActual on each day.
  type DayBucket = { day: Date; posts: number };
  const buckets: DayBucket[] = [];

  if (eligibleDays.length > 0 && opts.count <= eligibleDays.length * postsPerDayActual) {
    const base  = Math.floor(opts.count / eligibleDays.length);
    const extra = opts.count - base * eligibleDays.length;
    for (let i = 0; i < eligibleDays.length; i++) {
      // Bresenham-style: spread the `extra` posts evenly across days
      const postsThisDay = base +
        (Math.floor((i + 1) * extra / eligibleDays.length) >
         Math.floor(i       * extra / eligibleDays.length) ? 1 : 0);
      if (postsThisDay > 0) buckets.push({ day: eligibleDays[i], posts: postsThisDay });
    }
  } else {
    // Fill all eligible days at postsPerDayActual, then extend beyond promoEnd
    let remaining = opts.count;
    for (const day of eligibleDays) {
      const p = Math.min(postsPerDayActual, remaining);
      buckets.push({ day, posts: p });
      remaining -= p;
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      const ext = new Date(eligibleDays.length > 0
        ? eligibleDays[eligibleDays.length - 1]
        : opts.promoStart);
      ext.setUTCDate(ext.getUTCDate() + 1);
      for (let g = 0; g < 3650 && remaining > 0; g++) {
        if (isEligible(ext)) {
          const p = Math.min(postsPerDayActual, remaining);
          buckets.push({ day: new Date(ext), posts: p });
          remaining -= p;
        }
        ext.setUTCDate(ext.getUTCDate() + 1);
      }
    }
  }

  // ── Step 4: for each day pick random times spread across 6am–6pm ─────────
  // Divide the window into k equal segments, pick one random minute per segment.
  // This gives human-feeling spread without robotic fixed clock times.
  const slots: Date[] = [];
  for (const { day, posts: k } of buckets) {
    const segSize = windowMin / k;
    for (let i = 0; i < k; i++) {
      const segStart = DAY_START_MIN + i * segSize;
      // Random within the middle 80% of the segment to avoid edge clustering
      const margin   = segSize * 0.1;
      const randomMin = Math.round(segStart + margin + Math.random() * (segSize - margin * 2));
      const clamped   = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 1, randomMin));
      const slot = new Date(day);
      slot.setUTCHours(Math.floor(clamped / 60), clamped % 60, 0, 0);
      slot.setUTCMinutes(slot.getUTCMinutes() + tz);
      slots.push(slot);
    }
  }

  return slots.slice(0, opts.count);
}

// ─── copy generation ────────────────────────────────────────────────────────────

const PLATFORM_GUIDE: Record<string, string> = {
  linkedin: "LinkedIn: professional, 120-220 words, a clear hook and a soft CTA. No inline hashtags.",
  twitter: "X/Twitter: under 240 characters so a link + hashtags still fit. Punchy and direct.",
  instagram: "Instagram: warm and visual, 80-150 words, light emoji use, strong opening line.",
  facebook: "Facebook: friendly and conversational, 80-180 words, encouraging CTA.",
  bluesky: "Bluesky: concise and authentic, under 280 characters, conversational.",
};

function cleanHashtag(tag: string): string {
  return tag.replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "");
}

function resolveHashtags(conf: Conference): string[] {
  const tags = new Set<string>();
  if (conf.eventHashtag) {
    const t = cleanHashtag(conf.eventHashtag);
    if (t) tags.add(t);
  }
  for (const t of conf.alwaysHashtags ?? []) {
    const c = cleanHashtag(t);
    if (c) tags.add(c);
  }
  return Array.from(tags);
}

async function generateCopyVariants(opts: {
  platform: string;
  socialAccountId: string | null;
  tenantDomain: string;
  variantCount: number;
  conf: Conference;
  session?: ConferenceSession | null;
}): Promise<string[]> {
  const { platform, conf, session, variantCount } = opts;

  let systemPrompt: string | undefined;
  if (opts.socialAccountId) {
    try {
      const [account] = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.id, opts.socialAccountId), eq(socialAccounts.tenantDomain, opts.tenantDomain)));
      if (account) {
        const profile = await fetchVoiceProfile(opts.socialAccountId);
        systemPrompt = buildSystemPrompt({ account, profile, persona: null, frameworks: [], platform });
      }
    } catch {
      // fall back to no voice profile
    }
  }

  const contextLines: string[] = [
    `Event: ${conf.name}`,
    conf.location ? `Location: ${conf.location}` : "",
    conf.startDate ? `Dates: ${formatUtcDate(conf.startDate)}${conf.endDate ? ` – ${formatUtcDate(conf.endDate)}` : ""}` : "",
    conf.website ? `Link: ${conf.website}` : "",
    conf.thematicBrief ? `Theme/brief: ${conf.thematicBrief}` : "",
    conf.discountStatement ? `Registration offer (mention verbatim in at least one variation if it fits naturally): ${conf.discountStatement}` : "",
  ].filter(Boolean);

  if (session) {
    const speakers = session.speakers ?? [];
    const speakerLine = speakers.length
      ? speakers.map((s) => (s.isStaff ? `${s.name} (our team)` : s.name)).join(", ")
      : session.speaker;
    contextLines.push(
      `This post promotes a specific session we are delivering:`,
      `  Title: ${session.title}`,
      session.sessionType ? `  Session type: ${session.sessionType.toLowerCase()}` : "",
      speakerLine ? `  Speaker(s): ${speakerLine}` : "",
      session.track ? `  Track: ${session.track}` : "",
      session.room ? `  Room: ${session.room}` : "",
      session.sessionStart ? `  When: ${formatUtcDateTime(session.sessionStart)}` : "",
      session.abstract ? `  Abstract: ${session.abstract}` : "",
      session.url ? `  Session link: ${session.url}` : "",
    );
  } else {
    contextLines.push(`This is an ANCHOR post about our overall presence at the conference (booth, where to find us, why attendees should connect).`);
  }

  const prompt = `You are an expert B2B social media copywriter. Write ${variantCount} DISTINCT variations of a single ${platform} post.

${PLATFORM_GUIDE[platform] ?? PLATFORM_GUIDE.linkedin}

CONTEXT:
${contextLines.filter(Boolean).join("\n")}

RULES:
- Write from the ORGANIZATION's point of view, not an individual's. This is a company/brand page, so use "we"/"our team"/"our" (or name the company). Never use singular first person like "I", "I'm", "I'll be", or "I'm going to" — a company does not attend an event as "I".
- Each variation must take a clearly different angle (e.g. a question, a bold statement, a benefit-led hook, a "don't miss this" urgency angle).
- Do NOT include hashtags inline — they are added separately.
- Do not number the variations inside the text.
- Keep it authentic and specific to the context above; never invent facts.

Return ONLY a valid JSON array of ${variantCount} strings, e.g. ["first post text", "second post text"]. No markdown, no commentary.`;

  const result = await completeForFeature(AI_FEATURES.MARKETING_TASKS, prompt, {
    systemPrompt,
    temperature: 0.8,
    maxTokens: 1600,
    tenantDomain: opts.tenantDomain,
  });

  const variants = parseCopyVariants(result.text, variantCount);
  return variants.length > 0 ? variants.slice(0, variantCount) : [result.text.trim()];
}

/**
 * Parse copy variants from the model output. The conference prompt asks for a
 * JSON array of strings, so try that first; fall back to the `---VARIANT---`
 * separator format and finally to the raw text. Without this, a JSON array
 * response would be stored verbatim as a single post's content (brackets,
 * quotes, escaped newlines and all).
 */
function parseCopyVariants(text: string, expected: number): string[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Try a top-level JSON array of strings.
  try {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const strings = parsed
          .filter((v) => typeof v === "string")
          .map((v) => (v as string).trim())
          .filter(Boolean);
        if (strings.length > 0) return strings.slice(0, expected);
      }
    }
  } catch {
    // fall through to separator parsing
  }

  return parseVariants(cleaned, expected);
}

// ─── campaign wiring ──────────────────────────────────────────────────────────

/**
 * Ensure every conference has a linked "event" campaign shell.
 *
 * Idempotent: if `conf.campaignId` is already set the function returns it
 * immediately without touching the DB.  Otherwise it:
 *   1. Inserts a new campaign (type = "event", status = "active").
 *   2. Writes its id back to `conferences.campaignId`.
 *   3. Stamps any existing posts for this conference that still have
 *      `campaignId = null` so they roll up into the new campaign.
 *
 * Returns the (possibly pre-existing) campaign id.
 */
export async function ensureConferenceCampaign(
  conf: {
    id: string;
    tenantDomain: string;
    marketId: string | null;
    name: string;
    startDate: Date | null;
    campaignId: string | null;
  },
  createdByUserId: string,
): Promise<string> {
  if (conf.campaignId) return conf.campaignId;

  const [campaign] = await db
    .insert(campaigns)
    .values({
      tenantDomain: conf.tenantDomain,
      marketId: conf.marketId ?? undefined,
      name: conf.name,
      status: "active",
      campaignType: "event",
      startDate: conf.startDate ?? undefined,
      createdBy: createdByUserId,
    })
    .returning();

  const now = new Date();
  await db
    .update(conferences)
    .set({ campaignId: campaign.id, updatedAt: now })
    .where(eq(conferences.id, conf.id));

  // Backfill any posts already generated for this conference that have no campaign.
  await db
    .update(generatedPosts)
    .set({ campaignId: campaign.id })
    .where(
      and(
        eq(generatedPosts.conferenceId, conf.id),
        isNull(generatedPosts.campaignId),
      ),
    );

  console.log(
    `[Conference] Created event campaign ${campaign.id} for conference ${conf.id} (${conf.name})`,
  );
  return campaign.id;
}

// ─── orchestration ────────────────────────────────────────────────────────────

export interface GenerateConferencePostsOptions {
  socialAccountIds: string[];
  ownerUserId: string;
  generateImages?: boolean; // render AI/composite graphics during generation (default true)
  tzOffsetMinutes?: number; // client Date.getTimezoneOffset(); schedules posts in the user's timezone
  includePublished?: boolean; // also wipe already-published posts before regenerating (default false)
}

/**
 * Generate anchor + per-session posts for a conference across its selected
 * social accounts, with `variantsPerPost` copy variations each, scheduled across
 * the promotion window. Idempotent-ish: clears prior non-published conference
 * posts before regenerating.
 */
export async function generateConferencePostsAsync(
  conferenceId: string,
  tenantDomain: string,
  jobId: string,
  options: GenerateConferencePostsOptions,
  reportProgress?: ReportProgress,
): Promise<void> {
  await db.update(scheduledJobRuns).set({ status: "running", startedAt: new Date() }).where(eq(scheduledJobRuns.id, jobId));
  try {
    await runGeneration(conferenceId, tenantDomain, jobId, options, reportProgress);
    await db
      .update(scheduledJobRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(scheduledJobRuns.id, jobId));
  } catch (err: any) {
    await db
      .update(scheduledJobRuns)
      .set({ status: "failed", completedAt: new Date(), errorMessage: err?.message ?? "Unknown error" })
      .where(eq(scheduledJobRuns.id, jobId));
    throw err;
  }
}

async function runGeneration(
  conferenceId: string,
  tenantDomain: string,
  jobId: string,
  options: GenerateConferencePostsOptions,
  reportProgress?: ReportProgress,
): Promise<void> {
  reportProgress?.({ phase: "Loading conference", percent: 5 });

  let [conf] = await db
    .select()
    .from(conferences)
    .where(and(eq(conferences.id, conferenceId), eq(conferences.tenantDomain, tenantDomain)));
  if (!conf) throw new Error("Conference not found");

  // Ensure an event campaign exists before we write posts, so every post gets
  // campaignId stamped at insert time rather than requiring a later backfill.
  if (!conf.campaignId) {
    const campaignId = await ensureConferenceCampaign(conf, options.ownerUserId);
    conf = { ...conf, campaignId };
  }

  const sessions = await db
    .select()
    .from(conferenceSessions)
    .where(and(eq(conferenceSessions.conferenceId, conferenceId), eq(conferenceSessions.status, "active")))
    .orderBy(conferenceSessions.sortOrder);

  const accountIds = options.socialAccountIds.filter(Boolean);
  const accounts = accountIds.length
    ? await db
        .select()
        .from(socialAccounts)
        .where(and(inArray(socialAccounts.id, accountIds), eq(socialAccounts.tenantDomain, tenantDomain)))
    : [];
  if (accounts.length === 0) throw new Error("No social accounts selected");

  const variantCount = Math.min(Math.max(conf.variantsPerPost ?? 3, 2), 3);
  const generateImages = options.generateImages !== false;

  // Clear prior conference posts so regeneration doesn't leave behind stale
  // variant groups. By default we keep already-published posts; when
  // includePublished is set we wipe those too. Tenant-scoped.
  await db
    .delete(generatedPosts)
    .where(
      and(
        eq(generatedPosts.conferenceId, conferenceId),
        eq(generatedPosts.tenantDomain, tenantDomain),
        ...(options.includePublished ? [] : [ne(generatedPosts.status, "published")]),
      ),
    );

  // Resolve / render images. One anchor image (shared by anchor posts) + one per session.
  reportProgress?.({ phase: "Preparing graphics", percent: 15 });

  const existingImages = await db
    .select()
    .from(conferenceImages)
    .where(and(eq(conferenceImages.conferenceId, conferenceId), eq(conferenceImages.status, "active")));

  const sessionImageBySession = new Map<string, ConferenceImage>();
  const anchorImages: ConferenceImage[] = [];
  for (const img of existingImages) {
    if (img.role === "anchor") anchorImages.push(img);
    if (img.sessionId) sessionImageBySession.set(img.sessionId, img);
  }
  // Oldest-first so slot 0 = the anchor image the user created first
  anchorImages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Ensure a session image row exists for every session (default: composite).
  for (const session of sessions) {
    if (!sessionImageBySession.has(session.id)) {
      const [img] = await db
        .insert(conferenceImages)
        .values({
          id: randomUUID(),
          conferenceId,
          sessionId: session.id,
          tenantDomain,
          role: "session",
          source: "template_composite",
          name: session.title,
          createdBy: options.ownerUserId,
        })
        .returning();
      sessionImageBySession.set(session.id, img);
    }
  }

  // Render any image that still needs bytes.
  if (generateImages) {
    // Render fresh when there are no bytes yet, and re-publish (heal) any image
    // whose URL isn't an Orbit-served public image — private `/objects/` uploads
    // and legacy raw-GCS URLs that external schedulers can't fetch. Applies to
    // every source so old generated/composited graphics get healed too.
    const needsRender = (img: ConferenceImage): boolean =>
      !img.fileUrl || !isServedPublicImage(img.fileUrl);
    const toRender: Array<{ img: ConferenceImage; session?: ConferenceSession | null }> = [];
    for (const img of anchorImages) {
      if (needsRender(img)) toRender.push({ img });
    }
    for (const session of sessions) {
      const img = sessionImageBySession.get(session.id);
      if (img && needsRender(img)) toRender.push({ img, session });
    }
    let rendered = 0;
    for (const { img, session } of toRender) {
      try {
        const url = await renderConferenceImage(img, conf, session);
        if (url) img.fileUrl = url;
      } catch (err: any) {
        console.error("[Conference] Image render failed:", err?.message);
      }
      rendered++;
      reportProgress?.({
        phase: "Rendering graphics",
        percent: 15 + Math.round((rendered / Math.max(toRender.length, 1)) * 25),
        currentItem: rendered,
        totalItems: toRender.length,
      });
    }
  }

  // ── Schedule slot assignment ────────────────────────────────────────────────
  //
  // When anchor images are configured, they are scheduled at a ratio equal to
  // their count vs session posts. With 3 anchor images and N sessions the pattern
  // is: [A0, A1, A2, S0, A0, A1, A2, S1, …] giving a 3:1 anchor:session ratio.
  // Each anchor slot generates fresh copy but reuses the same image URL so the
  // graphic is shown repeatedly with varied messaging.
  //
  // When no anchor images exist fall back to the legacy fixed-count behaviour
  // (conf.anchorPostCount slots, no image attached).

  type AnchorSlot = { img: ConferenceImage; slotIdx: number };
  type SessionSlot = { session: ConferenceSession; slotIdx: number };

  const anchorSlots: AnchorSlot[] = [];
  const sessionSlots: SessionSlot[] = [];
  let totalSlots: number;

  const nAnchors = anchorImages.length;
  const nSessions = sessions.length;

  if (nAnchors > 0 && nSessions > 0) {
    // One slot per anchor image + one slot per session (flat list, shuffled below)
    totalSlots = nAnchors + nSessions;
    for (let a = 0; a < nAnchors; a++) {
      anchorSlots.push({ img: anchorImages[a], slotIdx: a });
    }
    for (let s = 0; s < nSessions; s++) {
      sessionSlots.push({ session: sessions[s], slotIdx: nAnchors + s });
    }
  } else if (nAnchors > 0) {
    // No sessions — one slot per anchor image
    totalSlots = nAnchors;
    for (let a = 0; a < nAnchors; a++) {
      anchorSlots.push({ img: anchorImages[a], slotIdx: a });
    }
  } else {
    // Legacy: fixed anchor count from conf, then sessions
    const legacyAnchorCount = Math.min(Math.max(conf.anchorPostCount ?? 2, 1), 3);
    totalSlots = legacyAnchorCount + nSessions;
    for (let a = 0; a < legacyAnchorCount; a++) {
      anchorSlots.push({ img: undefined as unknown as ConferenceImage, slotIdx: a });
    }
    for (let s = 0; s < nSessions; s++) {
      sessionSlots.push({ session: sessions[s], slotIdx: legacyAnchorCount + s });
    }
  }

  // Shuffle anchor and session items together so they're spread randomly
  // across the schedule instead of clustering (anchor, session, anchor, session…).
  {
    type SlotItem =
      | { kind: 'anchor'; img: ConferenceImage }
      | { kind: 'session'; session: ConferenceSession };
    const items: SlotItem[] = [
      ...anchorSlots.map(a => ({ kind: 'anchor' as const, img: a.img })),
      ...sessionSlots.map(s => ({ kind: 'session' as const, session: s.session })),
    ];
    // Fisher-Yates shuffle
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    anchorSlots.length = 0;
    sessionSlots.length = 0;
    items.forEach((item, idx) => {
      if (item.kind === 'anchor') anchorSlots.push({ img: item.img, slotIdx: idx });
      else sessionSlots.push({ session: item.session, slotIdx: idx });
    });
  }

  // ── Rebuild a flat ordered moment list from the shuffled anchor/session slots ──
  type MomentItem =
    | { kind: "anchor"; img: ConferenceImage }
    | { kind: "session"; session: ConferenceSession };

  const momentOrder: MomentItem[] = (() => {
    const combined: (MomentItem & { slotIdx: number })[] = [
      ...anchorSlots.map(a => ({ kind: "anchor" as const, img: a.img, slotIdx: a.slotIdx })),
      ...sessionSlots.map(s => ({ kind: "session" as const, session: s.session, slotIdx: s.slotIdx })),
    ];
    combined.sort((a, b) => a.slotIdx - b.slotIdx);
    return combined;
  })();

  const numMoments = momentOrder.length;
  if (numMoments === 0) return;

  // ── Calculate target slot count = postsPerDay × eligible window days ──────────
  // This fills the full promotion window rather than just one slot per moment.
  const promoStart = conf.promoStartDate ?? conf.startDate ?? new Date();
  const promoEnd   = conf.promoEndDate ?? conf.endDate;
  const perDayCap  = Math.min(Math.max(1, conf.postsPerDay ?? 2), 8);

  const targetSlotCount = (() => {
    if (!promoEnd) return numMoments; // no window configured → one slot per moment
    const isEl = (d: Date) => {
      const dow = d.getUTCDay();
      return (dow !== 0 || conf.includeSunday) && (dow !== 6 || conf.includeSaturday);
    };
    let days = 0;
    const cur = new Date(promoStart); cur.setUTCHours(0, 0, 0, 0);
    const end = new Date(promoEnd);   end.setUTCHours(23, 59, 59, 999);
    for (let g = 0; g < 3650 && cur <= end; g++) {
      if (isEl(cur)) days++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return Math.max(numMoments, days * perDayCap);
  })();

  const slots = buildScheduleSlots({
    promoStart,
    promoEnd,
    postsPerDay: conf.postsPerDay ?? 2,
    includeSaturday: conf.includeSaturday,
    includeSunday: conf.includeSunday,
    count: targetSlotCount,
    tzOffsetMinutes: options.tzOffsetMinutes,
  });

  // ── Pre-generate copy variants once per (moment × account) ───────────────────
  // Variants are cached and cycled across appearances so AI calls = numMoments ×
  // numAccounts (same as before), not totalSlots × numAccounts.
  const variantPool = new Map<string, string[]>(); // `${momentIdx}:${accountId}` → variants

  const getVariants = async (
    momentIdx: number,
    account: (typeof accounts)[0],
  ): Promise<string[]> => {
    const key = `${momentIdx}:${account.id}`;
    if (variantPool.has(key)) return variantPool.get(key)!;
    const m = momentOrder[momentIdx];
    let vs: string[] = [];
    try {
      vs = await generateCopyVariants({
        platform: account.platform,
        socialAccountId: account.id,
        tenantDomain,
        variantCount,
        conf,
        session: m.kind === "session" ? m.session : null,
      });
    } catch (err: any) {
      console.error("[Conference] Copy generation failed for moment", momentIdx, err?.message);
    }
    variantPool.set(key, vs);
    return vs;
  };

  // Pre-warm variant cache in order so progress feedback is sensible
  reportProgress?.({ phase: "Generating copy", percent: 42 });
  for (let mi = 0; mi < numMoments; mi++) {
    for (const account of accounts) {
      await getVariants(mi, account);
    }
    reportProgress?.({
      phase: "Generating copy",
      percent: 42 + Math.round(((mi + 1) / numMoments) * 8),
      currentItem: mi + 1,
      totalItems: numMoments,
      currentItemName: momentOrder[mi].kind === "session"
        ? momentOrder[mi].session.title
        : "Anchor post",
    });
  }

  // ── Round-robin: each slot → moment[slotIdx % numMoments] ────────────────────
  // Variants cycle: appearance k of moment m uses variants[k % variants.length].
  // Each slot is its own post per account — no in-slot pick-one alternatives,
  // since the point is temporal spread, not simultaneous alternatives.
  const baseHashtags = resolveHashtags(conf);
  let created = 0;

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const momentIdx  = slotIdx % numMoments;
    const appearance = Math.floor(slotIdx / numMoments);
    const moment     = momentOrder[momentIdx];
    const scheduledDate = slots[slotIdx];
    const img =
      moment.kind === "anchor"
        ? moment.img
        : sessionImageBySession.get(moment.session.id);

    for (const account of accounts) {
      const variants = await getVariants(momentIdx, account);
      if (variants.length === 0) continue;
      // Each (slot × account) is its own post; give it a unique variantGroup so
      // the review UI shows one card per platform rather than collapsing all
      // platforms for a slot into a single group.
      const variantGroup = randomUUID();

      // Cycle: appearance 0→v0, 1→v1, 2→v2, 3→v0, …
      const content = variants[appearance % variants.length];

      await db.insert(generatedPosts).values({
        id: randomUUID(),
        tenantDomain,
        conferenceId,
        // Stamp the parent campaign so event posts roll up into its master view.
        campaignId: conf.campaignId ?? null,
        ...(moment.kind === "session" ? { conferenceSessionId: moment.session.id } : {}),
        postRole: moment.kind === "anchor" ? "anchor" : "session",
        conferenceImageId: img?.id ?? null,
        overrideImageUrl: img?.fileUrl ?? null,
        socialAccountId: account.id,
        platform: account.platform,
        content,
        hashtags: baseHashtags,
        variantGroup,
        scheduledDate,
        sourceUrl:
          moment.kind === "session"
            ? (moment.session.url ?? conf.website ?? null)
            : (conf.website ?? null),
        status: "draft",
        generationJobId: jobId,
      });
    }

    created++;
    reportProgress?.({
      phase: "Writing posts",
      percent: 50 + Math.round((created / slots.length) * 48),
      currentItem: created,
      totalItems: slots.length,
    });
  }

  // Ensure every social account used in generation is linked to the campaign so
  // the posting queue and publish worker don't show posts as "disconnected".
  if (conf.campaignId && accounts.length > 0) {
    await db
      .insert(campaignSocialAccounts)
      .values(
        accounts.map((a) => ({
          campaignId: conf.campaignId!,
          socialAccountId: a.id,
          autoPublish: false, // preserves manual-approval workflow; user can enable in campaign settings
        })),
      )
      .onConflictDoNothing({
        target: [campaignSocialAccounts.campaignId, campaignSocialAccounts.socialAccountId],
      });
  }

  reportProgress?.({ phase: "Done", percent: 100 });
}
